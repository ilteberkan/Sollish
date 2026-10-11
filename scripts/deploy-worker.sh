#!/usr/bin/env bash
# Deploy an already tested artifact only to the user's authorized SSH alias.
# Retains every previous release for atomic rollback; never transfers secrets.
set -euo pipefail
SOLLISH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SOLLISH_ROOT"
[[ -f apps/worker/dist/main.mjs && -f apps/worker/dist/build.json ]] || { echo 'Build worker first.' >&2; exit 1; }
SOLLISH_HASH="$(/usr/bin/shasum -a 256 apps/worker/dist/main.mjs | awk '{print $1}')"
[[ "$SOLLISH_HASH" =~ ^[a-f0-9]{64}$ ]] || exit 1
SOLLISH_REMOTE_TMP="$(ssh -o BatchMode=yes -o ConnectTimeout=10 sunucum 'mktemp -d /tmp/sollish-release.XXXXXX')"
[[ "$SOLLISH_REMOTE_TMP" =~ ^/tmp/sollish-release\.[a-zA-Z0-9]+$ ]] || exit 1
scp -q apps/worker/dist/main.mjs apps/worker/dist/build.json ops/sollish-worker.service "sunucum:$SOLLISH_REMOTE_TMP/"
ssh -o BatchMode=yes sunucum "sudo -n bash -s -- '$SOLLISH_REMOTE_TMP' '$SOLLISH_HASH'" <<'REMOTE'
set -euo pipefail
SOLLISH_SOURCE="$1"
SOLLISH_HASH="$2"
SOLLISH_RELEASE="/opt/sollish/releases/$SOLLISH_HASH"
exec 9>/run/lock/sollish-deploy.lock
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
printf '%s  %s\n' "$SOLLISH_HASH" "$SOLLISH_SOURCE/main.mjs" | sha256sum -c
test -x /opt/sollish/runtime/node-v24.21.0-linux-arm64/bin/node
install -d -m 0755 "$SOLLISH_RELEASE"
install -m 0644 "$SOLLISH_SOURCE/main.mjs" "$SOLLISH_RELEASE/main.mjs"
install -m 0644 "$SOLLISH_SOURCE/build.json" "$SOLLISH_RELEASE/build.json"
# Validate the candidate before touching the installed service unit.
systemd-analyze verify "$SOLLISH_SOURCE/sollish-worker.service"
# An unconfigured process exposes only a loopback 503 health response and does
# no chain/database writes. Existing credentials are never overwritten.
if [[ ! -f /etc/sollish/worker.env ]]; then
  install -m 0600 /dev/null /etc/sollish/worker.env
  printf 'NODE_ENV=production\n' > /etc/sollish/worker.env
fi
SOLLISH_PREVIOUS="$(readlink /opt/sollish/current || true)"
SOLLISH_WAS_ACTIVE=false
systemctl is-active --quiet sollish-worker.service && SOLLISH_WAS_ACTIVE=true
SOLLISH_WAS_ENABLED=false
systemctl is-enabled --quiet sollish-worker.service && SOLLISH_WAS_ENABLED=true
SOLLISH_UNIT_BACKUP="$(mktemp /tmp/sollish-unit.XXXXXX)"
SOLLISH_HAD_UNIT=false
if [[ -f /etc/systemd/system/sollish-worker.service ]]; then
  cp /etc/systemd/system/sollish-worker.service "$SOLLISH_UNIT_BACKUP"
  SOLLISH_HAD_UNIT=true
fi
trap 'rm -f "$SOLLISH_UNIT_BACKUP"' EXIT
rollback() {
  local failure=$?
  trap - ERR
  set +e
  if [[ "$SOLLISH_PREVIOUS" == /opt/sollish/releases/* && -f "$SOLLISH_PREVIOUS/main.mjs" ]]; then
    ln -sfn "$SOLLISH_PREVIOUS" /opt/sollish/current.next
    mv -Tf /opt/sollish/current.next /opt/sollish/current
  else
    rm -f /opt/sollish/current
  fi
  if [[ "$SOLLISH_HAD_UNIT" == true ]]; then
    install -m 0644 "$SOLLISH_UNIT_BACKUP" /etc/systemd/system/sollish-worker.service
  else
    systemctl stop sollish-worker.service
    systemctl disable sollish-worker.service
    rm -f /etc/systemd/system/sollish-worker.service
  fi
  systemctl daemon-reload
  if [[ "$SOLLISH_HAD_UNIT" == true ]]; then
    if [[ "$SOLLISH_WAS_ACTIVE" == true ]]; then systemctl restart sollish-worker.service; else systemctl stop sollish-worker.service; fi
    if [[ "$SOLLISH_WAS_ENABLED" == true ]]; then systemctl enable sollish-worker.service; else systemctl disable sollish-worker.service; fi
  fi
  echo 'Deployment failed; restored the previous artifact, unit and service state. Inspect service health before continuing.' >&2
  exit "$failure"
}
trap rollback ERR
install -m 0644 "$SOLLISH_SOURCE/sollish-worker.service" /etc/systemd/system/sollish-worker.service
ln -sfn "$SOLLISH_RELEASE" /opt/sollish/current.next
mv -Tf /opt/sollish/current.next /opt/sollish/current
systemctl daemon-reload
systemctl enable sollish-worker.service
systemctl restart sollish-worker.service
SOLLISH_HEALTHY=false
for SOLLISH_ATTEMPT in {1..40}; do
  if systemctl is-active --quiet sollish-worker.service && curl --silent --max-time 1 http://127.0.0.1:8790/health | /opt/sollish/runtime/node-v24.21.0-linux-arm64/bin/node --input-type=module -e 'let s="";for await(const b of process.stdin){s+=b;if(s.length>4096)process.exit(1);}try{const h=JSON.parse(s);if(h.service!=="worker"||typeof h.configured!=="boolean"||typeof h.ready!=="boolean"||h.configured&&!h.ready||!h.configured&&(h.ready||h.lastSuccess!==null||h.keeper!=="disabled-no-deployment-or-fee-key"))process.exit(1);}catch{process.exit(1);}'; then
    SOLLISH_HEALTHY=true
    break
  fi
  sleep 1
done
if [[ "$SOLLISH_HEALTHY" != true ]]; then
  echo 'Health gate did not pass.' >&2
  false # ERR trap restores both the executable and unit, including restart errors.
fi
trap - ERR
systemctl is-active sollish-worker.service
curl --silent --show-error --max-time 2 http://127.0.0.1:8790/health
readlink /opt/sollish/current
REMOTE
