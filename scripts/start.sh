#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
USER_HOME="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory | awk '{print $2}')"
STATE="$USER_HOME/Library/Application Support/CodexTrajectory"
mkdir -p "$STATE"
PORT="${CODEX_TRAJECTORY_CDP_PORT:-9341}"
if ! curl -sf "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1; then
  /usr/bin/open -na /Applications/ChatGPT.app --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="$PORT"
  for _ in {1..10}; do
    curl -sf "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1 || { echo "Codex 已在运行且未开放 $PORT；请先手动退出 Codex，再重新运行本脚本。"; exit 2; }
fi
pgrep -f '([Cc]odex-[Tt]rajectory)/src/host\.mjs' >/dev/null 2>&1 && "$ROOT/scripts/stop.sh"
NODE="${CODEX_TRAJECTORY_NODE:-$(command -v node)}"
nohup "$NODE" "$ROOT/src/host.mjs" >"$STATE/trajectory.log" 2>&1 &
chmod 600 "$STATE/trajectory.log"
echo "Trajectory 已启动；日志：$STATE/trajectory.log"
