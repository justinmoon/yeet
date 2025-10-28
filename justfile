#!/usr/bin/env just --justfile

# Show available commands
default:
    @just --list

# Run all CI checks
ci:
    nix run .#ci

# Run GUI dev server (starts both API and Vite)
gui:
    bash scripts/gui.sh

# Stop GUI services
stop-gui:
    @echo "Stopping GUI services..."
    @-lsof -ti:3457 | xargs kill -9 2>/dev/null || true
    @-lsof -ti:3456 | xargs kill -9 2>/dev/null || true
    @echo "✓ GUI services stopped"

# Run yeet TUI
tui:
    bun run src/tui.ts

# Run yeet Web UI (adapter-based, for custom UI)
web:
    bun run src/web.ts

# Run yeet Web UI (streams actual TUI to browser)
web-pty:
    bun run src/web-pty.ts

# Run tests
test:
    bun test

# Run Playwright tests for web UI
test-web:
    bunx playwright test

# Run GUI Playwright tests (auto-starts Vite server)
test-gui:
    bunx playwright test --config=playwright.gui.config.ts

# Type check
typecheck:
    bun run typecheck

# Lint code
lint:
    bun run lint

# Format code
fmt:
    bun run fmt

# Format check (CI)
fmt-check:
    bun run fmt:check

# Install dependencies
install:
    bun install

# Build project
build:
    bun run build

# Clean build artifacts
clean:
    rm -rf dist node_modules

# Update dependencies
update:
    bun update

# Show environment info
env:
    @echo "⚡ TypeScript/Bun Environment"
    @echo "=============================="
    @bun --version
    @node --version
    @echo ""
    @echo "Project: $(basename $(pwd))"
