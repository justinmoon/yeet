#!/usr/bin/env just --justfile

# Show available commands
default:
    @just --list

# Run all CI checks
ci:
    nix run .#ci

# Run development server
dev:
    bun run dev

# Run tests
test:
    bun test

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
