#!/bin/sh
set -eu
TUNNEL_PID=""
cleanup() {
  if [ -n "$TUNNEL_PID" ]; then kill "$TUNNEL_PID" 2>/dev/null || true; fi
}
trap cleanup INT TERM EXIT

if [ -n "${ABCP_TUNNEL_KEY_FILE:-}" ]; then
  key="$ABCP_TUNNEL_KEY_FILE"
  host="${ABCP_TUNNEL_HOST:-199.189.249.4}"
  user="${ABCP_TUNNEL_USER:-abcp-tunnel}"
  bind="${ABCP_TUNNEL_BIND:-127.0.0.1:1080}"
  known_hosts="${ABCP_TUNNEL_KNOWN_HOSTS_FILE:-/run/secrets/abcp_tunnel_known_hosts}"
  [ -r "$key" ] || { echo "[abcp-tunnel] key file is not readable: $key" >&2; exit 1; }
  [ -r "$known_hosts" ] || { echo "[abcp-tunnel] known-hosts file is required: $known_hosts" >&2; exit 1; }
  chmod 600 "$key" 2>/dev/null || true
  echo "[abcp-tunnel] starting loopback SOCKS tunnel to $host"
  ssh -N -T -D "$bind" -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$user@$host" &
  TUNNEL_PID=$!
  sleep 1
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "[abcp-tunnel] failed to start" >&2; exit 1; }
  echo "[abcp-tunnel] tunnel process started"
fi

exec node server.js
