# Yeet Conversation History UI Improvement Specification

## Executive Summary

This spec proposes a redesigned conversation history display for yeet that draws inspiration from both **opencode** (TypeScript/Node.js) and **codex** (Rust/Ratatui). The goal is to create a visually rich, scannable interface that clearly differentiates message types, tool calls, and results while maintaining terminal compatibility.

---

## 1. Current State Analysis

### What Yeet Has Now:
- Plain text rendering via `@opentui/core`
- No color differentiation between message types
- Basic prefixes: `"You: "` and `"Assistant: "`
- Tool calls shown as `[bash] command`
- Results indicated with emoji (✓, ❌, ⚠️)
- 60-character separator line: `─────...`
- No markdown rendering (raw text only)
- No syntax highlighting

### Key Pain Points:
1. **Visual flatness** - everything looks the same
2. **Hard to scan** - user vs assistant messages blend together
3. **Tool calls lost in noise** - no visual hierarchy
4. **No markdown rendering** - code blocks, lists, etc. render as plain text
5. **Minimal spacing** - cramped appearance

---

## 2. Color System Design

### 2.1 Approach: Adaptive Terminal Colors

Following **codex's** intelligent color detection model rather than hardcoded themes:

```typescript
// Terminal background detection
interface ColorScheme {
  isDark: boolean;
  terminalBg: RGB | null;

  // Semantic colors that adapt to terminal
  userMessageBg: Color;
  assistantMessageBg: Color;
  toolCallBg: Color;

  // Text colors
  userPrefix: Color;
  assistantPrefix: Color;
  dimText: Color;
  highlightText: Color;

  // Status colors
  success: Color;
  error: Color;
  warning: Color;
  info: Color;
}
```

### 2.2 Color Palette (from codex)

**For Dark Terminals:**
- User message bg: Blend(white, terminal_bg, 0.1) // 10% lighter
- User prefix: Bold cyan (`\x1b[1;36m`)
- Assistant prefix: Dim bullet `•` (`\x1b[2m`)
- Tool call bg: Slight yellow tint (0.05 opacity)
- Code blocks: Syntax highlighted using tree-sitter

**For Light Terminals:**
- User message bg: Blend(black, terminal_bg, 0.1) // 10% darker
- User prefix: Bold blue
- Assistant prefix: Dim gray bullet
- Tool call bg: Light blue tint

### 2.3 Fallback for Limited Color Support

Detect terminal capabilities:
- **True Color (16M colors)**: Full gradient backgrounds, syntax highlighting
- **256 colors**: Simplified palette with closest color matching
- **16 colors (basic)**: Use only bold, dim, underline for differentiation
- **No color**: Rely purely on spacing and prefixes

---

## 3. Message Type Differentiation

### 3.1 User Messages

**Inspired by codex's prefix-based system:**

```
┌─────────────────────────────────────
│ › Help me implement a new feature
│   that handles user authentication
└─────────────────────────────────────
```

**Rendering specs:**
- **Prefix**: `› ` (right arrow, bold + cyan)
- **Background**: Subtle color (10% blend from terminal)
- **Border**: Optional left border (single line: `│`)
- **Spacing**: 1 blank line before, 1 blank line after
- **Wrapping**: Preserve indentation on wrapped lines with `  ` (2 spaces)

**Code:**
```typescript
function renderUserMessage(text: string): string {
  const prefix = chalk.bold.cyan('› ');
  const continuation = '  ';
  const lines = wordWrap(text, termWidth - 4);

  return [
    '',  // blank line before
    lines.map((line, i) =>
      i === 0 ? prefix + line : continuation + line
    ).join('\n'),
    '',  // blank line after
  ].join('\n');
}
```

### 3.2 Assistant Messages

**Inspired by both opencode and codex:**

```
• Here's how I can help with that.

  Let me break this down into steps:
  1. First, we'll create the auth module
  2. Then configure the middleware
```

