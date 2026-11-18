const assert = require('assert');
const fs = require('fs');
const sup = require('../scripts/abcp-tunnel-supervisor');
const base = { ABCP_TUNNEL_HOST: '199.189.249.4', ABCP_TUNNEL_USER: 'abcp-tunnel', ABCP_TUNNEL_PRIVATE_KEY: 'PRIVATE\nKEY', ABCP_TUNNEL_KNOWN_HOSTS: 'host ssh-ed25519 AAAA' };
const c = sup.prepare(base);
try {
  assert.strictEqual(c.enabled, true);
  assert.ok(c.args.includes('-D') && c.args.includes('127.0.0.1:1080'));
  assert.ok(c.args.some(x => x.includes('StrictHostKeyChecking=yes')));
  assert.ok(!('ABCP_TUNNEL_PRIVATE_KEY' in c.childEnv));
  assert.ok(!('ABCP_TUNNEL_KNOWN_HOSTS' in c.childEnv));
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(c.args[c.args.indexOf('-i') + 1]).mode & 0o777, 0o600);
  assert.strictEqual(fs.readFileSync(c.args[c.args.indexOf('-i') + 1], 'utf8'), 'PRIVATE\nKEY\n');
  c.cleanup();
  assert.throws(() => sup.prepare({ ...base, ABCP_TUNNEL_BIND: '0.0.0.0:1080' }), /bind/);
  assert.throws(() => sup.prepare({ ...base, ABCP_TUNNEL_HOST: '-bad' }), /host/);
  console.log('ABCP tunnel supervisor tests passed');
} finally { try { c.cleanup(); } catch {} }
