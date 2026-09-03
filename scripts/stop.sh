#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
pkill -TERM -f '([Cc]odex-[Tt]rajectory)/src/host\.mjs' >/dev/null 2>&1 || true
echo "Trajectory 已停止；Codex 与其他皮肤进程未处理"
