#!/usr/bin/env bash
set -euo pipefail
umask 077
export TZ=Etc/UTC

repo=$(cd "$(dirname "$0")/.." && pwd)
binary=$(realpath "${1:?expected a locally built Knowbox binary}")
assets=$(realpath "${2:-$repo/web}")
work=$(mktemp -d)
server=
cleanup() {
  if [[ -n $server ]]; then docker rm -f "$server" >/dev/null 2>&1 || true; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
browser_image=mcr.microsoft.com/playwright:v1.57.0-noble
if [[ -n ${PLAYWRIGHT_NODE_MODULES:-} ]]; then
  modules=$(realpath "$PLAYWRIGHT_NODE_MODULES")
else
  cp -- "$repo/tests/package.json" "$repo/tests/package-lock.json" "$work/"
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --mount "type=bind,src=$work,dst=/checks" --entrypoint npm \
    "$browser_image" ci --prefix /checks --ignore-scripts --no-audit --no-fund
  modules="$work/node_modules"
fi

for mode in read write; do
  kb="$work/kb-$mode"
  env -u KNOWBOX_ROOT "$binary" init --no-git "$kb"
  body=$'Original claim. Supporting context.\n\n```mermaid\nflowchart LR\n    A[Original] --> B[Result]\n```'
  KNOWBOX_ROOT="$kb" "$binary" new --type fact --domain fixture --title "Initial note" \
    --summary "Initial summary" --body "$body" --no-edit
  printf '## Browser proposal\nA proposal from test input.\n' > "$kb/raw/proposals.md"
  KNOWBOX_ROOT="$kb" KNOWBOX_NO_HEARTBEAT=1 "$binary" sweep
  mount_option=
  serve_flag=
  if [[ $mode == read ]]; then mount_option=,readonly; serve_flag=--read-only; fi
  server="knowbox-browser-$mode-$(basename "$work")"
  docker run -d --name "$server" --network none --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777 --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=bind,src=$kb,dst=/kb$mount_option" \
    --mount "type=bind,src=$assets,dst=/site,readonly" \
    --mount "type=bind,src=$binary,dst=/app/knowbox,readonly" \
    -e HOME=/tmp -e KNOWBOX_ROOT=/kb -e KNOWBOX_NO_HEARTBEAT=1 -e TZ \
    --entrypoint /bin/sh registry.fedoraproject.org/fedora:44 \
    -c "umask 077; exec /app/knowbox serve --assets /site --port 0 $serve_flag >/tmp/launch" >/dev/null
  for attempt in $(seq 1 30); do
    if docker exec "$server" test -s /tmp/launch; then break; fi
    sleep 0.25
  done
  docker exec "$server" cat /tmp/launch >"$work/launch.private"
  if [[ ! -s $work/launch.private ]]; then
    docker logs "$server" >&2
    exit 1
  fi
  timeout 90s docker run --rm --network "container:$server" --shm-size=256m -e KNOWBOX_BROWSER_DEBUG \
    --mount "type=bind,src=$modules,dst=/checks/node_modules,readonly" \
    --mount "type=bind,src=$repo/tests/browser.cjs,dst=/checks/browser.cjs,readonly" \
    --mount "type=bind,src=$work/launch.private,dst=/checks/launch.private,readonly" \
    --entrypoint node "$browser_image" /checks/browser.cjs "$mode"
  docker rm -f "$server" >/dev/null
  server=
done
