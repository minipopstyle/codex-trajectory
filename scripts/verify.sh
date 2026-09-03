#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
cd "$ROOT"
node --check src/adapter.mjs
node --check src/cdp.mjs
node --check src/renderer.mjs
node --check src/host.mjs
node --check scripts/live-check.mjs
node tests/self-check.mjs
echo "离线验证通过"
