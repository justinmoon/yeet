#!/usr/bin/env bash
# Migrate yeet config from ~/.yeet to ~/.config/yeet

set -e

OLD_DIR="$HOME/.yeet"
NEW_DIR="$HOME/.config/yeet"

if [ ! -d "$OLD_DIR" ]; then
  echo "No ~/.yeet directory found - nothing to migrate"
  exit 0
fi

echo "Migrating yeet configuration..."
echo "  From: $OLD_DIR"
echo "  To:   $NEW_DIR"

# Create new directory
mkdir -p "$NEW_DIR"

# Move config.json if it exists
if [ -f "$OLD_DIR/config.json" ]; then
  if [ -f "$NEW_DIR/config.json" ]; then
    echo "  ⚠️  $NEW_DIR/config.json already exists, keeping backup at $OLD_DIR/config.json"
    mv "$OLD_DIR/config.json" "$OLD_DIR/config.json.old"
  else
    echo "  ✓ Moving config.json"
    mv "$OLD_DIR/config.json" "$NEW_DIR/config.json"
  fi
fi

# Move debug.log if it exists
if [ -f "$OLD_DIR/debug.log" ]; then
  echo "  ✓ Moving debug.log"
  mv "$OLD_DIR/debug.log" "$NEW_DIR/debug.log"
fi

# Move any other files
for file in "$OLD_DIR"/*; do
  if [ -f "$file" ]; then
    filename=$(basename "$file")
    echo "  ✓ Moving $filename"
    mv "$file" "$NEW_DIR/$filename"
  fi
done

# Remove old directory if empty
if [ -z "$(ls -A "$OLD_DIR")" ]; then
  echo "  ✓ Removing empty $OLD_DIR"
  rmdir "$OLD_DIR"
else
  echo "  ℹ️  $OLD_DIR is not empty, keeping it"
  echo "     Remaining files:"
  ls -la "$OLD_DIR"
fi

echo "✓ Migration complete!"
echo ""
echo "New directory structure:"
ls -lah "$NEW_DIR"
