#!/bin/zsh
set -euo pipefail
ROOT="${0:A:h:h}"
USER_HOME="${CODEX_TRAJECTORY_HOME:-$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory | awk '{print $2}')}"
DEST="$USER_HOME/.codex/codex-trajectory"
mkdir -p "$USER_HOME/.codex"
mkdir -p "$DEST"
cp -R "$ROOT/src" "$ROOT/ui" "$ROOT/vendor" "$ROOT/scripts" "$ROOT/tests" "$ROOT/package.json" "$ROOT/README.md" "$ROOT/THIRD_PARTY_NOTICES.md" "$DEST/"
chmod +x "$DEST/scripts/"*.sh "$DEST/scripts/"*.command
echo "已安装到 $DEST"
