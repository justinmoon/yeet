#!/usr/bin/env bash
set -euo pipefail

YEET_DIR="${YEET_DIR:-$HOME/code/yeet}"
ORIGINAL_PWD="$(pwd)"

# Check if first arg is --worktree or -w
if [[ "${1-}" == "--worktree" || "${1-}" == "-w" ]]; then
  shift
  WORKTREE_BASE="$YEET_DIR/worktrees"
  if [[ -d "$WORKTREE_BASE" ]]; then
    if ! command -v fzf >/dev/null 2>&1; then
      echo "fzf not found; install fzf to select a worktree" >&2
      exit 1
    fi
    SELECTED=$(ls -1dt "$WORKTREE_BASE"/*/ 2>/dev/null | \
      sed "s|$HOME|~|g" | sed 's|/$||' | \
      fzf --prompt "Select yeet worktree: " --height 40% --reverse)

    if [[ -n "${SELECTED:-}" ]]; then
      # Expand ~ back to $HOME
      YEET_DIR="${SELECTED/#\~/$HOME}"
    else
      echo "No worktree selected, exiting"
      exit 1
    fi
  else
    echo "Worktree directory $WORKTREE_BASE does not exist" >&2
    exit 1
  fi
fi

if [[ ! -d "$YEET_DIR" ]]; then
  echo "Yeet directory $YEET_DIR does not exist" >&2
  exit 1
fi

if git -C "$YEET_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD_HASH=$(git -C "$YEET_DIR" rev-parse HEAD 2>/dev/null || true)
  MASTER_HASH=$(git -C "$YEET_DIR" rev-parse master 2>/dev/null || true)
  BRANCH_NAME=$(git -C "$YEET_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || "detached")
  if [[ -n "$MASTER_HASH" && "$HEAD_HASH" != "$MASTER_HASH" ]]; then
    SHORT_HEAD=$(git -C "$YEET_DIR" rev-parse --short=8 HEAD 2>/dev/null || echo "$HEAD_HASH")
    SHORT_MASTER=$(git -C "$YEET_DIR" rev-parse --short=8 master 2>/dev/null || echo "$MASTER_HASH")
    echo "warning: yeet is on ${BRANCH_NAME:-unknown} ($SHORT_HEAD), local master is $SHORT_MASTER" >&2
  fi
fi

cd "$YEET_DIR"

export YEET_ORIGINAL_PWD="$ORIGINAL_PWD"

PRELOAD_PATH="$YEET_DIR/scripts/restore-cwd.ts"
PRELOAD_ARG=()
if [[ -f "$PRELOAD_PATH" ]]; then
  PRELOAD_ARG=(--preload "$PRELOAD_PATH")
fi

exec bun run "${PRELOAD_ARG[@]}" src/index.ts -- "$@"
