#!/bin/sh
# Tick on Linux / macOS / Raspberry Pi. Needs Node.js 22.13+.
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-fund --no-audit
[ -f web/dist/index.html ] || npm run build
exec npm start
