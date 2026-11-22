#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
destination=${1:-"$repo/dist"}
mkdir -p "$destination"
destination=$(cd "$destination" && pwd)
version=$(cat "$repo/VERSION")
[[ $version =~ ^[0-9]+\.[0-9]+$ ]]
archive="knowbox-explorer-v$version.tar.gz"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/package/knowbox-explorer"
cp -R -- "$repo/web" "$stage/package/knowbox-explorer/"
cp -- "$repo/VERSION" "$repo/README.md" "$stage/package/knowbox-explorer/"
tar --sort=name --mtime='1970-01-01 UTC' --owner=0 --group=0 --numeric-owner \
  -czf "$stage/$archive" -C "$stage/package" knowbox-explorer
tar -tzf "$stage/$archive" | awk '
  $0 == "knowbox-explorer/web/index.html" { page=1 }
  $0 == "knowbox-explorer/web/app.js" { script=1 }
  END { exit ! (page && script) }
'
cp -- "$stage/$archive" "$destination/$archive"
(cd "$destination" && sha256sum -- "$archive" > "$archive.sha256")
printf '%s\n' "$destination/$archive"
