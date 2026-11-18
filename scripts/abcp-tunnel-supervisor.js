/** Runtime-only SSH secrets. Never log key contents or inherit them in children. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

function prepare(env = process.env) {
  const childEnv = { ...env };
  delete childEnv.ABCP_TUNNEL_PRIVATE_KEY;
  delete childEnv.ABCP_TUNNEL_KNOWN_HOSTS;
  const enabled = !!(env.ABCP_TUNNEL_PRIVATE_KEY || env.ABCP_TUNNEL_KEY_FILE);
  if (!enabled) return { enabled, childEnv, cleanup() {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abcp-ssh-'));
  fs.chmodSync(dir, 0o700);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    function file(value, supplied, name) {
      const target = path.join(dir, name);
      const content = value || (supplied ? fs.readFileSync(supplied, 'utf8') : '');
      if (!content.trim()) throw new Error('Missing tunnel ' + name);
      fs.writeFileSync(target, content.replace(/\r/g, '').trim() + '\n', { mode: 0o600 });
      return target;
    }
    const key = file(env.ABCP_TUNNEL_PRIVATE_KEY, env.ABCP_TUNNEL_KEY_FILE, 'key');
    const known = file(env.ABCP_TUNNEL_KNOWN_HOSTS, env.ABCP_TUNNEL_KNOWN_HOSTS_FILE, 'known_hosts');
    const host = env.ABCP_TUNNEL_HOST || '199.189.249.4';
    const user = env.ABCP_TUNNEL_USER || 'abcp-tunnel';
    if (!/^[a-zA-Z0-9.-]+$/.test(host) || host.startsWith('-') || !/^[a-zA-Z0-9_-]+$/.test(user) || user.startsWith('-')) throw new Error('Invalid tunnel host or user');
    if (env.ABCP_TUNNEL_BIND && env.ABCP_TUNNEL_BIND !== '127.0.0.1:1080') throw new Error('Tunnel bind must be 127.0.0.1:1080');
    return { enabled, childEnv, cleanup, dir, args: [
      '-N', '-T', '-D', '127.0.0.1:1080', '-i', key,
      '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known,
      '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1',
      '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', user + '@' + host,
    ] };
  } catch (error) { cleanup(); throw error; }
}

async function main() {
  const config = prepare();
  delete process.env.ABCP_TUNNEL_PRIVATE_KEY;
  delete process.env.ABCP_TUNNEL_KNOWN_HOSTS;
  let ssh, app, timer, stopping = false, attempts = 0;
  function stop(code) {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    if (ssh) ssh.kill('SIGTERM');
    if (app) app.kill('SIGTERM');
    const force = setTimeout(() => {
      if (ssh) ssh.kill('SIGKILL');
      if (app) app.kill('SIGKILL');
      config.cleanup();
      process.exit(code);
    }, 5000);
    force.unref();
    process.exitCode = code;
  }
  process.on('SIGTERM', () => stop(0));
  process.on('SIGINT', () => stop(0));
  process.on('exit', config.cleanup);
  function startApp() {
    if (app || stopping) return;
    app = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: config.childEnv });
    app.on('error', () => { console.error('[abcp-tunnel] app launch failed'); stop(1); });
    app.on('exit', code => stop(code == null ? 1 : code));
  }
  function tunnel() {
    if (stopping) return;
    attempts++;
    console.log('[abcp-tunnel] SSH connection attempt ' + attempts + '/5');
    // Do not print raw SSH stderr: it may include unexpected secret-file data.
    ssh = spawn('ssh', config.args, { stdio: 'ignore', env: config.childEnv });
    let ended = false, probeTimer, deadlineTimer;
    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimeout(probeTimer);
      clearTimeout(deadlineTimer);
      if (stopping) return;
      console.error('[abcp-tunnel] disconnected or failed; browser requests must remain paused');
      if (attempts < 5) timer = setTimeout(tunnel, Math.min(300000, 30000 * 2 ** (attempts - 1)));
      else console.error('[abcp-tunnel] retry budget exhausted; inspect configuration and restart manually');
    };
    ssh.on('error', finish);
    ssh.on('exit', finish);
    const current = ssh;
    deadlineTimer = setTimeout(() => { if (!ended) current.kill('SIGTERM'); }, 20000);
    function probe() {
      if (ended || stopping) return;
      const socket = net.connect({ host: '127.0.0.1', port: 1080 });
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        clearTimeout(deadlineTimer);
        if (!ended && !stopping) { console.log('[abcp-tunnel] loopback listener reachable (not proof of ABCP access)'); startApp(); }
      });
      const retry = () => { socket.destroy(); if (!ended && !stopping) probeTimer = setTimeout(probe, 250); };
      socket.once('error', retry);
      socket.once('timeout', retry);
    }
    probe();
  }
  if (config.enabled) {
    // Monitoring/API service stays available even when SSH setup fails.
    startApp();
    tunnel();
  } else startApp();
}
if (require.main === module) main().catch(() => { console.error('[abcp-tunnel] configuration failed; check secret variables/files (contents suppressed)'); process.exitCode = 1; });
module.exports = { prepare };
