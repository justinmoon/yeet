# yeet Development Plan

## Overview
This document outlines planned improvements to make yeet more robust and production-ready.

---

## 1. Context Window Management ✅ IMPLEMENTED

### Problem
Conversation history grows unbounded → will hit token limits and incur high API costs. Long sessions will eventually fail.

### Solution
- Track token count for entire conversation (use tiktoken or similar)
- Monitor context window usage as percentage
- When approaching limit (e.g., 80% of model's context window):
  - Truncate oldest messages (keep system prompt + last N turns)
  - OR summarize earlier conversation into condensed format
- Display token usage in status bar (e.g., "Tokens: 3.2k/128k (2.5%)")

### Implementation Steps
1. Add token counting utility (tiktoken for OpenAI format)
2. Track tokens per message in conversationHistory
3. Add context window limits per model to registry
4. Implement truncation/summarization strategy
5. Update status bar to show token usage
6. Add warning when approaching limit (e.g., 80%)

### Impact
Makes yeet usable for long sessions without manual intervention or unexpected failures.

---

## 2. File Search Tool ✅ IMPLEMENTED

### Problem
Agent currently uses bash+grep to search files, which is clunky, error-prone, and produces messy output that's hard to parse.

### Solution
Add dedicated `search` tool using ripgrep (already available in environment).

### Tool Specification
```typescript
search({
  pattern: string,        // regex or literal search
  path?: string,          // directory to search (default: cwd)
  file_type?: string,     // filter by extension (js, py, etc)
  context_lines?: number, // lines before/after match
  case_insensitive?: boolean
})
```

Returns structured results:
```typescript
{
  matches: [
    {
      file: "src/agent.ts",
      line: 42,
      content: "export async function* runAgent(",
      context_before: [...],
      context_after: [...]
    }
  ],
  total_matches: 15
}
```

### Implementation Steps
1. Create `src/tools/search.ts` 
2. Use ripgrep via child_process (rg is already installed)
3. Parse rg JSON output format (--json flag)
4. Add tool to agent.ts tool registry
5. Test with various search patterns

### Impact
Better code navigation, cleaner tool output, more reliable than bash scripts.

---

## 3. Conversation Persistence ✅ IMPLEMENTED

### Problem
Closing yeet → lose all context. Must restart from scratch every time, making it impractical for multi-day projects.

### Solution
Auto-save conversations to disk, allow loading previous sessions.

### Features
- Auto-save conversation to `~/.config/yeet/sessions/{timestamp}.json`
- Store full conversation history + model config + attachments
- Commands:
  - `/sessions` - list all saved sessions with preview
  - `/load <id>` - resume a previous session
  - `/save <name>` - name current session for easier reference
  - `/clear` - clear current session (start fresh)
- Auto-save on every message (crash-safe)

### Session Format
```json
{
  "id": "2025-10-27-1745",
  "name": "optional-custom-name",
  "created": "2025-10-27T17:45:00Z",
  "updated": "2025-10-27T18:30:00Z",
  "model": "claude-sonnet-4-5",
  "conversationHistory": [...],
  "totalMessages": 24,
  "totalTokens": 12500
}
```

### Implementation Steps
1. Create `src/sessions.ts` module
2. Add session save/load functions
3. Integrate auto-save into `handleMessage`
4. Add `/sessions`, `/load`, `/save`, `/clear` commands
5. Display current session name in status bar
6. Handle edge cases (corrupted files, old formats)

### Impact
Professional feature that enables long-running projects, debugging across sessions, and better workflow continuity.

---

## Implementation Priority

1. **Context Window Management** - Must have for production use
2. **File Search Tool** - Makes agent significantly more capable  
3. **Conversation Persistence** - Enables real-world workflows

## Notes

- All features should have comprehensive tests
- Consider performance impact of token counting on every message
- Session files should be human-readable JSON for debugging
- May want to add session cleanup (auto-delete old sessions after N days)
