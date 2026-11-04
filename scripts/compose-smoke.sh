#!/usr/bin/env bash
# Boots the real docker compose stack and checks the V2 acceptance criteria that need it.
# The rig data directory is a mktemp dir under /tmp and is left for the OS to clean up.
set -euo pipefail
cd "$(dirname "$0")/.."

export RIG_HOST_PORT="${RIG_HOST_PORT:-17878}"
export RIG_DATA="$(mktemp -d)"
export RIG_UID="$(id -u)" RIG_GID="$(id -g)"
base="http://127.0.0.1:${RIG_HOST_PORT}"
trap 'docker compose down -v >/dev/null 2>&1 || true' EXIT

docker compose up -d --build

echo "waiting for the daemon..."
for _ in $(seq 1 60); do [ -s "$RIG_DATA/.rig/token" ] && break; sleep 1; done
[ -s "$RIG_DATA/.rig/token" ] || { echo "FAIL: no token file"; docker compose logs rig | tail -20; exit 1; }
token="$(cat "$RIG_DATA/.rig/token")"
for _ in $(seq 1 30); do
  curl -sf -H "Authorization: Bearer $token" "$base/api/health" >/dev/null && break; sleep 1
done

code="$(curl -s -o /dev/null -w '%{http_code}' "$base/api/boards")"
[ "$code" = "401" ] || { echo "FAIL: unauthenticated API returned $code, expected 401"; exit 1; }
echo "ok: API rejects requests without the token"

pub="$(docker compose port rig 7878)"
case "$pub" in 127.0.0.1:*) echo "ok: published on $pub" ;; *) echo "FAIL: published on $pub"; exit 1 ;; esac

lan_ip="$(hostname -I | awk '{print $1}')"
if [ -n "$lan_ip" ] && curl -s --max-time 3 -o /dev/null "http://${lan_ip}:${RIG_HOST_PORT}/"; then
  echo "FAIL: daemon reachable on non-loopback address $lan_ip"; exit 1
fi
echo "ok: not reachable on ${lan_ip:-<no lan address>}"

curl -sf "$base/" | grep -q 'name="rig-token"' || { echo "FAIL: UI not served with a session token"; exit 1; }
echo "ok: UI served"

# generated modules go through the sandbox inside the image: a good one is kept, one reaching for the host is refused
module() { # $1 = body of process(); prints the HTTP status
  node -e 'const b=process.argv[1];process.stdout.write(JSON.stringify({source:`return {id:"smoke-fx@1",name:"Smoke",category:"drive",description:"t",params:[{id:"a",label:"A",min:0,max:1,default:0.5,unit:"",taper:"linear"}],create(){return {process(input,output,p){${b}}}}};`}))' "$1" |
    curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" -H 'content-type: application/json' --data-binary @- "$base/api/modules"
}
code="$(module 'process.binding("fs"); output.set(input);')"
[ "$code" = "422" ] || { echo "FAIL: a module reaching for process returned $code, expected 422"; exit 1; }
code="$(module 'for (let i = 0; i < input.length; i++) output[i] = input[i] * (0.5 + p.a);')"
[ "$code" = "200" ] || { echo "FAIL: a good module returned $code, expected 200"; docker compose logs rig | tail -20; exit 1; }
echo "ok: sandbox refuses a hostile module and accepts a good one"

RIG_URL="$base" RIG_TOKEN="$token" pnpm --filter @rig/web exec playwright test daemon-ui
echo "compose smoke passed"
