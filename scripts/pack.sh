#!/usr/bin/env bash
# Default: sync into the fixed payload/ directory for "Load unpacked" in chrome://extensions
# --zip: also build the Chrome Web Store upload (dist/pigeon-post-<version>.zip)
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p payload
rsync -a --delete --exclude '.DS_Store' manifest.json _locales src icons payload/
echo "synced payload/"

if [[ "${1:-}" == "--zip" ]]; then
  version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
  mkdir -p dist
  out="dist/pigeon-post-${version}.zip"
  rm -f "$out"
  (cd payload && zip -r "../$out" . -x '*.DS_Store')
  echo "built $out"
fi
