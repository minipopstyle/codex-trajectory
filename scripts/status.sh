#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
if pgrep -f "$ROOT/src/host.mjs" >/dev/null 2>&1; then echo "运行中"; else echo "未运行"; fi
if curl -sf http://127.0.0.1:9341/json/list >/dev/null 2>&1; then echo "Codex CDP: 9341 已开放"; else echo "Codex CDP: 9341 未开放"; fi