**Rendering specs:**
- **Prefix**: `• ` (bullet point, dimmed)
- **No background** (cleaner look per codex's approach)
- **Spacing**: Continues flow naturally, no extra blank lines unless paragraph break
- **Streaming**: First chunk gets bullet, subsequent chunks continue seamlessly
- **Markdown**: Full rendering (see section 4)

**Code:**
```typescript
interface StreamState {
  isFirstChunk: boolean;
}

function renderAssistantChunk(text: string, state: StreamState): string {
  if (state.isFirstChunk) {
    state.isFirstChunk = false;
    return chalk.dim('• ') + renderMarkdown(text);
  }
  return renderMarkdown(text);
}
```

### 3.3 Tool Calls

**Major upgrade inspired by opencode's decorator pattern:**

```
┌─ bash ───────────────────────────────
│ npm install chalk
│
│ ✓ Exit code: 0
│
│ added 5 packages in 2.1s
│ ...
└──────────────────────────────────────
```

**Rendering specs:**
- **Header**: Tool name in box decoration with icon
- **Command/Args**: Syntax highlighted based on tool type
- **Output**: Dimmed, truncated to 5 lines with expand option
- **Status**: Colored icon (✓ green, ❌ red, ⏳ spinner)
- **Collapsible**: Show first/last 5 lines if >10 lines total

**Tool-specific rendering (from opencode):**

| Tool | Icon | Header Color | Body Treatment |
|------|------|--------------|----------------|
| `bash` | `$` | Yellow | Syntax highlight command, dim output |
| `read` | `📖` | Blue | Show path with line range |
| `write` | `📝` | Green | Show path + byte count |
| `edit` | `✏️` | Cyan | Show diff with +/- highlighting |
| `search` | `🔍` | Magenta | Show match count + file list |
| `task` | `🤖` | Purple | Show agent type + status |

**Code example:**
```typescript
function renderToolCall(tool: ToolCall): string {
  const icon = TOOL_ICONS[tool.name] || '•';
  const header = chalk.bold(`┌─ ${icon} ${tool.name} `).padEnd(60, '─');

  let body: string;
  switch (tool.name) {
    case 'bash':
      body = highlightBash(tool.args.command);
      break;
    case 'read':
      body = `${tool.args.path}:${tool.args.offset || 1}`;
      break;
    // ... other tools
  }

  return [
    header,
    `│ ${body}`,
    `└${'─'.repeat(58)}`,
  ].join('\n');
}
```

### 3.4 Tool Results

**Compact and scannable:**

```
  ✓ Read /Users/justin/code/yeet/src/config.ts

  ❌ Command failed with exit code 1
     │ Error: ENOENT: no such file or directory
     │ at Object.readFileSync (node:fs:433:20)
```

**Rendering specs:**
- **Success**: Green checkmark, single line summary
- **Error**: Red X, multi-line with indented error details
- **Warning**: Yellow triangle, inline with context
- **Info**: Blue dot, subtle

---

## 4. Markdown Rendering

### 4.1 Core Features (from opencode's markdown renderer)

**Supported elements:**
- **Headings**: Bold + larger spacing
- **Code blocks**: Fenced with language detection → syntax highlighting
- **Inline code**: Background color + monospace
- **Lists**: Proper nesting with `  -`, `  •`, `  ◦` for levels 1-3
- **Bold/Italic**: Terminal escape codes
- **Links**: Cyan underline with URL
- **Blockquotes**: Left border `│` with indentation
- **Horizontal rules**: `───` full width

**Example transformation:**

Input markdown:
````markdown
Here's a bash example:

```bash
npm install chalk
```

This will:
- Install the package
- Update package.json
````

Output (with ANSI codes):
```
Here's a bash example:

┌─ bash ──────────────────
│ npm install chalk
└─────────────────────────

This will:
  • Install the package
  • Update package.json
```

### 4.2 Syntax Highlighting (from codex)

Use **tree-sitter** for bash (most common), fallback to simple regex for others:

**Bash highlighting categories:**
- Comments: Dim gray
- Strings: Dim (subtle, not distracting)
- Keywords: Default (bold)
- Commands/Functions: Default
- Operators: Dim
- Variables: Default

**Code:**
```typescript
import { Parser } from 'tree-sitter';
import Bash from 'tree-sitter-bash';

function highlightBash(code: string): string {
  const parser = new Parser();
  parser.setLanguage(Bash);
  const tree = parser.parse(code);

  // Walk tree and apply ANSI codes based on node types
  return applyHighlighting(code, tree);
}
```

---

## 5. Spacing and Layout Strategy

### 5.1 Vertical Rhythm (inspired by codex)

**Spacing rules:**
- User message: `\n` before, `\n` after
- Assistant message start: No extra space (flows naturally)
- Between assistant paragraphs: `\n\n` (detected from markdown)
- Tool calls: `\n` before, `\n` after result
- Section separator: `\n` + line + `\n`

**Visual hierarchy:**
```
                                    ← baseline
─────────────────────────────       ← separator (60 chars)
                                    ← 1 line space
› User asks a question              ← user prefix (bold cyan)
  that spans multiple lines         ← continuation (2 spaces)
                                    ← 1 line space
• Assistant responds with           ← assistant prefix (dim)
  helpful information.              ← natural flow

┌─ $ bash ──────────────            ← tool decoration
│ ls -la
│
│ ✓ Exit code: 0                    ← status
│
│ total 48                          ← output (dimmed)
│ drwxr-xr-x  12 justin  staff  384
└────────────────────────
                                    ← 1 line space
```

### 5.2 Horizontal Layout

**Constraints:**
- Min width: 60 chars
- Max width: 120 chars (or terminal width - 4)
- Left margin: 0 (use prefixes instead of full-width indentation)
- Right margin: 2 chars for padding

**Wrapping:**
- Use **word wrap** with proper indent continuation
- Code blocks: Horizontal scroll or truncate with `…`
- File paths: Center-truncate (`/very/long/…/file.ts`)

---

## 6. Tool Call UI Enhancements

### 6.1 Collapsible Long Output

When tool output exceeds 10 lines:

**Collapsed state (default):**
```
┌─ $ bash ─────────────────────────
│ npm test
│
│ ✓ 45 passing
│ ⏳ Running... (showing 5/127 lines)
│
│ [Press 't' to expand output]
└──────────────────────────────────
```

**Expanded state (after user presses 't'):**
```
┌─ $ bash ─────────────────────────
│ npm test
│
│ ... (127 lines total, showing all)
│
│ ✓ Test suite 1
│   ✓ should pass
│   ✓ another test
│ ...
│
│ ✓ 45 passing
└──────────────────────────────────
```

### 6.2 Animated Spinners (from codex)

While tool is running:

```
┌─ $ bash ─────────────────────────
│ npm install
│
│ ⏳ Running... [●∙∙∙]  1.2s
└──────────────────────────────────
```

**Spinner frames (for True Color terminals):**
- Use shimmer effect with color gradient
- Fallback: `[●∙∙∙] [∙●∙∙] [∙∙●∙] [∙∙∙●]` rotation

### 6.3 Diff Rendering for Edit Tool

When `edit` tool is called:

```
┌─ ✏️  edit ───────────────────────
│ src/config.ts
│
│ - const timeout = 30000;
│ + const timeout = 60000;
│
│ ✓ 1 replacement
└──────────────────────────────────
```

**Color coding:**
- Removals: Red with `-` prefix
- Additions: Green with `+` prefix
- Context: Dim gray

---

## 7. User Message Prominence

### 7.1 Design Goal

User messages should immediately stand out when scrolling through history.

### 7.2 Techniques (combined from opencode + codex)

**Visual weight stack:**
1. **Background color** (subtle 10% blend)
2. **Left border** (optional, `│` in accent color)
3. **Prefix** (bold `› ` in cyan)
4. **Spacing** (surrounded by blank lines)

**Example with all features:**
```
                                    ← space before
│ › Create a new authentication     ← left border + bold prefix + bg color
│   module using JWT tokens         ← continuation with same treatment
                                    ← space after
```

**Code:**
```typescript
function renderUserMessage(text: string, scheme: ColorScheme): string {
  const bg = scheme.userMessageBg;
  const border = chalk.cyan('│ ');
  const prefix = chalk.bold.cyan('› ');
  const continuation = '  ';

  const lines = wordWrap(text, termWidth - 4);

  return [
    '',
    lines.map((line, i) => {
      const indent = i === 0 ? prefix : continuation;
      const styledLine = bg ? chalk.bgHex(bg)(line) : line;
      return border + indent + styledLine;
    }).join('\n'),
    '',
  ].join('\n');
}
```

---

## 8. Implementation Plan

### Phase 1: Foundation (Week 1)

**Tasks:**
1. Add color dependencies:
   ```bash
   bun add chalk ansi-styles supports-color
   ```

2. Create color system:
   - `src/ui/colors.ts` - Terminal detection, adaptive palette
   - `src/ui/styles.ts` - Semantic color functions

3. Update message rendering in `backend.ts`:
   - Apply colors to user/assistant prefixes
   - Add background colors for user messages
   - Implement spacing rules

**Deliverables:**
- ✅ Colored prefixes working
- ✅ User messages have subtle background
- ✅ Proper vertical spacing

### Phase 2: Markdown + Tool Rendering (Week 2)

**Tasks:**
1. Add markdown renderer:
   ```bash
   bun add marked terminal-kit
   ```

2. Create `src/ui/markdown.ts`:
   - Parse markdown from assistant responses
   - Render with ANSI codes
   - Handle code blocks specially

3. Upgrade tool rendering in `backend.ts`:
   - Add box decorations around tool calls
   - Implement tool-specific icons/colors
   - Add collapsible output logic

**Deliverables:**
- ✅ Markdown renders properly (bold, italic, lists, code blocks)
- ✅ Tool calls have decorative boxes
- ✅ Long output is truncated with expand option

### Phase 3: Syntax Highlighting (Week 3)

**Tasks:**
1. Add syntax highlighting:
   ```bash
   bun add tree-sitter tree-sitter-bash
   ```

2. Create `src/ui/highlight.ts`:
   - Bash syntax highlighting with tree-sitter
   - Fallback regex highlighter for other languages

3. Integrate into markdown renderer for code blocks

**Deliverables:**
- ✅ Bash code blocks are syntax highlighted
- ✅ Other languages have basic highlighting

### Phase 4: Polish + Advanced Features (Week 4)

**Tasks:**
1. Animated spinners for running tools
2. Diff rendering for edit tool
3. Interactive expand/collapse (if feasible in TUI)
4. Performance optimization (cache parsed markdown)

**Deliverables:**
- ✅ Smooth animations
- ✅ Clean diff display
- ✅ Snappy rendering even with long history

---

## 9. Technical Considerations

### 9.1 Performance

**Caching strategy (from opencode):**
- Cache parsed markdown with message hash
- Invalidate only when message content changes
- Limit cache size to 100 messages

### 9.2 Terminal Compatibility

**Graceful degradation:**
```typescript
const terminalCaps = {
  trueColor: checkTrueColorSupport(),
  color256: check256ColorSupport(),
  basicColor: checkBasicColorSupport(),
  noColor: process.env.NO_COLOR === '1',
};

function getColorScheme(): ColorScheme {
  if (terminalCaps.noColor) return monochromeScheme;
  if (terminalCaps.trueColor) return fullColorScheme;
  if (terminalCaps.color256) return limited256Scheme;
  return basicColorScheme;
}
```

### 9.3 Accessibility

- **Never rely on color alone** - always use icons + text
- **High contrast mode** - increase color difference when detected
- **Configurable colors** - allow users to override via config file

---

## 10. Configuration File

Allow users to customize via `~/.config/yeet/ui.json`:

```json
{
  "colors": {
    "userPrefix": "#00D9FF",
    "assistantPrefix": "#808080",
    "success": "#00FF00",
    "error": "#FF0000",
    "warning": "#FFAA00"
  },
  "spacing": {
    "beforeUser": 1,
    "afterUser": 1,
    "beforeTool": 1,
    "afterTool": 1
  },
  "toolOutput": {
    "maxLines": 5,
    "collapsible": true,
    "showTimestamp": false
  },
  "markdown": {
    "syntaxHighlight": true,
    "renderTables": true,
    "inlineImages": false
  }
}
```

---

## 11. Inspiration Summary

### From OpenCode:
- ✅ Theme system with adaptive colors
- ✅ Decorator pattern for tool calls (boxes around content)
- ✅ Markdown rendering with syntax highlighting
- ✅ Caching strategy for performance
- ✅ Specialized rendering per tool type

### From Codex:
- ✅ Prefix-based message differentiation (`›` vs `•`)
- ✅ Intelligent terminal background detection
- ✅ Clean spacing with blank lines
- ✅ Tree-sitter syntax highlighting for bash
- ✅ Adaptive color blending (10% opacity overlays)
- ✅ Graceful fallback for limited color terminals

### Yeet's Unique Twist:
- Leverage `@opentui/core` for terminal rendering
- Keep it minimal - no theme picker, just smart defaults
- Focus on scanability - conversation history should be easy to navigate
- Preserve simplicity - don't over-engineer

---

## 12. Before/After Comparison

### BEFORE (Current Yeet):
```
────────────────────────────────────────────────────────────

You: help me add authentication
Assistant: Sure\! I can help with that.

[bash] npm install passport
✓ Read package.json
[write] src/auth/index.ts
✓ Created src/auth/index.ts

I've created a basic auth module.
```

### AFTER (Proposed Yeet with Improvements):
```
─────────────────────────────────

› Help me add authentication

• Sure\! I can help with that.

┌─ $ bash ────────────────────
│ npm install passport
│
│ ✓ Exit code: 0
│
│ + passport@0.7.0
└─────────────────────────────

  📖 Read package.json
  ✓ Success

┌─ ✏️ edit ───────────────────
│ src/auth/index.ts
│
│ + export { initAuth } from './passport';
│ + export { authMiddleware } from './middleware';
│
│ ✓ 2 lines added
└─────────────────────────────

  I've created a basic auth module with:
  • Passport configuration
  • JWT middleware
  • Session management
```

**Key improvements visible:**
1. ✅ User message has distinct prefix (`›`) and spacing
2. ✅ Tool calls have decorative boxes with icons
3. ✅ Clear visual hierarchy between message types
4. ✅ Results are compact and scannable
5. ✅ Better spacing throughout

---

## 13. Research Sources

This specification is based on detailed analysis of:

### OpenCode (`~/code/opencode`)
- **Key files analyzed:**
  - Message rendering system with theme support
  - Tool decorator patterns
  - Markdown renderer implementation
  - Cache strategy for performance

- **Strengths to adopt:**
  - Comprehensive theme system (9 built-in themes)
  - Specialized rendering per tool type
  - Shimmer animations for thinking blocks
  - Hash-based content caching

### Codex (`~/code/codex`)
- **Key files analyzed:**
  - `codex-rs/tui/src/history_cell.rs` - Core rendering trait system
  - `codex-rs/tui/src/style.rs` - Adaptive color detection
  - `codex-rs/tui/src/markdown_render.rs` - Markdown to terminal
  - `codex-rs/tui/src/render/highlight.rs` - Tree-sitter syntax highlighting

- **Strengths to adopt:**
  - Simple prefix-based differentiation
  - Terminal background color detection
  - Clean vertical rhythm with strategic spacing
  - Graceful degradation for limited terminals

---

## 14. Next Steps

1. **Review & Feedback** - Share this spec with team/users for input
2. **Prototype Phase 1** - Start with colors and prefixes (quick win)
3. **User Testing** - Get feedback on color choices and spacing
4. **Iterate** - Refine based on real-world usage
5. **Roll Out Phases** - Ship incrementally (colors → markdown → syntax)

---

## 15. Success Metrics

How we'll know this worked:
- ✅ Users can quickly scan history and find their messages
- ✅ Tool call results are immediately understandable
- ✅ Markdown renders correctly without manual formatting
- ✅ Terminal compatibility maintained across environments
- ✅ No performance regressions (< 50ms to render any message)
- ✅ Positive user feedback on readability

---

**Document Status:** Draft v1.0  
**Last Updated:** 2025-11-02  
**Author:** Research conducted via Claude Code
# Test commit to verify forge is working
