#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${YEET_INSTALL_PATH:-$HOME/configs/bin/yeet}"

mkdir -p "$(dirname "$TARGET")"

chmod +x "$ROOT_DIR/scripts/yeet.sh"

ln -sf "$ROOT_DIR/scripts/yeet.sh" "$TARGET"

echo "Installed yeet launcher to $TARGET"
