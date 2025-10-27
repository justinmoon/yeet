# Yeet - Minimal TUI Coding Agent

A minimal Terminal User Interface (TUI) coding agent built with OpenTUI and Vercel AI SDK.

## Features

- 🎨 Clean TUI interface with OpenTUI
- 🤖 AI-powered code assistance
- 🔧 Essential tools: read, write, edit, bash
- ⚡ Fast and minimal (~300 LOC)
- 🧪 Well-tested

## Installation

```bash
# Clone and install
cd ~/code/yeet
bun install

# Config is created automatically on first run!
# It will copy credentials from OpenCode if available
# (~/.local/share/opencode/auth.json)
```

## Usage

```bash
# Run directly
bun run src/index.ts

# Or build and run
bun run build
./yeet
```

### Keyboard Shortcuts

- **Enter**: Send message to agent
- **Shift+Enter**: New line (multiline messages)
- **Ctrl+C**: Exit

## Tools

### bash
Execute shell commands in the current directory.

```typescript
bash({ command: "ls -la" })
```

### read
Read file contents.

```typescript
read({ path: "./src/index.ts" })
```

### edit
Edit files by replacing text.

```typescript
edit({
  path: "./src/app.ts",
  oldText: "const port = 3000",
  newText: "const port = 8080"
})
```

### write
Create new files.

```typescript
write({
  path: "./new-file.ts",
  content: "export const greeting = 'Hello'"
})
```

## Configuration

Config file: `~/.yeet/config.json`

### OpenCode Zen

Yeet uses [OpenCode Zen](https://opencode.ai/docs/zen/) models. Get your API key at [opencode.ai/auth](https://opencode.ai/auth).

**Available models:**
- `grok-code` - FREE (fast, good for testing)
- `qwen3-coder` - $0.45/$1.50 per 1M tokens (480B parameters, excellent for coding)
- `kimi-k2` - $0.60/$2.50 per 1M tokens (great balance of speed/quality)
- Plus GPT-5, Claude models - see [full pricing](https://opencode.ai/docs/zen/#pricing)

**Automatic Setup**: On first run, yeet automatically:
- Looks for OpenCode credentials in `~/.local/share/opencode/auth.json`
- Copies the API key if found
- Creates `~/.yeet/config.json` with secure permissions (600)
- Shows a success message

**Manual Setup** (if auto-detection fails):

```bash
mkdir -p ~/.yeet
cat > ~/.yeet/config.json << 'EOF'
{
  "opencode": {
    "apiKey": "your-opencode-zen-api-key",
    "baseURL": "https://opencode.ai/zen/v1",
    "model": "grok-code"
  },
  "maxSteps": 5,
  "temperature": 0.3
}
EOF
chmod 600 ~/.yeet/config.json
```

**Model Selection**: Just change the `model` field to try different models:
- Start with `grok-code` (free!)
- Upgrade to `qwen3-coder` for production use
- Try `kimi-k2` for a good balance

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Run in dev mode
bun run dev
```

## Architecture

- **OpenTUI**: Terminal rendering (TextareaRenderable, TextRenderable, BoxRenderable)
- **Vercel AI SDK**: Agent loop with streaming
- **Tools**: Minimal set (bash, read, edit, write)
- **Single process**: No client/server split

## Testing

Tests are written using Bun's built-in test framework:

```bash
bun test
```

Test coverage includes:
- All four tools (bash, read, edit, write)
- Unicode/emoji handling
- Error cases
- Multiline content

## Differences from OpenCode

| Feature | OpenCode | Yeet |
|---------|----------|------|
| Architecture | Go TUI + Node.js server | Single TypeScript process |
| Session management | Full sessions, history | No sessions, ephemeral |
| Tools | 15+ tools | 4 tools |
| Models | 20+ models | 1 model |
| UI | Multi-pane, tabs | Single input/output |
| Codebase | ~50K LOC | ~300 LOC |
| Purpose | Production agent | Learning/experimentation |

## License

MIT
