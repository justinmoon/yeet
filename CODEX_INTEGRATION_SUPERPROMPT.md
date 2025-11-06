# Codex API Integration Superprompt

## Mission

Figure out how to integrate OpenAI's Codex API (ChatGPT Pro OAuth) with tool calling into the "yeet" coding assistant, based on how the `opencode-openai-codex-auth` plugin successfully does it for opencode.

## The Core Problem

**What Works:**
- ✅ OAuth authentication (PKCE flow, token refresh, CSRF protection)
- ✅ Simple API calls WITHOUT tools (e.g., "count r's in strawberry" returns "3")
- ✅ Codex instructions fetching from GitHub with ETag caching

**What Doesn't Work:**
- ❌ Tool calling (bash, read, write, edit) - Codex rejects AI SDK's tool format
- ❌ Streaming responses - Codex uses custom SSE format incompatible with AI SDK

## The Mystery

The `opencode-openai-codex-auth` plugin (included below) claims **"Full tool support"** and is used in production by opencode. The plugin's code at `handleSuccessResponse()` says:

```typescript
// For tool requests, return stream as-is (streamText handles SSE)
return new Response(response.body, {...});
```

**But we've proven AI SDK can't parse Codex's SSE format!** So either:
1. The plugin doesn't actually work with tools (false advertising)
2. Opencode handles streaming differently than yeet
3. There's magic middleware we're missing

## Technical Details

**Codex SSE Format (incompatible with AI SDK):**
```
event: response.created
data: {"type":"response.created","response":{...}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","text":"Hello"}

event: response.done
data: {"type":"response.done","response":{...}}
```

**AI SDK Expected Format:**
```json
{"id":"...","choices":[{"delta":{"content":"Hello"}}]}
```

**Tool Calling Error:**
When sending tools in AI SDK format, Codex returns:
```
400 Bad Request: "Missing required parameter: 'tools[0].name'"
```

## Questions to Answer

1. **Does the plugin actually work with tools?** Or is the "Full tool support" claim incorrect?

2. **How does opencode use the plugin differently than yeet?**
   - Does opencode bypass AI SDK's streaming parser?
   - Does opencode use the custom SSE client in `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts`?
   - Is there middleware transforming responses?

3. **What's the proper way to integrate Codex with AI SDK?**
   - Do we need custom SSE parsing?
   - Do we need to transform tool formats?
   - Is there a way to make AI SDK understand Codex's format?

## Key Architectural Differences

**yeet's approach:**
```typescript
// src/agent.ts
const provider = createOpenAICompatible({
  fetch: customFetch,  // From openai-auth.ts
});

const result = await streamText({
  model: provider(modelName),
  tools: { bash, read, write, edit },  // Standard AI SDK tools
});

// Expects AI SDK to parse streaming response
for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") yield chunk.text;
  if (chunk.type === "tool-call") yield chunk;
}
```

**opencode-openai-codex-auth plugin's approach:**
```typescript
// index.ts - Custom fetch wrapper
async fetch(input, init) {
  // 1. Transform request (add instructions, convert message format)
  const transformation = await transformRequestForCodex(init);

  // 2. Make request to Codex API
  const response = await fetch(url, {headers, body});

  // 3. Handle response
  if (hasTools) {
    // Just return raw SSE stream - claims "streamText handles SSE"
    return new Response(response.body, {...});
  } else {
    // For non-tool requests, convert SSE to JSON
    return await convertSseToJson(response);
  }
}
```

**opencode's architecture:**
- Uses `streamText()` from AI SDK (just like yeet)
- Has custom SSE parser in SDK (`serverSentEvents.gen.ts`)
- Provider system that wraps models

## What We Need

One of these solutions:

**Option A: Understand the plugin's magic**
- How does it actually work with tools if it just returns raw SSE?
- Is there a transformation layer we're missing?

**Option B: Custom SSE parser for yeet**
- Parse Codex SSE format manually
- Transform into AI SDK's expected format
- Handle tool calls specially

**Option C: Different integration approach**
- Don't use AI SDK's streamText
- Direct SSE parsing like opencode's custom client
- Manual tool call handling

---

# Complete Source Code Context

Below are all relevant files from three projects:
1. **yeet** - Our project trying to integrate Codex
2. **opencode-openai-codex-auth** - Working plugin that claims tool support
3. **opencode** - The host application that uses the plugin

---

## YEET PROJECT FILES

This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  - File path as an attribute
  - Full contents of the file
</file_format>

<usage_guidelines>
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.
</usage_guidelines>

<notes>
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: src/openai-auth.ts, src/openai-callback-server.ts, src/codex-instructions.ts, src/agent.ts, src/config.ts, test-openai.ts, test-openai-with-tools.ts, OPENAI_IMPLEMENTATION_STATUS.md, CODEX_INSTRUCTIONS.md, package.json
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)
</notes>

</file_summary>

<directory_structure>
src/
  agent.ts
  codex-instructions.ts
  config.ts
  openai-auth.ts
  openai-callback-server.ts
CODEX_INSTRUCTIONS.md
OPENAI_IMPLEMENTATION_STATUS.md
package.json
test-openai-with-tools.ts
test-openai.ts
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="src/codex-instructions.ts">
/**
 * Codex instructions fetcher
 * Fetches the official Codex prompt from GitHub with ETag-based caching
 * Based on opencode-openai-codex-auth implementation
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { YEET_CONFIG_DIR } from "./config";
import { logger } from "./logger";

// GitHub API and Codex instructions URLs
const GITHUB_API_RELEASES =
  "https://api.github.com/repos/openai/codex/releases/latest";
const CACHE_DIR = join(YEET_CONFIG_DIR, "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_METADATA_FILE = join(CACHE_DIR, "codex-instructions-meta.json");

// Rate limit protection: Only check GitHub if cache is older than 15 minutes
const CACHE_TTL_MS = 15 * 60 * 1000;

interface GitHubRelease {
  tag_name: string;
}

interface CacheMetadata {
  etag: string | null;
  tag: string;
  lastChecked: number;
  url: string;
}

/**
 * Get the latest release tag from GitHub
 */
async function getLatestReleaseTag(): Promise<string> {
  const response = await fetch(GITHUB_API_RELEASES);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest release: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as GitHubRelease;
  return data.tag_name;
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 *
 * This function:
 * - Checks cache age (returns cached if < 15 minutes old)
 * - Fetches latest release tag from GitHub
 * - Uses HTTP conditional requests (If-None-Match) to check for updates
 * - Caches instructions locally with metadata
 * - Falls back to cached version on network errors
 *
 * @returns Codex instructions markdown text
 */
export async function getCodexInstructions(): Promise<string> {
  try {
    // Load cached metadata (includes ETag, tag, and lastChecked timestamp)
    let cachedETag: string | null = null;
    let cachedTag: string | null = null;
    let cachedTimestamp: number | null = null;

    if (existsSync(CACHE_METADATA_FILE)) {
      try {
        const metadataText = await readFile(CACHE_METADATA_FILE, "utf-8");
        const metadata = JSON.parse(metadataText) as CacheMetadata;
        cachedETag = metadata.etag;
        cachedTag = metadata.tag;
        cachedTimestamp = metadata.lastChecked;
      } catch (error) {
        logger.warn("Failed to parse cache metadata", {
          error: String(error),
        });
      }
    }

    // Rate limit protection: If cache is less than 15 minutes old, use it
    if (
      cachedTimestamp &&
      Date.now() - cachedTimestamp < CACHE_TTL_MS &&
      existsSync(CACHE_FILE)
    ) {
      logger.debug("Using cached Codex instructions (cache is fresh)");
      return await readFile(CACHE_FILE, "utf-8");
    }

    // Get the latest release tag (only if cache is stale or missing)
    logger.debug("Checking for latest Codex release tag");
    const latestTag = await getLatestReleaseTag();
    const instructionsUrl = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/gpt_5_codex_prompt.md`;

    logger.info("Fetching Codex instructions", {
      tag: latestTag,
      url: instructionsUrl,
    });

    // If tag changed, we need to fetch new instructions
    if (cachedTag !== latestTag) {
      logger.info("New Codex release detected", {
        old: cachedTag,
        new: latestTag,
      });
      cachedETag = null; // Force re-fetch
    }

    // Make conditional request with If-None-Match header
    const headers: Record<string, string> = {};
    if (cachedETag) {
      headers["If-None-Match"] = cachedETag;
    }

    const response = await fetch(instructionsUrl, { headers });

    // 304 Not Modified - our cached version is still current
    if (response.status === 304) {
      logger.debug("Codex instructions not modified (304)");
      if (existsSync(CACHE_FILE)) {
        // Update lastChecked timestamp
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(
          CACHE_METADATA_FILE,
          JSON.stringify({
            etag: cachedETag,
            tag: latestTag,
            lastChecked: Date.now(),
            url: instructionsUrl,
          } as CacheMetadata),
          "utf-8",
        );
        return await readFile(CACHE_FILE, "utf-8");
      }
      // Cache file missing but GitHub says not modified - fall through to re-fetch
    }

    // 200 OK - new content or first fetch
    if (response.ok) {
      const instructions = await response.text();
      const newETag = response.headers.get("etag");

      logger.info("Fetched new Codex instructions", {
        tag: latestTag,
        etag: newETag,
        size: instructions.length,
      });

      // Create cache directory if it doesn't exist
      await mkdir(CACHE_DIR, { recursive: true });

      // Cache the instructions with ETag and tag
      await writeFile(CACHE_FILE, instructions, "utf-8");
      await writeFile(
        CACHE_METADATA_FILE,
        JSON.stringify({
          etag: newETag,
          tag: latestTag,
          lastChecked: Date.now(),
          url: instructionsUrl,
        } as CacheMetadata),
        "utf-8",
      );

      return instructions;
    }

    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching instructions`,
    );
  } catch (error) {
    logger.error("Failed to fetch Codex instructions from GitHub", {
      error: String(error),
    });

    // Try to use cached version even if stale
    if (existsSync(CACHE_FILE)) {
      logger.warn("Using stale cached Codex instructions");
      return await readFile(CACHE_FILE, "utf-8");
    }

    // No cache available - this is a critical failure
    throw new Error(
      `Failed to fetch Codex instructions and no cache available: ${error}`,
    );
  }
}

/**
 * Preload Codex instructions at startup
 * This ensures instructions are cached before first request
 */
export async function preloadCodexInstructions(): Promise<void> {
  try {
    await getCodexInstructions();
    logger.info("Codex instructions preloaded successfully");
  } catch (error) {
    logger.error("Failed to preload Codex instructions", {
      error: String(error),
    });
    // Don't throw - allow app to start even if preload fails
  }
}
</file>

<file path="CODEX_INSTRUCTIONS.md">
# OpenAI Codex Instructions

This file contains the official instructions fetched from the OpenAI Codex GitHub repository that are injected into every Codex API request.

Source: https://github.com/openai/codex (latest release)

---

You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General

- The arguments to `shell` will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the `workdir` param when using the shell function. Do not use `cd` unless absolutely necessary.
- When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`. (If the `rg` command is not found, then use alternatives.)

## Editing constraints

- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Add succinct code comments that explain what is going on if code is not self-explanatory. You should not add comments like "Assigns the value to the variable", but a brief comment might be useful ahead of a complex code block that the user would otherwise have to spend time parsing out. Usage of these comments should be rare.
- Try to use apply_patch for single file edits, but it is fine to explore other options to make the edit if it does not work well. Do not use apply_patch for changes that are auto-generated (i.e. generating package.json or running a lint or format command like gofmt) or when scripting is more efficient (such as search and replacing a string across a codebase).
- You may be in a dirty git worktree.
    * NEVER revert existing changes you did not make unless explicitly requested, since these changes were made by the user.
    * If asked to make a commit or code edits and there are unrelated changes to your work or changes that you didn't make in those files, don't revert those changes.
    * If the changes are in files you've touched recently, you should read carefully and understand how you can work with the changes rather than reverting them.
    * If the changes are in unrelated files, just ignore them and don't revert them.
- While you are working, you might notice unexpected changes that you didn't make. If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
- **NEVER** use destructive commands like `git reset --hard` or `git checkout --` unless specifically requested or approved by the user.

## Plan tool

When using the planning tool:
- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).
- Do not make single-step plans.
- When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.

## Codex CLI harness, sandboxing, and approvals

The Codex CLI harness supports several different configurations for sandboxing and escalation approvals that the user can choose from.

Filesystem sandboxing defines which files can be read or written. The options for `sandbox_mode` are:
- **read-only**: The sandbox only permits reading files.
- **workspace-write**: The sandbox permits reading files, and editing files in `cwd` and `writable_roots`. Editing files in other directories requires approval.
- **danger-full-access**: No filesystem sandboxing - all commands are permitted.

Network sandboxing defines whether network can be accessed without approval. Options for `network_access` are:
- **restricted**: Requires approval
- **enabled**: No approval needed

Approvals are your mechanism to get user consent to run shell commands without the sandbox. Possible configuration options for `approval_policy` are
- **untrusted**: The harness will escalate most commands for user approval, apart from a limited allowlist of safe "read" commands.
- **on-failure**: The harness will allow all commands to run in the sandbox (if enabled), and failures will be escalated to the user for approval to run again without the sandbox.
- **on-request**: Commands will be run in the sandbox by default, and you can specify in your tool call if you want to escalate a command to run without sandboxing. (Note that this mode is not always available. If it is, you'll see parameters for it in the `shell` command description.)
- **never**: This is a non-interactive mode where you may NEVER ask the user for approval to run commands. Instead, you must always persist and work around constraints to solve the task for the user. You MUST do your utmost best to finish the task and validate your work before yielding. If this mode is paired with `danger-full-access`, take advantage of it to deliver the best outcome for the user. Further, in this mode, your default testing philosophy is overridden: Even if you don't see local patterns for testing, you may add tests and scripts to validate your work. Just remove them before yielding.

When you are running with `approval_policy == on-request`, and sandboxing enabled, here are scenarios where you'll need to request approval:
- You need to run a command that writes to a directory that requires it (e.g. running tests that write to /var)
- You need to run a GUI app (e.g., open/xdg-open/osascript) to open browsers or files.
- You are running sandboxed and need to run a command that requires network access (e.g. installing packages)
- If you run a command that is important to solving the user's query, but it fails because of sandboxing, rerun the command with approval. ALWAYS proceed to use the `with_escalated_permissions` and `justification` parameters - do not message the user before requesting approval for the command.
- You are about to take a potentially destructive action such as an `rm` or `git reset` that the user did not explicitly ask for
- (for all of these, you should weigh alternative paths that do not require approval)

When `sandbox_mode` is set to read-only, you'll need to request approval for any command that isn't a read.

You will be told what filesystem sandboxing, network sandboxing, and approval mode are active in a developer or user message. If you are not told about this, assume that you are running with workspace-write, network sandboxing enabled, and approval on-failure.

Although they introduce friction to the user because your work is paused until the user responds, you should leverage them when necessary to accomplish important work. If the completing the task requires escalated permissions, Do not let these settings or the sandbox deter you from attempting to accomplish the user's task unless it is set to "never", in which case never ask for approvals.

When requesting approval to execute a command that will require escalated privileges:
  - Provide the `with_escalated_permissions` parameter with the boolean value true
  - Include a short, 1 sentence explanation for why you need to enable `with_escalated_permissions` in the justification parameter

## Special user requests

- If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal command (such as `date`), you should do so.
- If the user asks for a "review", default to a code review mindset: prioritise identifying bugs, risks, behavioural regressions, and missing tests. Findings must be the primary focus of the response - keep summaries or overviews brief and only after enumerating the issues. Present findings first (ordered by severity with file/line references), follow with open questions or assumptions, and offer a change-summary only as a secondary detail. If no findings are discovered, state that explicitly and mention any residual risks or testing gaps.

## Presenting your work and final message

You are producing plain text that will later be styled by the CLI. Follow these rules exactly. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.

- Default: be very concise; friendly coding teammate tone.
- Ask only when needed; suggest ideas; mirror the user's style.
- For substantial work, summarize clearly; follow final‑answer formatting.
- Skip heavy formatting for simple confirmations.
- Don't dump large files you've written; reference paths only.
- No "save/copy this file" - User is on the same machine.
- Offer logical next steps (tests, commits, build) briefly; add verify steps if you couldn't do something.
- For code changes:
  * Lead with a quick explanation of the change, and then give more details on the context covering where and why a change was made. Do not start this explanation with "summary", just jump right in.
  * If there are natural next steps the user may want to take, suggest them at the end of your response. Do not make suggestions if there are no natural next steps.
  * When suggesting multiple options, use numeric lists for the suggestions so the user can quickly respond with a single number.
- The user does not command execution outputs. When asked to show the output of a command (e.g. `git show`), relay the important details in your answer or summarize the key lines so the user understands the result.

### Final answer structure and style guidelines

- Plain text; CLI handles styling. Use structure only when it helps scanability.
- Headers: optional; short Title Case (1-3 words) wrapped in **…**; no blank line before the first bullet; add only if they truly help.
- Bullets: use - ; merge related points; keep to one line when possible; 4–6 per list ordered by importance; keep phrasing consistent.
- Monospace: backticks for commands/paths/env vars/code ids and inline examples; use for literal keyword bullets; never combine with **.
- Code samples or multi-line snippets should be wrapped in fenced code blocks; include an info string as often as possible.
- Structure: group related bullets; order sections general → specific → supporting; for subsections, start with a bolded keyword bullet, then items; match complexity to the task.
- Tone: collaborative, concise, factual; present tense, active voice; self‑contained; no "above/below"; parallel wording.
- Don'ts: no nested bullets/hierarchies; no ANSI codes; don't cram unrelated keywords; keep keyword lists short—wrap/reformat if long; avoid naming formatting styles in answers.
- Adaptation: code explanations → precise, structured with code refs; simple tasks → lead with outcome; big changes → logical walkthrough + rationale + next actions; casual one-offs → plain sentences, no headers/bullets.
- File References: When referencing files in your response, make sure to include the relevant start line and always follow the below rules:
  * Use inline code to make file paths clickable.
  * Each reference should have a stand alone path. Even if it's the same file.
  * Accepted: absolute, workspace‑relative, a/ or b/ diff prefixes, or bare filename/suffix.
  * Line/column (1‑based, optional): :line[:column] or #Lline[Ccolumn] (column defaults to 1).
  * Do not use URIs like file://, vscode://, or https://.
  * Do not provide range of lines
  * Examples: src/app.ts, src/app.ts:42, b/server/index.js#L10, C:\repo\project\main.rs:12:5
</file>

<file path="test-openai-with-tools.ts">
#!/usr/bin/env bun
/**
 * Test script to validate OpenAI Codex with tools (like the real agent)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { loadConfig } from "./src/config";
import { createOpenAIFetch } from "./src/openai-auth";
import { z } from "zod";

async function test() {
  console.log("Loading config...");
  const config = await loadConfig();

  if (!config.openai) {
    console.error("No OpenAI config found. Run /login-openai first.");
    process.exit(1);
  }

  console.log("OpenAI config:");
  console.log("  Model:", config.openai.model);
  console.log("  Account ID:", config.openai.accountId);
  console.log("  Token expires:", new Date(config.openai.expires));
  console.log();

  console.log("Creating OpenAI fetch wrapper...");
  const customFetch = createOpenAIFetch(config);

  console.log("Creating OpenAI provider...");
  const provider = createOpenAICompatible({
    name: "openai",
    apiKey: "chatgpt-oauth", // Dummy key - actual auth via custom fetch
    baseURL: "https://chatgpt.com/backend-api",
    fetch: customFetch as any,
  });

  const model = provider(config.openai.model || "gpt-5-codex");

  console.log("Making test request with tools...");
  console.log("Message: Tell me a joke");
  console.log();

  try {
    const result = await streamText({
      model,
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Tell me a joke" }],
      tools: {
        bash: {
          description: "Execute bash command",
          parameters: z.object({
            command: z.string(),
          }),
        },
        read: {
          description: "Read a file",
          parameters: z.object({
            path: z.string(),
          }),
        },
      },
      temperature: 0.3,
    });

    let responseText = "";
    for await (const chunk of result.textStream) {
      responseText += chunk;
      process.stdout.write(chunk);
    }

    console.log("\n\n✅ SUCCESS!");
    console.log("Response length:", responseText.length);
    console.log("\nCodex API with tools is working! 🎉");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR!");
    console.error("Message:", error.message);

    if (error.responseBody) {
      console.error("Response body:", error.responseBody);
    }

    if (error.stack) {
      console.error("\nStack:", error.stack.split("\n").slice(0, 5).join("\n"));
    }

    process.exit(1);
  }
}

// Enable debug logging
process.env.YEET_LOG_LEVEL = "debug";

test().catch(console.error);
</file>

<file path="test-openai.ts">
#!/usr/bin/env bun
/**
 * Quick test script to validate OpenAI Codex plumbing
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { loadConfig } from "./src/config";
import { createOpenAIFetch } from "./src/openai-auth";

async function test() {
  console.log("Loading config...");
  const config = await loadConfig();

  if (!config.openai) {
    console.error("No OpenAI config found. Run /login-openai first.");
    process.exit(1);
  }

  console.log("OpenAI config:");
  console.log("  Model:", config.openai.model);
  console.log("  Account ID:", config.openai.accountId);
  console.log("  Token expires:", new Date(config.openai.expires));
  console.log();

  console.log("Creating OpenAI fetch wrapper...");
  const customFetch = createOpenAIFetch(config);

  console.log("Creating OpenAI provider...");
  const provider = createOpenAICompatible({
    name: "openai",
    apiKey: "chatgpt-oauth", // Dummy key - actual auth via custom fetch
    baseURL: "https://chatgpt.com/backend-api",
    fetch: customFetch as any,
  });

  const model = provider(config.openai.model || "gpt-5-codex");

  console.log("Making test request...");
  console.log("Prompt: Count the r's in 'strawberry'");
  console.log();

  try {
    const result = await generateText({
      model,
      prompt: "Count the number of r's in the word 'strawberry'. Just give me the number.",
      maxTokens: 50,
    });

    console.log("\n✅ SUCCESS!");
    console.log("Response:", result.text);
    console.log("Usage:", result.usage);
    console.log("\nCodex API is working! 🎉");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR!");
    console.error("Message:", error.message);

    if (error.responseBody) {
      console.error("Response body:", error.responseBody);
    }

    process.exit(1);
  }
}

// Enable debug logging
process.env.YEET_LOG_LEVEL = "debug";

test().catch(console.error);
</file>

<file path="src/openai-callback-server.ts">
/**
 * Local callback server for OpenAI OAuth flow
 * Listens on localhost:1455 to capture the OAuth redirect
 */

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";

export interface CallbackServerResult {
  code: string;
  state: string;
}

export interface CallbackServer {
  port: number;
  close: () => void;
  waitForCallback: (expectedState: string) => Promise<CallbackServerResult | null>;
}

/**
 * Start a local HTTP server to capture OAuth callback
 */
export async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCallback: ((result: CallbackServerResult | null) => void) | null = null;
  let expectedState = "";
  let server: ReturnType<typeof Bun.serve> | null = null;

  server = Bun.serve({
    port: CALLBACK_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === CALLBACK_PATH) {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (code && state) {
          // Success! Return a nice HTML page and resolve the promise
          const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .checkmark {
      font-size: 4rem;
      color: #4ade80;
      margin-bottom: 1rem;
    }
    h1 {
      color: #1f2937;
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
    }
    p {
      color: #6b7280;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Authentication Successful!</h1>
    <p>You can now close this window and return to your terminal.</p>
  </div>
</body>
</html>`;

          // Resolve the promise with the code and state
          if (resolveCallback) {
            resolveCallback({ code, state });
            resolveCallback = null;
          }

          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Missing parameters
        return new Response("Missing code or state parameters", {
          status: 400,
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    port: CALLBACK_PORT,
    close: () => {
      if (server) {
        server.stop();
        server = null;
      }
      if (resolveCallback) {
        resolveCallback(null);
        resolveCallback = null;
      }
    },
    waitForCallback: (state: string): Promise<CallbackServerResult | null> => {
      expectedState = state;
      return new Promise((resolve) => {
        resolveCallback = resolve;

        // Timeout after 5 minutes
        setTimeout(() => {
          if (resolveCallback) {
            resolveCallback(null);
            resolveCallback = null;
          }
        }, 5 * 60 * 1000);
      });
    },
  };
}
</file>

<file path="OPENAI_IMPLEMENTATION_STATUS.md">
# OpenAI/ChatGPT Pro Implementation Status

## Summary

**Status:** OAuth working, API accessible, but **incompatible with yeet's tool system**

The Codex API successfully responds to requests, but it uses a different:
- Streaming format (Server-Sent Events vs OpenAI JSON streaming)
- Tool/function calling format (incompatible with AI SDK's tooling)
- Parameter set (doesn't support temperature, system messages, etc.)

**Conclusion:** Would require significant changes to yeet's agent system to support Codex. Not a drop-in replacement for Anthropic/OpenAI providers.

## ✅ Completed

### OAuth Flow
- [x] Local callback server on port 1455
- [x] Automatic browser redirect handling
- [x] PKCE flow with code challenge/verifier
- [x] Token exchange and refresh
- [x] CSRF protection with state verification
- [x] Account ID extraction from JWT
- [x] Success page display after auth

### Provider Plumbing
- [x] OpenAI config in `src/config.ts`
- [x] OpenAI models in `src/models/registry.ts` (gpt-5, gpt-5-codex)
- [x] Provider support in `src/agent.ts`
- [x] Provider support in `src/explain/model.ts`
- [x] Model selection in all UI adapters (TUI, Solid, Web)
- [x] Token counting for OpenAI models
- [x] Session management for OpenAI

### Commands
- [x] `/login-anthropic` - Anthropic OAuth flow
- [x] `/login-openai` - OpenAI OAuth flow with callback server
- [x] `/auth status` - Shows OpenAI auth status
- [x] `/models` - Lists and switches OpenAI models

### Request Transformation
- [x] URL rewriting: `/chat/completions` → `/codex/responses`
- [x] Message format conversion: `messages` array → `input` array
- [x] System message filtering (Codex doesn't support them)
- [x] Parameter filtering (temperature, top_p, tool_choice, etc.)
- [x] Request body transformation in custom fetch wrapper
- [x] Header injection (Bearer token, account ID, Codex headers)
- [x] Automatic token refresh on expiration
- [x] Codex instructions fetching from GitHub with ETag caching

## ❌ Blocking Issues

### 1. Incompatible Streaming Format

**Problem:** Codex uses Server-Sent Events (SSE) with a custom format, not OpenAI's streaming JSON

Codex response format:
```
event: response.created
data: {"type":"response.created","response":{...}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","text":"Hello"}

event: response.done
data: {"type":"response.done","response":{...}}
```

OpenAI format (expected by AI SDK):
```json
{"id":"...","choices":[{"delta":{"content":"Hello"}}]}
```

**Impact:** AI SDK's `streamText()` fails to parse Codex responses

### 2. Incompatible Tool/Function Calling

**Problem:** Codex uses a different tool format than OpenAI

AI SDK sends:
```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "bash",
      "description": "Execute bash command",
      "parameters": {...}
    }
  }]
}
```

Codex expects: Unknown format (returns error: `Missing required parameter: 'tools[0].name'`)

**Impact:** yeet's core functionality (bash, read, write, edit tools) doesn't work

### 3. Unsupported Parameters

Codex doesn't support:
- `temperature` - Sampling parameter
- `top_p` - Nucleus sampling
- `frequency_penalty` / `presence_penalty` - Token penalties
- `stop` - Stop sequences
- `seed` - Reproducibility
- `tool_choice` - Tool selection strategy
- `max_tokens` / `max_output_tokens` - Token limits
- System messages in messages array (must use `instructions` field)

## What Works

**Basic API calls without tools:**
- OAuth authentication ✅
- Token refresh ✅
- Simple text generation requests ✅
- Codex instructions injection ✅
- Account ID tracking ✅

**Test results:**
```bash
bun run test-openai.ts
# Result: Successfully counted r's in "strawberry" = 3
```

## What Doesn't Work

- Tool/function calling (core yeet functionality)
- Streaming response parsing through AI SDK
- Multi-step agent workflows
- Any yeet commands that use tools (bash, read, write, edit)

## Technical Details

### Files Created
- `src/openai-auth.ts` - OAuth and fetch wrapper (427 lines)
- `src/openai-callback-server.ts` - Local OAuth server (135 lines)
- `src/codex-instructions.ts` - GitHub instructions fetcher (205 lines)
- `CODEX_INSTRUCTIONS.md` - Official Codex prompt (for reference)
- `test-openai.ts` - Simple API test (works)
- `test-openai-with-tools.ts` - Tool test (fails)

### Commits
```
[Latest] Fix Codex API compatibility issues (streaming/tools incompatible)
df2fc2f WIP: Add Codex API request transformation (instructions validation failing)
30bc600 Fix URL rewriting for Codex API and add debug logging
34d9a62 Fix OAuth state verification for automatic callback
b66e3c5 Add automatic OAuth callback server for OpenAI login
2cc4f42 Add ChatGPT Pro OAuth support via OpenAI Codex API
```

## Recommendations

### Option 1: Custom Codex Agent Implementation (High effort)
- Write custom SSE streaming parser for Codex format
- Reverse-engineer Codex tool calling format
- Create separate agent implementation for Codex
- Maintain two parallel systems (Anthropic + Codex)

### Option 2: Wait for Official Support (Zero effort)
- OpenAI may release official Codex SDK
- AI SDK maintainers may add Codex support
- Keep OAuth implementation for future use

### Option 3: Use Different Provider (Recommended)
- Stick with Anthropic (Claude Code) - fully working
- Use OpenCode/Maple for alternatives
- ChatGPT Pro OAuth works but Codex API not compatible with yeet's architecture

## Next Steps

If pursuing Codex integration:
1. Study openai/codex CLI source for SSE parsing
2. Reverse-engineer tool calling format
3. Create custom agent implementation
4. Test end-to-end with all yeet commands

If abandoning Codex:
1. Keep OAuth implementation (works perfectly)
2. Document as experimental/incomplete
3. Focus on improving Anthropic/Claude support
</file>

<file path="src/openai-auth.ts">
import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "crypto";
import type { Config } from "./config";
import { saveConfig } from "./config";
import { logger } from "./logger";
import { getCodexInstructions } from "./codex-instructions";

// OpenAI OAuth constants (from codex CLI)
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

// OpenAI-specific headers
const OPENAI_HEADERS = {
  BETA: "OpenAI-Beta",
  ACCOUNT_ID: "chatgpt-account-id",
  ORIGINATOR: "originator",
  SESSION_ID: "session_id",
  CONVERSATION_ID: "conversation_id",
} as const;

const OPENAI_HEADER_VALUES = {
  BETA_RESPONSES: "responses=experimental",
  ORIGINATOR_CODEX: "codex_cli_rs",
} as const;

export interface OAuthResult {
  url: string;
  verifier: string;
  state: string;
}

export interface TokenResult {
  type: "success" | "failed";
  access?: string;
  refresh?: string;
  expires?: number;
}

export interface JWTPayload {
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
  [key: string]: unknown;
}

/**
 * Generate a random state value for OAuth flow
 */
function createState(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Decode a JWT token to extract payload
 */
function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Extract ChatGPT account ID from JWT token
 */
function extractAccountId(token: string): string | null {
  const payload = decodeJWT(token);
  return (
    payload?.["https://api.openai.com/auth"]?.chatgpt_account_id || null
  );
}

/**
 * Start OpenAI OAuth flow
 */
export async function startOpenAIOAuth(): Promise<OAuthResult> {
  const pkce = (await generatePKCE()) as { challenge: string; verifier: string };
  const state = createState();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");

  return {
    url: url.toString(),
    verifier: pkce.verifier,
    state,
  };
}

/**
 * Parse authorization code and state from user input
 */
export function parseAuthorizationInput(input: string): {
  code?: string;
  state?: string;
} {
  const value = (input || "").trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {}

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }
  return { code: value };
}

/**
 * Exchange authorization code for access and refresh tokens
 */
export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
): Promise<TokenResult> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("OpenAI code->token failed:", { status: res.status, text });
      return { type: "failed" };
    }

    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (
      !json?.access_token ||
      !json?.refresh_token ||
      typeof json?.expires_in !== "number"
    ) {
      logger.error("OpenAI token response missing fields:", json);
      return { type: "failed" };
    }

    return {
      type: "success",
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    };
  } catch (error: any) {
    logger.error("OpenAI token exchange error:", error);
    return { type: "failed" };
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResult> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error("OpenAI token refresh failed:", {
        status: response.status,
        text,
      });
      return { type: "failed" };
    }

    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (
      !json?.access_token ||
      !json?.refresh_token ||
      typeof json?.expires_in !== "number"
    ) {
      logger.error("OpenAI token refresh response missing fields:", json);
      return { type: "failed" };
    }

    return {
      type: "success",
      access: json.access_token,
      refresh: json.refresh_token,
      expires: Date.now() + json.expires_in * 1000,
    };
  } catch (error: any) {
    logger.error("OpenAI token refresh error:", error);
    return { type: "failed" };
  }
}

/**
 * Create custom fetch function for OpenAI Codex API
 * Handles token refresh, header injection, and URL rewriting
 */
export function createOpenAIFetch(config: Config) {
  if (!config.openai || config.openai.type !== "oauth") {
    return fetch;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const openai = config.openai!;

    // Refresh token if expired or missing
    if (!openai.access || !openai.expires || openai.expires < Date.now()) {
      if (!openai.refresh) {
        throw new Error("No refresh token available");
      }

      const refreshed = await refreshAccessToken(openai.refresh);
      if (refreshed.type === "failed") {
        throw new Error("Failed to refresh OpenAI token");
      }

      // Update config with new tokens
      openai.access = refreshed.access!;
      openai.refresh = refreshed.refresh!;
      openai.expires = refreshed.expires!;

      // Extract and store account ID from new access token
      const accountId = extractAccountId(refreshed.access!);
      if (accountId) {
        openai.accountId = accountId;
      }

      await saveConfig(config);
    }

    // Extract account ID if not already stored
    if (!openai.accountId && openai.access) {
      const accountId = extractAccountId(openai.access);
      if (accountId) {
        openai.accountId = accountId;
        await saveConfig(config);
      }
    }

    // Extract URL from input (string, URL, or Request object)
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      // Fallback for unknown types
      url = String(input);
    }

    logger.debug("OpenAI fetch - original URL:", url);

    // Rewrite URL to Codex backend
    // The AI SDK may use standard OpenAI paths, we need to rewrite to Codex
    if (url.includes("/chat/completions")) {
      // Standard chat completions endpoint -> Codex responses endpoint
      url = url.replace("/chat/completions", "/codex/responses");
    } else if (url.includes("/v1/chat/completions")) {
      // Standard OpenAI SDK path -> Codex responses endpoint
      url = url.replace("/v1/chat/completions", "/codex/responses");
    } else if (url.includes("/responses")) {
      // Already using responses endpoint -> just add /codex prefix
      url = url.replace("/responses", "/codex/responses");
    }

    logger.debug("OpenAI fetch - rewritten URL:", url);

    // Create headers with OAuth token and Codex-specific headers
    const headers = new Headers(init?.headers ?? {});
    headers.delete("x-api-key");
    headers.set("Authorization", `Bearer ${openai.access}`);
    headers.set("accept", "text/event-stream");

    if (openai.accountId) {
      headers.set(OPENAI_HEADERS.ACCOUNT_ID, openai.accountId);
    }
    headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
    headers.set(
      OPENAI_HEADERS.ORIGINATOR,
      OPENAI_HEADER_VALUES.ORIGINATOR_CODEX,
    );

    // Transform request body if present
    let body = init?.body;
    if (body && typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as Record<string, any>;
        logger.debug("OpenAI fetch - original body:", parsed);

        // The OpenAI-compatible SDK sends standard OpenAI format with "messages"
        // Codex expects "input" array format instead
        if (parsed.messages && Array.isArray(parsed.messages)) {
          // Filter out system messages (Codex doesn't support them)
          // System prompt goes in the instructions field instead
          const filteredMessages = parsed.messages.filter(
            (msg: any) => msg.role !== "system"
          );

          // Convert messages to input format
          parsed.input = filteredMessages.map((msg: any) => ({
            type: "message",
            role: msg.role,
            content: Array.isArray(msg.content)
              ? msg.content
              : [{ type: "input_text", text: msg.content }],
          }));
          delete parsed.messages;
        }

        // Normalize model name to Codex-supported variants
        if (parsed.model) {
          const model = String(parsed.model).toLowerCase();
          if (model.includes("codex")) {
            parsed.model = "gpt-5-codex";
          } else if (model.includes("gpt-5") || model.includes("gpt 5")) {
            parsed.model = "gpt-5";
          } else {
            parsed.model = "gpt-5";
          }
        }

        // Set Codex required fields
        parsed.store = false;
        parsed.stream = true;

        // Codex requires instructions (system prompt)
        // Fetch official Codex instructions from GitHub (cached)
        if (!parsed.instructions) {
          try {
            parsed.instructions = await getCodexInstructions();
          } catch (error) {
            logger.error("Failed to fetch Codex instructions", { error });
            throw new Error(
              "Cannot make Codex API request without instructions. Please check network connection.",
            );
          }
        }

        // Remove unsupported parameters
        delete parsed.max_tokens;
        delete parsed.max_output_tokens;
        delete parsed.max_completion_tokens;
        delete parsed.temperature;
        delete parsed.top_p;
        delete parsed.frequency_penalty;
        delete parsed.presence_penalty;
        delete parsed.stop;
        delete parsed.seed;
        delete parsed.tool_choice;
        delete parsed.tools; // Codex tools format is different from OpenAI

        // Filter input to remove AI SDK constructs
        if (Array.isArray(parsed.input)) {
          parsed.input = parsed.input
            .filter((item: any) => item.type !== "item_reference")
            .map((item: any) => {
              if (item.id) {
                const { id, ...itemWithoutId } = item;
                return itemWithoutId;
              }
              return item;
            });
        }

        logger.debug("OpenAI fetch - transformed body:", parsed);
        body = JSON.stringify(parsed);
      } catch (error) {
        logger.error("Failed to transform OpenAI request:", error as Error);
      }
    }

    logger.debug("OpenAI Codex request", { url, hasBody: !!body });

    return fetch(url, {
      ...init,
      headers,
      body,
    });
  };
}
</file>

<file path="src/config.ts">
import os from "os";
import path from "path";
import { chmod, mkdir } from "fs/promises";

// Centralized config directory - follows XDG Base Directory spec
export const YEET_CONFIG_DIR = path.join(os.homedir(), ".config", "yeet");

async function ensureConfigDir(): Promise<void> {
  await mkdir(YEET_CONFIG_DIR, { recursive: true });
}

export interface Config {
  activeProvider: "opencode" | "maple" | "anthropic" | "openai";
  opencode: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
  maxSteps?: number;
  temperature?: number;
  theme?: string; // Color theme: tokyonight, nord, catppuccin, everforest
  // Maple AI configuration (optional)
  maple?: {
    apiUrl: string;
    apiKey: string;
    model: string;
    pcr0Values: string[];
  };
  // Anthropic OAuth or API key
  anthropic?: {
    type: "oauth" | "api";
    // For OAuth
    refresh?: string;
    access?: string;
    expires?: number;
    accountUuid?: string;
    organizationUuid?: string;
    userUuid?: string;
    // For API key
    apiKey?: string;
    model?: string;
  };
  // OpenAI ChatGPT Pro OAuth
  openai?: {
    type: "oauth";
    refresh: string;
    access: string;
    expires: number;
    accountId?: string;
    model?: string;
  };
}

async function tryLoadOpenCodeCredentials(): Promise<{
  opencodeKey: string | null;
  anthropicOAuth: any | null;
}> {
  let opencodeKey = null;
  let anthropicOAuth = null;

  try {
    // Try to load from OpenCode's auth.json
    const opencodeAuthPath = path.join(
      os.homedir(),
      ".local",
      "share",
      "opencode",
      "auth.json",
    );
    const authFile = Bun.file(opencodeAuthPath);

    if (await authFile.exists()) {
      const authData = await authFile.json();
      if (authData.opencode?.type === "api" && authData.opencode.key) {
        opencodeKey = authData.opencode.key;
      }
      // Also check for Anthropic OAuth
      if (authData.anthropic?.type === "oauth") {
        anthropicOAuth = {
          type: "oauth" as const,
          refresh: authData.anthropic.refresh,
          access: authData.anthropic.access,
          expires: authData.anthropic.expires,
        };
      }
    }
  } catch (error) {
    // Ignore errors, will fall through to return null
  }
  return { opencodeKey, anthropicOAuth };
}

async function createDefaultConfig(configPath: string): Promise<Config> {
  const { opencodeKey, anthropicOAuth } = await tryLoadOpenCodeCredentials();

  if (!opencodeKey && !anthropicOAuth) {
    throw new Error(
      `No authentication configured.\n\n` +
        `Choose one of:\n\n` +
        `1. Anthropic Claude Pro/Max OAuth:\n` +
        `   Run: yeet /login-anthropic\n\n` +
        `2. ChatGPT Pro/Codex OAuth:\n` +
        `   Run: yeet /login-openai\n\n` +
        `3. Anthropic API Key:\n` +
        `   Create ${configPath} with:\n` +
        `   {\n` +
        `     "activeProvider": "anthropic",\n` +
        `     "anthropic": {\n` +
        `       "type": "api",\n` +
        `       "apiKey": "sk-ant-...",\n` +
        `       "model": "claude-sonnet-4-5-20250929"\n` +
        `     }\n` +
        `   }\n\n` +
        `4. OpenCode Zen API:\n` +
        `   Create ${configPath} with:\n` +
        `   {\n` +
        `     "activeProvider": "opencode",\n` +
        `     "opencode": {\n` +
        `       "apiKey": "your-opencode-zen-api-key",\n` +
        `       "baseURL": "https://opencode.ai/zen/v1",\n` +
        `       "model": "grok-code"\n` +
        `     }\n` +
        `   }`,
    );
  }

  const config: Config = anthropicOAuth
    ? {
        activeProvider: "anthropic",
        opencode: {
          apiKey: "",
          baseURL: "https://opencode.ai/zen/v1",
          model: "grok-code",
        },
        anthropic: anthropicOAuth,
        maxSteps: 20,
        temperature: 0.5,
      }
    : {
        activeProvider: "opencode",
        opencode: {
          apiKey: opencodeKey!,
          baseURL: "https://opencode.ai/zen/v1",
          model: "grok-code",
        },
        maxSteps: 20,
        temperature: 0.5,
      };

  // Create config directory if it doesn't exist
  await mkdir(path.dirname(configPath), { recursive: true });

  // Write config file
  await Bun.write(configPath, JSON.stringify(config, null, 2));

  // Set secure permissions
  await chmod(configPath, 0o600);

  console.log(`✓ Created config at ${configPath}`);
  if (anthropicOAuth) {
    console.log(`✓ Copied Anthropic OAuth credentials from OpenCode`);
  } else {
    console.log(`✓ Copied OpenCode API credentials`);
  }
  console.log();

  return config;
}

export async function loadConfig(): Promise<Config> {
  await ensureConfigDir();
  const configPath = path.join(YEET_CONFIG_DIR, "config.json");
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return await createDefaultConfig(configPath);
  }

  const config = (await file.json()) as any;

  // Migrate old config: set activeProvider based on maple.enabled
  if (!config.activeProvider) {
    config.activeProvider = config.maple?.enabled ? "maple" : "opencode";
  }
  if (config.maple?.enabled !== undefined) {
    delete config.maple.enabled;
  }

  return {
    ...config,
    maxSteps: config.maxSteps || 20,
    temperature: config.temperature || 0.5,
  } as Config;
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  const configPath = path.join(YEET_CONFIG_DIR, "config.json");
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  await chmod(configPath, 0o600);
}
</file>

<file path="package.json">
{
  "name": "yeet",
  "version": "0.1.0",
  "type": "module",
  "description": "Minimal TUI coding agent",
  "bin": {
    "yeet": "./src/index.ts",
    "yeet-explain": "./src/explain/cli.ts"
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^2.0.40",
    "@ai-sdk/openai-compatible": "^1.0.0",
    "@openauthjs/openauth": "^0.4.3",
    "@opentui/core": "^0.1.32",
    "@opentui/solid": "^0.1.32",
    "@peculiar/x509": "^1.14.0",
    "@stablelib/base64": "^2.0.1",
    "@stablelib/chacha20poly1305": "^2.0.1",
    "@stablelib/random": "^2.0.1",
    "@types/dagre": "^0.7.53",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.2",
    "@xyflow/react": "^12.9.1",
    "ai": "^5.0.8",
    "cbor2": "^2.0.1",
    "commander": "^14.0.2",
    "dagre": "^0.8.5",
    "diff2html": "^3.4.52",
    "isomorphic-git": "^1.34.2",
    "ora": "^9.0.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "solid-js": "^1.9.10",
    "tiktoken": "^1.0.22",
    "tweetnacl": "^1.0.3",
    "xstate": "^5.23.0",
    "zod": "^4.1.8",
    "zod-to-json-schema": "^3.24.6"
  },
  "devDependencies": {
    "@babel/core": "^7.28.5",
    "@babel/preset-typescript": "^7.28.5",
    "@biomejs/biome": "^1.9.4",
    "@playwright/test": "1.54.1",
    "@types/bun": "latest",
    "@vitejs/plugin-react": "^5.1.0",
    "babel-preset-solid": "^1.9.10",
    "playwright": "1.54.1",
    "typescript": "^5.8.2",
    "vite": "^7.1.12"
  }
}
</file>

<file path="src/agent.ts">
import { createAnthropic } from "@ai-sdk/anthropic";
// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText } from "ai";
import {
  CLAUDE_CODE_API_BETA,
  CLAUDE_CODE_BETA,
  createAnthropicFetch,
} from "./auth";
import { createOpenAIFetch } from "./openai-auth";
import type { Config } from "./config";
import { logger } from "./logger";
import { createMapleFetch } from "./maple";
import * as tools from "./tools";

// NOTE: Claude Code spoofing copied from opencode
// When using Anthropic, we pretend to be "Claude Code" to get better results
// since the model has been trained to act as Claude Code
const CLAUDE_CODE_SPOOF = `You are Claude Code, Anthropic's official CLI for Claude.`;

const SYSTEM_PROMPT_BASE = `
CRITICAL INSTRUCTIONS:
- You have tools available: bash, read, write, edit, search, complete, clarify, pause
- When asked to do something, USE THE TOOLS to actually do it
- DO NOT write code blocks showing what should be done
- DO NOT describe what you would do
- ACTUALLY CALL THE TOOLS to perform the actions

MULTI-STEP TASKS:
- Many tasks have multiple steps (e.g., "create file A, then file B, then file C")
- You must complete ALL steps before calling the complete tool
- After each tool succeeds, check if there are more steps remaining
- Only call complete when you have truly finished EVERYTHING the user requested

WORKFLOW CONTROL:
- When you've finished ALL parts of the task, call complete({ summary: "what you did" })
- If you need clarification from user, call clarify({ question: "what you need to know" })
- If you're stuck or want to pause for review, call pause({ reason: "why pausing" })

SEARCH TOOL:
- Use 'search' instead of bash+grep for finding patterns in files
- search returns structured results (file, line number, content)
- Much better than parsing bash output

Examples:
WRONG: "Here's the code: \`\`\`js ... \`\`\`"
RIGHT: Call write tool with the code

WRONG: "\`\`\`bash ls \`\`\`"
RIGHT: Call bash tool with "ls"

WRONG: bash("grep -r 'pattern' src/")
RIGHT: search({ pattern: "pattern", path: "src" })

Be concise. Execute the work, don't describe it.`;

function getSystemPrompt(provider: string): string {
  if (provider === "anthropic") {
    return CLAUDE_CODE_SPOOF + "\n" + SYSTEM_PROMPT_BASE;
  }
  return (
    "You are yeet, a minimal coding assistant that executes tasks using tools." +
    SYSTEM_PROMPT_BASE
  );
}

export interface ImageAttachment {
  data: string; // base64
  mimeType: string;
}

export interface AgentEvent {
  type: "text" | "tool" | "tool-result" | "done" | "error";
  content?: string;
  name?: string;
  args?: any;
  result?: any;
  error?: string;
}

export type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image"; image: URL }>;

export async function* runAgent(
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  config: Config,
  onToolCall?: (tool: string) => void,
  maxSteps?: number,
  abortSignal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  try {
    // Choose provider based on config
    let provider;
    let modelName: string;

    if (config.activeProvider === "anthropic") {
      logger.info("Using Anthropic (OAuth or API key)");
      const anthropicConfig = config.anthropic!;

      if (anthropicConfig.type === "oauth") {
        // Use OAuth with custom fetch
        // Note: SDK requires apiKey even with custom fetch, but it won't be used
        const customFetch = createAnthropicFetch(config);
        provider = createAnthropic({
          apiKey: "oauth-token", // Dummy key - actual auth via Bearer token in custom fetch
          fetch: customFetch as any,
          headers: {
            "anthropic-beta": CLAUDE_CODE_BETA,
          },
        });
      } else {
        // Use API key
        provider = createAnthropic({
          apiKey: anthropicConfig.apiKey,
          headers: {
            "anthropic-beta": CLAUDE_CODE_API_BETA,
          },
        });
      }

      modelName = anthropicConfig.model || "claude-sonnet-4-5-20250929";
    } else if (config.activeProvider === "openai") {
      logger.info("Using OpenAI (ChatGPT Pro via Codex)");
      const customFetch = createOpenAIFetch(config);

      provider = createOpenAICompatible({
        name: "openai",
        apiKey: "chatgpt-oauth", // Dummy key - actual auth via custom fetch
        baseURL: "https://chatgpt.com/backend-api",
        fetch: customFetch as any,
      });

      modelName = config.openai!.model || "gpt-5-codex";
    } else if (config.activeProvider === "maple") {
      logger.info("Using Maple AI with encrypted inference");
      const mapleFetch = await createMapleFetch({
        apiUrl: config.maple!.apiUrl,
        apiKey: config.maple!.apiKey,
        pcr0Values: config.maple!.pcr0Values,
      });

      provider = createOpenAICompatible({
        name: "maple",
        baseURL: `${config.maple!.apiUrl}/v1`,
        fetch: mapleFetch as any,
      });
      modelName = config.maple!.model;
    } else {
      // Use OpenCode
      provider = createOpenAICompatible({
        name: "opencode",
        apiKey: config.opencode.apiKey,
        baseURL: config.opencode.baseURL,
      });
      modelName = config.opencode.model;
    }

    const toolSet = {
      bash: tools.bash,
      read: tools.read,
      edit: tools.edit,
      write: tools.write,
      search: tools.search,
      // Control flow tools
      complete: tools.complete,
      clarify: tools.clarify,
      pause: tools.pause,
      // Orchestration tools
      delegate_to_worker: tools.delegateToWorker,
      transition_stage: tools.transitionStage,
      report_results: tools.reportResults,
      complete_workflow: tools.completeWorkflow,
    };

    logger.info("Starting agent with tools", {
      tools: Object.keys(toolSet),
      messagesCount: messages.length,
    });

    // stopWhen controls multi-step tool calls (AI SDK v5+):
    // - For XState integration: pass maxSteps=1 to disable multi-step (XState controls the loop)
    // - For direct TUI usage: use stopWhen with config.maxSteps to enable multi-step tasks
    const effectiveSteps = maxSteps ?? config.maxSteps ?? 20;

    const result = await streamText({
      model: provider(modelName),
      system: getSystemPrompt(config.activeProvider),
      messages: messages as any,
      tools: toolSet,
      // Only use stopWhen if maxSteps > 1 (multi-step mode)
      ...(effectiveSteps > 1 ? { stopWhen: stepCountIs(effectiveSteps) } : {}),
      temperature: config.temperature || 0.3,
      abortSignal,
    });

    for await (const chunk of result.fullStream) {
      logger.debug("Stream chunk received", { type: chunk.type });

      if (chunk.type === "text-delta") {
        logger.debug("Text delta", { text: chunk.text?.substring(0, 50) });
        yield { type: "text", content: chunk.text };
      }
      if (chunk.type === "tool-call") {
        logger.debug("Tool call", { toolName: chunk.toolName });
        onToolCall?.(chunk.toolName);
        yield {
          type: "tool",
          name: chunk.toolName,
          args: chunk.input || {},
        };
      }
      if (chunk.type === "tool-result") {
        logger.debug("Tool result", { toolName: chunk.toolName });
        yield {
          type: "tool-result",
          name: chunk.toolName,
          result: chunk.output,
        };
      }
      if (chunk.type === "error") {
        const errorObj = (chunk as any).error;
        logger.error("Stream error chunk", {
          error: errorObj,
          errorMessage: errorObj?.message,
          errorStack: errorObj?.stack,
          errorString: String(errorObj),
        });
        yield { type: "error", error: errorObj?.message || String(errorObj) };
      }
    }

    logger.info("Agent stream completed");
    yield { type: "done" };
  } catch (error: any) {
    yield { type: "error", error: error.message };
  }
}
</file>

</files>


---

## OPENCODE-OPENAI-CODEX-AUTH PLUGIN FILES

This file is a merged representation of a subset of the codebase, containing specifically included files, combined into a single document by Repomix.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  - File path as an attribute
  - Full contents of the file
</file_format>

<usage_guidelines>
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.
</usage_guidelines>

<notes>
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Only files matching these patterns are included: index.ts, lib/**/*.ts, README.md, package.json
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)
</notes>

</file_summary>

<directory_structure>
lib/
  auth/
    auth.ts
    browser.ts
    server.ts
  prompts/
    codex-opencode-bridge.ts
    codex.ts
    opencode-codex.ts
  request/
    fetch-helpers.ts
    request-transformer.ts
    response-handler.ts
  config.ts
  constants.ts
  logger.ts
  types.ts
index.ts
package.json
README.md
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="lib/auth/auth.ts">
import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "node:crypto";
import type { PKCEPair, AuthorizationFlow, TokenResult, ParsedAuthInput, JWTPayload } from "../types.js";

// OAuth constants (from openai/codex)
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const SCOPE = "openid profile email offline_access";

/**
 * Generate a random state value for OAuth flow
 * @returns Random hex string
 */
export function createState(): string {
	return randomBytes(16).toString("hex");
}

/**
 * Parse authorization code and state from user input
 * @param input - User input (URL, code#state, or just code)
 * @returns Parsed authorization data
 */
export function parseAuthorizationInput(input: string): ParsedAuthInput {
	const value = (input || "").trim();
	if (!value) return {};

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
		};
	}
	return { code: value };
}

/**
 * Exchange authorization code for access and refresh tokens
 * @param code - Authorization code from OAuth flow
 * @param verifier - PKCE verifier
 * @param redirectUri - OAuth redirect URI
 * @returns Token result
 */
export async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
	redirectUri: string = REDIRECT_URI,
): Promise<TokenResult> {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			code_verifier: verifier,
			redirect_uri: redirectUri,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		console.error("[openai-codex-plugin] code->token failed:", res.status, text);
		return { type: "failed" };
	}
	const json = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};
	if (
		!json?.access_token ||
		!json?.refresh_token ||
		typeof json?.expires_in !== "number"
	) {
		console.error("[openai-codex-plugin] token response missing fields:", json);
		return { type: "failed" };
	}
	return {
		type: "success",
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
	};
}

/**
 * Decode a JWT token to extract payload
 * @param token - JWT token to decode
 * @returns Decoded payload or null if invalid
 */
export function decodeJWT(token: string): JWTPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1];
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		return JSON.parse(decoded) as JWTPayload;
	} catch {
		return null;
	}
}

/**
 * Refresh access token using refresh token
 * @param refreshToken - Refresh token
 * @returns Token result
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
	try {
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			console.error(
				"[openai-codex-plugin] Token refresh failed:",
				response.status,
				text,
			);
			return { type: "failed" };
		}

		const json = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};
		if (
			!json?.access_token ||
			!json?.refresh_token ||
			typeof json?.expires_in !== "number"
		) {
			console.error(
				"[openai-codex-plugin] Token refresh response missing fields:",
				json,
			);
			return { type: "failed" };
		}

		return {
			type: "success",
			access: json.access_token,
			refresh: json.refresh_token,
			expires: Date.now() + json.expires_in * 1000,
		};
	} catch (error) {
		const err = error as Error;
		console.error("[openai-codex-plugin] Token refresh error:", err);
		return { type: "failed" };
	}
}

/**
 * Create OAuth authorization flow
 * @returns Authorization flow details
 */
export async function createAuthorizationFlow(): Promise<AuthorizationFlow> {
	const pkce = (await generatePKCE()) as PKCEPair;
	const state = createState();

	const url = new URL(AUTHORIZE_URL);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", CLIENT_ID);
	url.searchParams.set("redirect_uri", REDIRECT_URI);
	url.searchParams.set("scope", SCOPE);
	url.searchParams.set("code_challenge", pkce.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);
	url.searchParams.set("id_token_add_organizations", "true");
	url.searchParams.set("codex_cli_simplified_flow", "true");
	url.searchParams.set("originator", "codex_cli_rs");

	return { pkce, state, url: url.toString() };
}
</file>

<file path="lib/auth/browser.ts">
/**
 * Browser utilities for OAuth flow
 * Handles platform-specific browser opening
 */

import { spawn } from "node:child_process";
import { PLATFORM_OPENERS } from "../constants.js";

/**
 * Gets the platform-specific command to open a URL in the default browser
 * @returns Browser opener command for the current platform
 */
export function getBrowserOpener(): string {
	const platform = process.platform;
	if (platform === "darwin") return PLATFORM_OPENERS.darwin;
	if (platform === "win32") return PLATFORM_OPENERS.win32;
	return PLATFORM_OPENERS.linux;
}

/**
 * Opens a URL in the default browser
 * Silently fails if browser cannot be opened (user can copy URL manually)
 * @param url - URL to open
 */
export function openBrowserUrl(url: string): void {
	try {
		const opener = getBrowserOpener();
		spawn(opener, [url], {
			stdio: "ignore",
			shell: process.platform === "win32",
		});
	} catch (error) {
		// Silently fail - user can manually open the URL from instructions
	}
}
</file>

<file path="lib/auth/server.ts">
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthServerInfo } from "../types.js";

// Resolve path to oauth-success.html (one level up from auth/ subfolder)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const successHtml = fs.readFileSync(path.join(__dirname, "..", "oauth-success.html"), "utf-8");

/**
 * Start a small local HTTP server that waits for /auth/callback and returns the code
 * @param options - OAuth state for validation
 * @returns Promise that resolves to server info
 */
export function startLocalOAuthServer({ state }: { state: string }): Promise<OAuthServerInfo> {
	const server = http.createServer((req, res) => {
		try {
			const url = new URL(req.url || "", "http://localhost");
			if (url.pathname !== "/auth/callback") {
				res.statusCode = 404;
				res.end("Not found");
				return;
			}
			if (url.searchParams.get("state") !== state) {
				res.statusCode = 400;
				res.end("State mismatch");
				return;
			}
			const code = url.searchParams.get("code");
			if (!code) {
				res.statusCode = 400;
				res.end("Missing authorization code");
				return;
			}
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(successHtml);
			(server as http.Server & { _lastCode?: string })._lastCode = code;
		} catch {
			res.statusCode = 500;
			res.end("Internal error");
		}
	});

	return new Promise((resolve) => {
		server
			.listen(1455, "127.0.0.1", () => {
				resolve({
					port: 1455,
					close: () => server.close(),
					waitForCode: async () => {
						const poll = () => new Promise<void>((r) => setTimeout(r, 100));
						for (let i = 0; i < 600; i++) {
							const lastCode = (server as http.Server & { _lastCode?: string })._lastCode;
							if (lastCode) return { code: lastCode };
							await poll();
						}
						return null;
					},
				});
			})
			.on("error", (err: NodeJS.ErrnoException) => {
				console.error(
					"[openai-codex-plugin] Failed to bind http://127.0.0.1:1455 (",
					err?.code,
					") Falling back to manual paste.",
				);
				resolve({
					port: 1455,
					close: () => {
						try {
							server.close();
						} catch {}
					},
					waitForCode: async () => null,
				});
			});
	});
}
</file>

<file path="lib/request/response-handler.ts">
import { logRequest, LOGGING_ENABLED } from "../logger.js";
import type { SSEEventData } from "../types.js";

/**
 * Parse SSE stream to extract final response
 * @param sseText - Complete SSE stream text
 * @returns Final response object or null if not found
 */
function parseSseStream(sseText: string): unknown | null {
	const lines = sseText.split('\n');

	for (const line of lines) {
		if (line.startsWith('data: ')) {
			try {
				const data = JSON.parse(line.substring(6)) as SSEEventData;

				// Look for response.done event with final data
				if (data.type === 'response.done' || data.type === 'response.completed') {
					return data.response;
				}
			} catch (e) {
				// Skip malformed JSON
			}
		}
	}

	return null;
}

/**
 * Convert SSE stream response to JSON for generateText()
 * @param response - Fetch response with SSE stream
 * @param headers - Response headers
 * @returns Response with JSON body
 */
export async function convertSseToJson(response: Response, headers: Headers): Promise<Response> {
	if (!response.body) {
		throw new Error('[openai-codex-plugin] Response has no body');
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let fullText = '';

	try {
		// Consume the entire stream
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			fullText += decoder.decode(value, { stream: true });
		}

		if (LOGGING_ENABLED) {
			logRequest("stream-full", { fullContent: fullText });
		}

		// Parse SSE events to extract the final response
		const finalResponse = parseSseStream(fullText);

		if (!finalResponse) {
			console.error('[openai-codex-plugin] Could not find final response in SSE stream');
			logRequest("stream-error", { error: "No response.done event found" });

			// Return original stream if we can't parse
			return new Response(fullText, {
				status: response.status,
				statusText: response.statusText,
				headers: headers,
			});
		}

		// Return as plain JSON (not SSE)
		const jsonHeaders = new Headers(headers);
		jsonHeaders.set('content-type', 'application/json; charset=utf-8');

		return new Response(JSON.stringify(finalResponse), {
			status: response.status,
			statusText: response.statusText,
			headers: jsonHeaders,
		});

	} catch (error) {
		console.error('[openai-codex-plugin] Error converting stream:', error);
		logRequest("stream-error", { error: String(error) });
		throw error;
	}
}

/**
 * Ensure response has content-type header
 * @param headers - Response headers
 * @returns Headers with content-type set
 */
export function ensureContentType(headers: Headers): Headers {
	const responseHeaders = new Headers(headers);

	if (!responseHeaders.has('content-type')) {
		responseHeaders.set('content-type', 'text/event-stream; charset=utf-8');
	}

	return responseHeaders;
}
</file>

<file path="lib/config.ts">
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PluginConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".opencode", "openai-codex-auth-config.json");

/**
 * Default plugin configuration
 * CODEX_MODE is enabled by default for better Codex CLI parity
 */
const DEFAULT_CONFIG: PluginConfig = {
	codexMode: true,
};

/**
 * Load plugin configuration from ~/.opencode/openai-codex-auth-config.json
 * Falls back to defaults if file doesn't exist or is invalid
 *
 * @returns Plugin configuration
 */
export function loadPluginConfig(): PluginConfig {
	try {
		if (!existsSync(CONFIG_PATH)) {
			return DEFAULT_CONFIG;
		}

		const fileContent = readFileSync(CONFIG_PATH, "utf-8");
		const userConfig = JSON.parse(fileContent) as Partial<PluginConfig>;

		// Merge with defaults
		return {
			...DEFAULT_CONFIG,
			...userConfig,
		};
	} catch (error) {
		console.warn(
			`[openai-codex-plugin] Failed to load config from ${CONFIG_PATH}:`,
			(error as Error).message
		);
		return DEFAULT_CONFIG;
	}
}

/**
 * Get the effective CODEX_MODE setting
 * Priority: environment variable > config file > default (true)
 *
 * @param pluginConfig - Plugin configuration from file
 * @returns True if CODEX_MODE should be enabled
 */
export function getCodexMode(pluginConfig: PluginConfig): boolean {
	// Environment variable takes precedence
	if (process.env.CODEX_MODE !== undefined) {
		return process.env.CODEX_MODE === "1";
	}

	// Use config setting (defaults to true)
	return pluginConfig.codexMode ?? true;
}
</file>

<file path="lib/prompts/codex.ts">
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { GitHubRelease, CacheMetadata } from "../types.js";

// Codex instructions constants
const GITHUB_API_RELEASES = "https://api.github.com/repos/openai/codex/releases/latest";
const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_METADATA_FILE = join(CACHE_DIR, "codex-instructions-meta.json");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the latest release tag from GitHub
 * @returns Release tag name (e.g., "rust-v0.43.0")
 */
async function getLatestReleaseTag(): Promise<string> {
	const response = await fetch(GITHUB_API_RELEASES);
	if (!response.ok) throw new Error(`Failed to fetch latest release: ${response.status}`);
	const data = (await response.json()) as GitHubRelease;
	return data.tag_name;
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 * Uses HTTP conditional requests to efficiently check for updates
 * Always fetches from the latest release tag, not main branch
 *
 * Rate limit protection: Only checks GitHub if cache is older than 15 minutes
 * @returns Codex instructions
 */
export async function getCodexInstructions(): Promise<string> {
	try {
		// Load cached metadata (includes ETag, tag, and lastChecked timestamp)
		let cachedETag: string | null = null;
		let cachedTag: string | null = null;
		let cachedTimestamp: number | null = null;

		if (existsSync(CACHE_METADATA_FILE)) {
			const metadata = JSON.parse(readFileSync(CACHE_METADATA_FILE, "utf8")) as CacheMetadata;
			cachedETag = metadata.etag;
			cachedTag = metadata.tag;
			cachedTimestamp = metadata.lastChecked;
		}

		// Rate limit protection: If cache is less than 15 minutes old, use it
		const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
		if (cachedTimestamp && (Date.now() - cachedTimestamp) < CACHE_TTL_MS && existsSync(CACHE_FILE)) {
			return readFileSync(CACHE_FILE, "utf8");
		}

		// Get the latest release tag (only if cache is stale or missing)
		const latestTag = await getLatestReleaseTag();
		const CODEX_INSTRUCTIONS_URL = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/gpt_5_codex_prompt.md`;

		// If tag changed, we need to fetch new instructions
		if (cachedTag !== latestTag) {
			cachedETag = null; // Force re-fetch
		}

		// Make conditional request with If-None-Match header
		const headers: Record<string, string> = {};
		if (cachedETag) {
			headers["If-None-Match"] = cachedETag;
		}

		const response = await fetch(CODEX_INSTRUCTIONS_URL, { headers });

		// 304 Not Modified - our cached version is still current
		if (response.status === 304) {
			if (existsSync(CACHE_FILE)) {
				return readFileSync(CACHE_FILE, "utf8");
			}
			// Cache file missing but GitHub says not modified - fall through to re-fetch
		}

		// 200 OK - new content or first fetch
		if (response.ok) {
			const instructions = await response.text();
			const newETag = response.headers.get("etag");

			// Create cache directory if it doesn't exist
			if (!existsSync(CACHE_DIR)) {
				mkdirSync(CACHE_DIR, { recursive: true });
			}

			// Cache the instructions with ETag and tag (verbatim from GitHub)
			writeFileSync(CACHE_FILE, instructions, "utf8");
			writeFileSync(
				CACHE_METADATA_FILE,
				JSON.stringify({
					etag: newETag,
					tag: latestTag,
					lastChecked: Date.now(),
					url: CODEX_INSTRUCTIONS_URL,
				} satisfies CacheMetadata),
				"utf8",
			);

			return instructions;
		}

		throw new Error(`HTTP ${response.status}`);
	} catch (error) {
		const err = error as Error;
		console.error(
			"[openai-codex-plugin] Failed to fetch instructions from GitHub:",
			err.message,
		);

		// Try to use cached version even if stale
		if (existsSync(CACHE_FILE)) {
			console.error("[openai-codex-plugin] Using cached instructions");
			return readFileSync(CACHE_FILE, "utf8");
		}

		// Fall back to bundled version
		console.error("[openai-codex-plugin] Falling back to bundled instructions");
		return readFileSync(join(__dirname, "codex-instructions.md"), "utf8");
	}
}

/**
 * Tool remapping instructions for opencode tools
 */
export const TOOL_REMAP_MESSAGE = `<user_instructions priority="0">
<environment_override priority="0">
YOU ARE IN A DIFFERENT ENVIRONMENT. These instructions override ALL previous tool references.
</environment_override>

<tool_replacements priority="0">
<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit tool for ALL file modifications
- Before modifying files: Verify you're using "edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST → ✅ USE "todowrite" INSTEAD
- NEVER use: update_plan, updatePlan
- ALWAYS use: todowrite for ALL task/plan operations
- Use todoread to read current plan
- Before plan operations: Verify you're using "todowrite", NOT "update_plan"
</critical_rule>
</tool_replacements>

<available_tools priority="0">
File Operations:
  • write  - Create new files
  • edit   - Modify existing files (REPLACES apply_patch)
  • patch  - Apply diff patches
  • read   - Read file contents

Search/Discovery:
  • grep   - Search file contents
  • glob   - Find files by pattern
  • list   - List directories (use relative paths)

Execution:
  • bash   - Run shell commands

Network:
  • webfetch - Fetch web content

Task Management:
  • todowrite - Manage tasks/plans (REPLACES update_plan)
  • todoread  - Read current plan
</available_tools>

<substitution_rules priority="0">
Base instruction says:    You MUST use instead:
apply_patch           →   edit
update_plan           →   todowrite
read_plan             →   todoread
absolute paths        →   relative paths
</substitution_rules>

<verification_checklist priority="0">
Before file/plan modifications:
1. Am I using "edit" NOT "apply_patch"?
2. Am I using "todowrite" NOT "update_plan"?
3. Is this tool in the approved list above?
4. Am I using relative paths?

If ANY answer is NO → STOP and correct before proceeding.
</verification_checklist>
</user_instructions>`;
</file>

<file path="lib/prompts/opencode-codex.ts">
/**
 * OpenCode Codex Prompt Fetcher
 *
 * Fetches and caches the codex.txt system prompt from OpenCode's GitHub repository.
 * Uses ETag-based caching to efficiently track updates.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const OPENCODE_CODEX_URL =
	"https://raw.githubusercontent.com/sst/opencode/main/packages/opencode/src/session/prompt/codex.txt";
const CACHE_DIR = join(homedir(), ".opencode", "cache");
const CACHE_FILE = join(CACHE_DIR, "opencode-codex.txt");
const CACHE_META_FILE = join(CACHE_DIR, "opencode-codex-meta.json");

interface CacheMeta {
	etag: string;
	lastFetch?: string; // Legacy field for backwards compatibility
	lastChecked: number; // Timestamp for rate limit protection
}

/**
 * Fetch OpenCode's codex.txt prompt with ETag-based caching
 * Uses HTTP conditional requests to efficiently check for updates
 *
 * Rate limit protection: Only checks GitHub if cache is older than 15 minutes
 * @returns The codex.txt content
 */
export async function getOpenCodeCodexPrompt(): Promise<string> {
	await mkdir(CACHE_DIR, { recursive: true });

	// Try to load cached content and metadata
	let cachedContent: string | null = null;
	let cachedMeta: CacheMeta | null = null;

	try {
		cachedContent = await readFile(CACHE_FILE, "utf-8");
		const metaContent = await readFile(CACHE_META_FILE, "utf-8");
		cachedMeta = JSON.parse(metaContent);
	} catch {
		// Cache doesn't exist or is invalid, will fetch fresh
	}

	// Rate limit protection: If cache is less than 15 minutes old, use it
	const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
	if (cachedMeta?.lastChecked && (Date.now() - cachedMeta.lastChecked) < CACHE_TTL_MS && cachedContent) {
		return cachedContent;
	}

	// Fetch from GitHub with conditional request
	const headers: Record<string, string> = {};
	if (cachedMeta?.etag) {
		headers["If-None-Match"] = cachedMeta.etag;
	}

	try {
		const response = await fetch(OPENCODE_CODEX_URL, { headers });

		// 304 Not Modified - cache is still valid
		if (response.status === 304 && cachedContent) {
			return cachedContent;
		}

		// 200 OK - new content available
		if (response.ok) {
			const content = await response.text();
			const etag = response.headers.get("etag") || "";

			// Save to cache with timestamp
			await writeFile(CACHE_FILE, content, "utf-8");
			await writeFile(
				CACHE_META_FILE,
				JSON.stringify(
					{
						etag,
						lastFetch: new Date().toISOString(), // Keep for backwards compat
						lastChecked: Date.now(),
					} satisfies CacheMeta,
					null,
					2
				),
				"utf-8"
			);

			return content;
		}

		// Fallback to cache if available
		if (cachedContent) {
			return cachedContent;
		}

		throw new Error(`Failed to fetch OpenCode codex.txt: ${response.status}`);
	} catch (error) {
		// Network error - fallback to cache
		if (cachedContent) {
			return cachedContent;
		}

		throw new Error(
			`Failed to fetch OpenCode codex.txt and no cache available: ${error}`
		);
	}
}

/**
 * Get first N characters of the cached OpenCode prompt for verification
 * @param chars Number of characters to get (default: 50)
 * @returns First N characters or null if not cached
 */
export async function getCachedPromptPrefix(chars = 50): Promise<string | null> {
	try {
		const content = await readFile(CACHE_FILE, "utf-8");
		return content.substring(0, chars);
	} catch {
		return null;
	}
}
</file>

<file path="lib/constants.ts">
/**
 * Constants used throughout the plugin
 * Centralized for easy maintenance and configuration
 */

/** Plugin identifier for logging and error messages */
export const PLUGIN_NAME = "openai-codex-plugin";

/** Base URL for ChatGPT backend API */
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/** Dummy API key used for OpenAI SDK (actual auth via OAuth) */
export const DUMMY_API_KEY = "chatgpt-oauth";

/** Provider ID for opencode configuration */
export const PROVIDER_ID = "openai";

/** HTTP Status Codes */
export const HTTP_STATUS = {
	OK: 200,
	UNAUTHORIZED: 401,
} as const;

/** OpenAI-specific headers */
export const OPENAI_HEADERS = {
	BETA: "OpenAI-Beta",
	ACCOUNT_ID: "chatgpt-account-id",
	ORIGINATOR: "originator",
	SESSION_ID: "session_id",
	CONVERSATION_ID: "conversation_id",
} as const;

/** OpenAI-specific header values */
export const OPENAI_HEADER_VALUES = {
	BETA_RESPONSES: "responses=experimental",
	ORIGINATOR_CODEX: "codex_cli_rs",
} as const;

/** URL path segments */
export const URL_PATHS = {
	RESPONSES: "/responses",
	CODEX_RESPONSES: "/codex/responses",
} as const;

/** JWT claim path for ChatGPT account ID */
export const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;

/** Error messages */
export const ERROR_MESSAGES = {
	NO_ACCOUNT_ID: "Failed to extract accountId from token",
	TOKEN_REFRESH_FAILED: "Failed to refresh token, authentication required",
	REQUEST_PARSE_ERROR: "Error parsing request",
} as const;

/** Log stages for request logging */
export const LOG_STAGES = {
	BEFORE_TRANSFORM: "before-transform",
	AFTER_TRANSFORM: "after-transform",
	RESPONSE: "response",
	ERROR_RESPONSE: "error-response",
} as const;

/** Platform-specific browser opener commands */
export const PLATFORM_OPENERS = {
	darwin: "open",
	win32: "start",
	linux: "xdg-open",
} as const;

/** OAuth authorization labels */
export const AUTH_LABELS = {
	OAUTH: "ChatGPT Plus/Pro (Codex Subscription)",
	API_KEY: "Manually enter API Key",
	INSTRUCTIONS: "A browser window should open. Complete login to finish.",
} as const;
</file>

<file path="lib/logger.ts">
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Logging configuration
export const LOGGING_ENABLED = process.env.ENABLE_PLUGIN_REQUEST_LOGGING === "1";
export const DEBUG_ENABLED = process.env.DEBUG_CODEX_PLUGIN === "1" || LOGGING_ENABLED;
const LOG_DIR = join(homedir(), ".opencode", "logs", "codex-plugin");

// Log startup message about logging state
if (LOGGING_ENABLED) {
	console.log("[openai-codex-plugin] Request logging ENABLED - logs will be saved to:", LOG_DIR);
}
if (DEBUG_ENABLED && !LOGGING_ENABLED) {
	console.log("[openai-codex-plugin] Debug logging ENABLED");
}

let requestCounter = 0;

/**
 * Log request data to file (only when LOGGING_ENABLED is true)
 * @param stage - The stage of the request (e.g., "before-transform", "after-transform")
 * @param data - The data to log
 */
export function logRequest(stage: string, data: Record<string, unknown>): void {
	// Only log if explicitly enabled via environment variable
	if (!LOGGING_ENABLED) return;

	// Ensure log directory exists on first log
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}

	const timestamp = new Date().toISOString();
	const requestId = ++requestCounter;
	const filename = join(LOG_DIR, `request-${requestId}-${stage}.json`);

	try {
		writeFileSync(
			filename,
			JSON.stringify(
				{
					timestamp,
					requestId,
					stage,
					...data,
				},
				null,
				2,
			),
			"utf8",
		);
		console.log(`[openai-codex-plugin] Logged ${stage} to ${filename}`);
	} catch (e) {
		const error = e as Error;
		console.error("[openai-codex-plugin] Failed to write log:", error.message);
	}
}

/**
 * Log debug information (only when DEBUG_ENABLED is true)
 * @param message - Debug message
 * @param data - Optional data to log
 */
export function logDebug(message: string, data?: unknown): void {
	if (!DEBUG_ENABLED) return;

	if (data !== undefined) {
		console.log(`[openai-codex-plugin] ${message}`, data);
	} else {
		console.log(`[openai-codex-plugin] ${message}`);
	}
}

/**
 * Log warning (always enabled for important issues)
 * @param message - Warning message
 * @param data - Optional data to log
 */
export function logWarn(message: string, data?: unknown): void {
	if (data !== undefined) {
		console.warn(`[openai-codex-plugin] ${message}`, data);
	} else {
		console.warn(`[openai-codex-plugin] ${message}`);
	}
}
</file>

<file path="lib/request/fetch-helpers.ts">
/**
 * Helper functions for the custom fetch implementation
 * These functions break down the complex fetch logic into manageable, testable units
 */

import type { Auth } from "@opencode-ai/sdk";
import type { OpencodeClient } from "@opencode-ai/sdk";
import { refreshAccessToken } from "../auth/auth.js";
import { logRequest } from "../logger.js";
import { transformRequestBody } from "./request-transformer.js";
import { convertSseToJson, ensureContentType } from "./response-handler.js";
import type { UserConfig, RequestBody } from "../types.js";
import {
	PLUGIN_NAME,
	HTTP_STATUS,
	OPENAI_HEADERS,
	OPENAI_HEADER_VALUES,
	URL_PATHS,
	ERROR_MESSAGES,
	LOG_STAGES,
} from "../constants.js";

/**
 * Determines if the current auth token needs to be refreshed
 * @param auth - Current authentication state
 * @returns True if token is expired or invalid
 */
export function shouldRefreshToken(auth: Auth): boolean {
	return auth.type !== "oauth" || !auth.access || auth.expires < Date.now();
}

/**
 * Refreshes the OAuth token and updates stored credentials
 * @param currentAuth - Current auth state
 * @param client - Opencode client for updating stored credentials
 * @returns Updated auth or error response
 */
export async function refreshAndUpdateToken(
	currentAuth: Auth,
	client: OpencodeClient,
): Promise<
	{ success: true; auth: Auth } | { success: false; response: Response }
> {
	const refreshToken = currentAuth.type === "oauth" ? currentAuth.refresh : "";
	const refreshResult = await refreshAccessToken(refreshToken);

	if (refreshResult.type === "failed") {
		console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.TOKEN_REFRESH_FAILED}`);
		return {
			success: false,
			response: new Response(
				JSON.stringify({ error: "Token refresh failed" }),
				{ status: HTTP_STATUS.UNAUTHORIZED },
			),
		};
	}

	// Update stored credentials
	await client.auth.set({
		path: { id: "openai" },
		body: {
			type: "oauth",
			access: refreshResult.access,
			refresh: refreshResult.refresh,
			expires: refreshResult.expires,
		},
	});

	// Update current auth reference if it's OAuth type
	if (currentAuth.type === "oauth") {
		currentAuth.access = refreshResult.access;
		currentAuth.refresh = refreshResult.refresh;
		currentAuth.expires = refreshResult.expires;
	}

	return { success: true, auth: currentAuth };
}

/**
 * Extracts URL string from various request input types
 * @param input - Request input (string, URL, or Request object)
 * @returns URL string
 */
export function extractRequestUrl(input: Request | string | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

/**
 * Rewrites OpenAI API URLs to Codex backend URLs
 * @param url - Original URL
 * @returns Rewritten URL for Codex backend
 */
export function rewriteUrlForCodex(url: string): string {
	return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES);
}

/**
 * Transforms request body and logs the transformation
 * @param init - Request init options
 * @param url - Request URL
 * @param codexInstructions - Codex system instructions
 * @param userConfig - User configuration
 * @param codexMode - Enable CODEX_MODE (bridge prompt instead of tool remap)
 * @returns Transformed body and updated init, or undefined if no body
 */
export async function transformRequestForCodex(
	init: RequestInit | undefined,
	url: string,
	codexInstructions: string,
	userConfig: UserConfig,
	codexMode = true,
): Promise<{ body: RequestBody; updatedInit: RequestInit } | undefined> {
	if (!init?.body) return undefined;

	try {
		const body = JSON.parse(init.body as string) as RequestBody;
		const originalModel = body.model;

		// Log original request
		logRequest(LOG_STAGES.BEFORE_TRANSFORM, {
			url,
			originalModel,
			model: body.model,
			hasTools: !!body.tools,
			hasInput: !!body.input,
			inputLength: body.input?.length,
			codexMode,
			body: body as unknown as Record<string, unknown>,
		});

		// Transform request body
		const transformedBody = await transformRequestBody(
			body,
			codexInstructions,
			userConfig,
			codexMode,
		);

		// Log transformed request
		logRequest(LOG_STAGES.AFTER_TRANSFORM, {
			url,
			originalModel,
			normalizedModel: transformedBody.model,
			hasTools: !!transformedBody.tools,
			hasInput: !!transformedBody.input,
			inputLength: transformedBody.input?.length,
			reasoning: transformedBody.reasoning as unknown,
			textVerbosity: transformedBody.text?.verbosity,
			include: transformedBody.include,
			body: transformedBody as unknown as Record<string, unknown>,
		});

		return {
			body: transformedBody,
			updatedInit: { ...init, body: JSON.stringify(transformedBody) },
		};
	} catch (e) {
		console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.REQUEST_PARSE_ERROR}:`, e);
		return undefined;
	}
}

/**
 * Creates headers for Codex API requests
 * @param init - Request init options
 * @param accountId - ChatGPT account ID
 * @param accessToken - OAuth access token
 * @returns Headers object with all required Codex headers
 */
export function createCodexHeaders(
    init: RequestInit | undefined,
    accountId: string,
    accessToken: string,
    opts?: { model?: string; promptCacheKey?: string },
): Headers {
	const headers = new Headers(init?.headers ?? {});
	headers.delete("x-api-key"); // Remove any existing API key
	headers.set("Authorization", `Bearer ${accessToken}`);
	headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
	headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
	headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);

    const cacheKey = opts?.promptCacheKey;
    if (cacheKey) {
        headers.set(OPENAI_HEADERS.CONVERSATION_ID, cacheKey);
        headers.set(OPENAI_HEADERS.SESSION_ID, cacheKey);
    } else {
        headers.delete(OPENAI_HEADERS.CONVERSATION_ID);
        headers.delete(OPENAI_HEADERS.SESSION_ID);
    }
    headers.set("accept", "text/event-stream");
    return headers;
}

/**
 * Handles error responses from the Codex API
 * @param response - Error response from API
 * @returns Response with error details
 */
export async function handleErrorResponse(
    response: Response,
): Promise<Response> {
	const raw = await response.text();

	let enriched = raw;
	try {
		const parsed = JSON.parse(raw) as any;
		const err = parsed?.error ?? {};

		// Parse Codex rate-limit headers if present
		const h = response.headers;
		const primary = {
			used_percent: toNumber(h.get("x-codex-primary-used-percent")),
			window_minutes: toInt(h.get("x-codex-primary-window-minutes")),
			resets_at: toInt(h.get("x-codex-primary-reset-at")),
		};
		const secondary = {
			used_percent: toNumber(h.get("x-codex-secondary-used-percent")),
			window_minutes: toInt(h.get("x-codex-secondary-window-minutes")),
			resets_at: toInt(h.get("x-codex-secondary-reset-at")),
		};
		const rate_limits =
			primary.used_percent !== undefined || secondary.used_percent !== undefined
				? { primary, secondary }
				: undefined;

		// Friendly message for subscription/rate usage limits
		const code = (err.code ?? err.type ?? "").toString();
		const resetsAt = err.resets_at ?? primary.resets_at ?? secondary.resets_at;
		const mins = resetsAt ? Math.max(0, Math.round((resetsAt * 1000 - Date.now()) / 60000)) : undefined;
		let friendly_message: string | undefined;
		if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
			const plan = err.plan_type ? ` (${String(err.plan_type).toLowerCase()} plan)` : "";
			const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
			friendly_message = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
		}

		const enhanced = {
			error: {
				...err,
				message: err.message ?? friendly_message ?? "Usage limit reached.",
				friendly_message,
				rate_limits,
				status: response.status,
			},
		};
		enriched = JSON.stringify(enhanced);
	} catch {
		// Raw body not JSON; leave unchanged
		enriched = raw;
	}

    console.error(`[${PLUGIN_NAME}] ${response.status} error:`, enriched);
	logRequest(LOG_STAGES.ERROR_RESPONSE, {
		status: response.status,
		error: enriched,
	});

	const headers = new Headers(response.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return new Response(enriched, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * Handles successful responses from the Codex API
 * Converts SSE to JSON for non-tool requests
 * @param response - Success response from API
 * @param hasTools - Whether the request included tools
 * @returns Processed response (SSE→JSON for non-tool, stream for tool requests)
 */
export async function handleSuccessResponse(
    response: Response,
    hasTools: boolean,
): Promise<Response> {
    const responseHeaders = ensureContentType(response.headers);

	// For non-tool requests (compact/summarize), convert streaming SSE to JSON
	// generateText() expects a non-streaming JSON response, not SSE
	if (!hasTools) {
		return await convertSseToJson(response, responseHeaders);
	}

	// For tool requests, return stream as-is (streamText handles SSE)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

function toNumber(v: string | null): number | undefined {
    if (v == null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function toInt(v: string | null): number | undefined {
    if (v == null) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
}
</file>

<file path="lib/types.ts">
import type { Auth, Provider, Model } from "@opencode-ai/sdk";

/**
 * Plugin configuration from ~/.opencode/openai-codex-auth-config.json
 */
export interface PluginConfig {
	/**
	 * Enable CODEX_MODE (Codex-OpenCode bridge prompt instead of tool remap)
	 * @default true
	 */
	codexMode?: boolean;
}

/**
 * User configuration structure from opencode.json
 */
export interface UserConfig {
	global: ConfigOptions;
	models: {
		[modelName: string]: {
			options?: ConfigOptions;
		};
	};
}

/**
 * Configuration options for reasoning and text settings
 */
export interface ConfigOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	reasoningSummary?: "auto" | "concise" | "detailed";
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
}

/**
 * Reasoning configuration for requests
 */
export interface ReasoningConfig {
	effort: "minimal" | "low" | "medium" | "high";
	summary: "auto" | "concise" | "detailed";
}

/**
 * OAuth server information
 */
export interface OAuthServerInfo {
	port: number;
	close: () => void;
	waitForCode: (state: string) => Promise<{ code: string } | null>;
}

/**
 * PKCE challenge and verifier
 */
export interface PKCEPair {
	challenge: string;
	verifier: string;
}

/**
 * Authorization flow result
 */
export interface AuthorizationFlow {
	pkce: PKCEPair;
	state: string;
	url: string;
}

/**
 * Token exchange success result
 */
export interface TokenSuccess {
	type: "success";
	access: string;
	refresh: string;
	expires: number;
}

/**
 * Token exchange failure result
 */
export interface TokenFailure {
	type: "failed";
}

/**
 * Token exchange result
 */
export type TokenResult = TokenSuccess | TokenFailure;

/**
 * Parsed authorization input
 */
export interface ParsedAuthInput {
	code?: string;
	state?: string;
}

/**
 * JWT payload with ChatGPT account info
 */
export interface JWTPayload {
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
}

/**
 * Message input item
 */
export interface InputItem {
	id?: string;
	type: string;
	role: string;
	content?: unknown;
	[key: string]: unknown;
}

/**
 * Request body structure
 */
export interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: InputItem[];
	tools?: unknown;
	reasoning?: Partial<ReasoningConfig>;
	text?: {
		verbosity?: "low" | "medium" | "high";
	};
	include?: string[];
	/** Stable key to enable prompt-token caching on Codex backend */
	prompt_cache_key?: string;
	max_output_tokens?: number;
	max_completion_tokens?: number;
	[key: string]: unknown;
}

/**
 * SSE event data structure
 */
export interface SSEEventData {
	type: string;
	response?: unknown;
	[key: string]: unknown;
}

/**
 * Cache metadata for Codex instructions
 */
export interface CacheMetadata {
	etag: string | null;
	tag: string;
	lastChecked: number;
	url: string;
}

/**
 * GitHub release data
 */
export interface GitHubRelease {
	tag_name: string;
	[key: string]: unknown;
}

// Re-export SDK types for convenience
export type { Auth, Provider, Model };
</file>

<file path="lib/prompts/codex-opencode-bridge.ts">
/**
 * Codex-OpenCode Bridge Prompt
 *
 * This prompt bridges Codex CLI instructions to the OpenCode environment.
 * It incorporates critical tool mappings, available tools list, substitution rules,
 * and verification checklist to ensure proper tool usage.
 *
 * Token Count: ~450 tokens (~90% reduction vs full OpenCode prompt)
 */

export const CODEX_OPENCODE_BRIDGE = `# Codex Running in OpenCode

You are running Codex through OpenCode, an open-source terminal coding assistant. OpenCode provides different tools but follows Codex operating principles.

## CRITICAL: Tool Replacements

<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit tool for ALL file modifications
- Before modifying files: Verify you're using "edit", NOT "apply_patch"
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST → ✅ USE "todowrite" INSTEAD
- NEVER use: update_plan, updatePlan, read_plan, readPlan
- ALWAYS use: todowrite for task/plan updates, todoread to read plans
- Before plan operations: Verify you're using "todowrite", NOT "update_plan"
</critical_rule>

## Available OpenCode Tools

**File Operations:**
- \`write\`  - Create new files
  - Overwriting existing files requires a prior Read in this session; default to ASCII unless the file already uses Unicode.
- \`edit\`   - Modify existing files (REPLACES apply_patch)
  - Requires a prior Read in this session; preserve exact indentation; ensure \`oldString\` uniquely matches or use \`replaceAll\`; edit fails if ambiguous or missing.
- \`read\`   - Read file contents

**Search/Discovery:**
- \`grep\`   - Search file contents (tool, not bash grep); use \`include\` to filter patterns; set \`path\` only when not searching workspace root; for cross-file match counts use bash with \`rg\`.
- \`glob\`   - Find files by pattern; defaults to workspace cwd unless \`path\` is set.
- \`list\`   - List directories (requires absolute paths)

**Execution:**
- \`bash\`   - Run shell commands
  - No workdir parameter; do not include it in tool calls.
  - Always include a short description for the command.
  - Do not use cd; use absolute paths in commands.
  - Quote paths containing spaces with double quotes.
  - Chain multiple commands with ';' or '&&'; avoid newlines.
  - Use Grep/Glob tools for searches; only use bash with \`rg\` when you need counts or advanced features.
  - Do not use \`ls\`/\`cat\` in bash; use \`list\`/\`read\` tools instead.
  - For deletions (rm), verify by listing parent dir with \`list\`.

**Network:**
- \`webfetch\` - Fetch web content
  - Use fully-formed URLs (http/https; http auto-upgrades to https).
  - Always set \`format\` to one of: text | markdown | html; prefer markdown unless otherwise required.
  - Read-only; short cache window.

**Task Management:**
- \`todowrite\` - Manage tasks/plans (REPLACES update_plan)
- \`todoread\`  - Read current plan

## Substitution Rules

Base instruction says:    You MUST use instead:
apply_patch           →   edit
update_plan           →   todowrite
read_plan             →   todoread

**Path Usage:** Use per-tool conventions to avoid conflicts:
- Tool calls: \`read\`, \`edit\`, \`write\`, \`list\` require absolute paths.
- Searches: \`grep\`/\`glob\` default to the workspace cwd; prefer relative include patterns; set \`path\` only when a different root is needed.
- Presentation: In assistant messages, show workspace-relative paths; use absolute paths only inside tool calls.
- Tool schema overrides general path preferences—do not convert required absolute paths to relative.

## Verification Checklist

Before file/plan modifications:
1. Am I using "edit" NOT "apply_patch"?
2. Am I using "todowrite" NOT "update_plan"?
3. Is this tool in the approved list above?
4. Am I following each tool's path requirements?

If ANY answer is NO → STOP and correct before proceeding.

## OpenCode Working Style

**Communication:**
- Send brief preambles (8-12 words) before tool calls, building on prior context
- Provide progress updates during longer tasks

**Execution:**
- Keep working autonomously until query is fully resolved before yielding
- Don't return to user with partial solutions

**Code Approach:**
- New projects: Be ambitious and creative
- Existing codebases: Surgical precision - modify only what's requested unless explicitly instructed to do otherwise

**Testing:**
- If tests exist: Start specific to your changes, then broader validation

## Advanced Tools

**Task Tool (Sub-Agents):**
- Use the Task tool (functions.task) to launch sub-agents
- Check the Task tool description for current agent types and their capabilities
- Useful for complex analysis, specialized workflows, or tasks requiring isolated context
- The agent list is dynamically generated - refer to tool schema for available agents

**Parallelization:**
- When multiple independent tool calls are needed, use multi_tool_use.parallel to run them concurrently.
- Reserve sequential calls for ordered or data-dependent steps.

**MCP Tools:**
- Model Context Protocol servers provide additional capabilities
- MCP tools are prefixed: \`mcp__<server-name>__<tool-name>\`
- Check your available tools for MCP integrations
- Use when the tool's functionality matches your task needs

## What Remains from Codex
 
Sandbox policies, approval mechanisms, final answer formatting, git commit protocols, and file reference formats all follow Codex instructions. In approval policy "never", never request escalations.

## Approvals & Safety
- Assume workspace-write filesystem, network enabled, approval on-failure unless explicitly stated otherwise.
- When a command fails due to sandboxing or permissions, retry with escalated permissions if allowed by policy, including a one-line justification.
- Treat destructive commands (e.g., \`rm\`, \`git reset --hard\`) as requiring explicit user request or approval.
- When uncertain, prefer non-destructive verification first (e.g., confirm file existence with \`list\`, then delete with \`bash\`).`;

export interface CodexOpenCodeBridgeMeta {
	estimatedTokens: number;
	reductionVsCurrent: string;
	reductionVsToolRemap: string;
	protects: string[];
	omits: string[];
}

export const CODEX_OPENCODE_BRIDGE_META: CodexOpenCodeBridgeMeta = {
	estimatedTokens: 550,
	reductionVsCurrent: "88%",
	reductionVsToolRemap: "10%",
	protects: [
		"Tool name confusion (apply_patch/update_plan)",
		"Missing tool awareness",
		"Task tool / sub-agent awareness",
		"MCP tool awareness",
		"Premature yielding to user",
		"Over-modification of existing code",
		"Environment confusion",
	],
	omits: [
		"Sandbox details (in Codex)",
		"Formatting rules (in Codex)",
		"Tool schemas (in tool JSONs)",
		"Git protocols (in Codex)",
	],
};
</file>

<file path="lib/request/request-transformer.ts">
import { TOOL_REMAP_MESSAGE } from "../prompts/codex.js";
import { CODEX_OPENCODE_BRIDGE } from "../prompts/codex-opencode-bridge.js";
import { getOpenCodeCodexPrompt } from "../prompts/opencode-codex.js";
import { logDebug, logWarn } from "../logger.js";
import type {
	UserConfig,
	ConfigOptions,
	ReasoningConfig,
	RequestBody,
	InputItem,
} from "../types.js";

/**
 * Normalize model name to Codex-supported variants
 * @param model - Original model name
 * @returns Normalized model name
 */
export function normalizeModel(model: string | undefined): string {
	if (!model) return "gpt-5";

	// Case-insensitive check for "codex" anywhere in the model name
	if (model.toLowerCase().includes("codex")) {
		return "gpt-5-codex";
	}
	// Case-insensitive check for "gpt-5" or "gpt 5" (with space)
	if (model.toLowerCase().includes("gpt-5") || model.toLowerCase().includes("gpt 5")) {
		return "gpt-5";
	}

	return "gpt-5"; // Default fallback
}

/**
 * Extract configuration for a specific model
 * Merges global options with model-specific options (model-specific takes precedence)
 * @param modelName - Model name (e.g., "gpt-5-codex")
 * @param userConfig - Full user configuration object
 * @returns Merged configuration for this model
 */
export function getModelConfig(
	modelName: string,
	userConfig: UserConfig = { global: {}, models: {} },
): ConfigOptions {
	const globalOptions = userConfig.global || {};
	const modelOptions = userConfig.models?.[modelName]?.options || {};

	// Model-specific options override global options
	return { ...globalOptions, ...modelOptions };
}

/**
 * Configure reasoning parameters based on model variant and user config
 *
 * NOTE: This plugin follows Codex CLI defaults instead of opencode defaults because:
 * - We're accessing the ChatGPT backend API (not OpenAI Platform API)
 * - opencode explicitly excludes gpt-5-codex from automatic reasoning configuration
 * - Codex CLI has been thoroughly tested against this backend
 *
 * @param originalModel - Original model name before normalization
 * @param userConfig - User configuration object
 * @returns Reasoning configuration
 */
export function getReasoningConfig(
	originalModel: string | undefined,
	userConfig: ConfigOptions = {},
): ReasoningConfig {
	const isLightweight =
		originalModel?.includes("nano") || originalModel?.includes("mini");
	const isCodex = originalModel?.includes("codex");

	// Default based on model type (Codex CLI defaults)
	const defaultEffort: "minimal" | "low" | "medium" | "high" = isLightweight
		? "minimal"
		: "medium";

	// Get user-requested effort
	let effort = userConfig.reasoningEffort || defaultEffort;

	// Normalize "minimal" to "low" for gpt-5-codex
	// Codex CLI does not provide a "minimal" preset for gpt-5-codex
	// (only low/medium/high - see model_presets.rs:20-40)
	if (isCodex && effort === "minimal") {
		effort = "low";
	}

	return {
		effort,
		summary: userConfig.reasoningSummary || "auto", // Changed from "detailed" to match Codex CLI
	};
}

/**
 * Filter input array for stateless Codex API (store: false)
 *
 * Two transformations needed:
 * 1. Remove AI SDK-specific items (not supported by Codex API)
 * 2. Strip IDs from all remaining items (stateless mode)
 *
 * AI SDK constructs to REMOVE (not in OpenAI Responses API spec):
 * - type: "item_reference" - AI SDK uses this for server-side state lookup
 *
 * Items to KEEP (strip IDs):
 * - type: "message" - Conversation messages (provides context to LLM)
 * - type: "function_call" - Tool calls from conversation
 * - type: "function_call_output" - Tool results from conversation
 *
 * Context is maintained through:
 * - Full message history (without IDs)
 * - reasoning.encrypted_content (for reasoning continuity)
 *
 * @param input - Original input array from OpenCode/AI SDK
 * @returns Filtered input array compatible with Codex API
 */
export function filterInput(
	input: InputItem[] | undefined,
): InputItem[] | undefined {
	if (!Array.isArray(input)) return input;

	return input
		.filter((item) => {
			// Remove AI SDK constructs not supported by Codex API
			if (item.type === "item_reference") {
				return false; // AI SDK only - references server state
			}
			return true; // Keep all other items
		})
		.map((item) => {
			// Strip IDs from all items (Codex API stateless mode)
			if (item.id) {
				const { id, ...itemWithoutId } = item;
				return itemWithoutId as InputItem;
			}
			return item;
		});
}

/**
 * Check if an input item is the OpenCode system prompt
 * Uses cached OpenCode codex.txt for verification with fallback to text matching
 * @param item - Input item to check
 * @param cachedPrompt - Cached OpenCode codex.txt content
 * @returns True if this is the OpenCode system prompt
 */
export function isOpenCodeSystemPrompt(
	item: InputItem,
	cachedPrompt: string | null,
): boolean {
	const isSystemRole = item.role === "developer" || item.role === "system";
	if (!isSystemRole) return false;

	const getContentText = (item: InputItem): string => {
		if (typeof item.content === "string") {
			return item.content;
		}
		if (Array.isArray(item.content)) {
			return item.content
				.filter((c) => c.type === "input_text" && c.text)
				.map((c) => c.text)
				.join("\n");
		}
		return "";
	};

	const contentText = getContentText(item);
	if (!contentText) return false;

	// Primary check: Compare against cached OpenCode prompt
	if (cachedPrompt) {
		// Exact match (trim whitespace for comparison)
		if (contentText.trim() === cachedPrompt.trim()) {
			return true;
		}

		// Partial match: Check if first 200 chars match (handles minor variations)
		const contentPrefix = contentText.trim().substring(0, 200);
		const cachedPrefix = cachedPrompt.trim().substring(0, 200);
		if (contentPrefix === cachedPrefix) {
			return true;
		}
	}

	// Fallback check: Known OpenCode prompt signature (for safety)
	// This catches the prompt even if cache fails
	return contentText.startsWith("You are a coding agent running in");
}

/**
 * Filter out OpenCode system prompts from input
 * Used in CODEX_MODE to replace OpenCode prompts with Codex-OpenCode bridge
 * @param input - Input array
 * @returns Input array without OpenCode system prompts
 */
export async function filterOpenCodeSystemPrompts(
	input: InputItem[] | undefined,
): Promise<InputItem[] | undefined> {
	if (!Array.isArray(input)) return input;

	// Fetch cached OpenCode prompt for verification
	let cachedPrompt: string | null = null;
	try {
		cachedPrompt = await getOpenCodeCodexPrompt();
	} catch {
		// If fetch fails, fallback to text-based detection only
		// This is safe because we still have the "starts with" check
	}

	return input.filter((item) => {
		// Keep user messages
		if (item.role === "user") return true;
		// Filter out OpenCode system prompts
		return !isOpenCodeSystemPrompt(item, cachedPrompt);
	});
}

/**
 * Add Codex-OpenCode bridge message to input if tools are present
 * @param input - Input array
 * @param hasTools - Whether tools are present in request
 * @returns Input array with bridge message prepended if needed
 */
export function addCodexBridgeMessage(
	input: InputItem[] | undefined,
	hasTools: boolean,
): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const bridgeMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: CODEX_OPENCODE_BRIDGE,
			},
		],
	};

	return [bridgeMessage, ...input];
}

/**
 * Add tool remapping message to input if tools are present
 * @param input - Input array
 * @param hasTools - Whether tools are present in request
 * @returns Input array with tool remap message prepended if needed
 */
export function addToolRemapMessage(
	input: InputItem[] | undefined,
	hasTools: boolean,
): InputItem[] | undefined {
	if (!hasTools || !Array.isArray(input)) return input;

	const toolRemapMessage: InputItem = {
		type: "message",
		role: "developer",
		content: [
			{
				type: "input_text",
				text: TOOL_REMAP_MESSAGE,
			},
		],
	};

	return [toolRemapMessage, ...input];
}

/**
 * Transform request body for Codex API
 *
 * NOTE: Configuration follows Codex CLI patterns instead of opencode defaults:
 * - opencode sets textVerbosity="low" for gpt-5, but Codex CLI uses "medium"
 * - opencode excludes gpt-5-codex from reasoning configuration
 * - This plugin uses store=false (stateless), requiring encrypted reasoning content
 *
 * @param body - Original request body
 * @param codexInstructions - Codex system instructions
 * @param userConfig - User configuration from loader
 * @param codexMode - Enable CODEX_MODE (bridge prompt instead of tool remap) - defaults to true
 * @returns Transformed request body
 */
export async function transformRequestBody(
	body: RequestBody,
	codexInstructions: string,
	userConfig: UserConfig = { global: {}, models: {} },
	codexMode = true,
): Promise<RequestBody> {
	const originalModel = body.model;
	const normalizedModel = normalizeModel(body.model);

	// Get model-specific configuration using ORIGINAL model name (config key)
	// This allows per-model options like "gpt-5-codex-low" to work correctly
	const lookupModel = originalModel || normalizedModel;
	const modelConfig = getModelConfig(lookupModel, userConfig);

	// Debug: Log which config was resolved
	logDebug(`Model config lookup: "${lookupModel}" → normalized to "${normalizedModel}" for API`, {
		hasModelSpecificConfig: !!userConfig.models?.[lookupModel],
		resolvedConfig: modelConfig,
	});

	// Normalize model name for API call
	body.model = normalizedModel;

	// Codex required fields
	// ChatGPT backend REQUIRES store=false (confirmed via testing)
	body.store = false;
	body.stream = true;
	body.instructions = codexInstructions;

    // Prompt caching relies on the host providing a stable prompt_cache_key
    // (OpenCode passes its session identifier). We no longer synthesize one here.

	// Filter and transform input
	if (body.input && Array.isArray(body.input)) {
		// Debug: Log original input message IDs before filtering
		const originalIds = body.input.filter(item => item.id).map(item => item.id);
		if (originalIds.length > 0) {
			logDebug(`Filtering ${originalIds.length} message IDs from input:`, originalIds);
		}

		body.input = filterInput(body.input);

		// Debug: Verify all IDs were removed
		const remainingIds = (body.input || []).filter(item => item.id).map(item => item.id);
		if (remainingIds.length > 0) {
			logWarn(`WARNING: ${remainingIds.length} IDs still present after filtering:`, remainingIds);
		} else if (originalIds.length > 0) {
			logDebug(`Successfully removed all ${originalIds.length} message IDs`);
		}

		if (codexMode) {
			// CODEX_MODE: Remove OpenCode system prompt, add bridge prompt
			body.input = await filterOpenCodeSystemPrompts(body.input);
			body.input = addCodexBridgeMessage(body.input, !!body.tools);
		} else {
			// DEFAULT MODE: Keep original behavior with tool remap message
			body.input = addToolRemapMessage(body.input, !!body.tools);
		}
	}

	// Configure reasoning (use model-specific config)
	const reasoningConfig = getReasoningConfig(originalModel, modelConfig);
	body.reasoning = {
		...body.reasoning,
		...reasoningConfig,
	};

	// Configure text verbosity (support user config)
	// Default: "medium" (matches Codex CLI default for all GPT-5 models)
	body.text = {
		...body.text,
		verbosity: modelConfig.textVerbosity || "medium",
	};

	// Add include for encrypted reasoning content
	// Default: ["reasoning.encrypted_content"] (required for stateless operation with store=false)
	// This allows reasoning context to persist across turns without server-side storage
	body.include = modelConfig.include || ["reasoning.encrypted_content"];

	// Remove unsupported parameters
	body.max_output_tokens = undefined;
	body.max_completion_tokens = undefined;

	return body;
}
</file>

<file path="index.ts">
/**
 * OpenAI ChatGPT (Codex) OAuth Authentication Plugin for opencode
 *
 * COMPLIANCE NOTICE:
 * This plugin uses OpenAI's official OAuth authentication flow (the same method
 * used by OpenAI's official Codex CLI at https://github.com/openai/codex).
 *
 * INTENDED USE: Personal development and coding assistance with your own
 * ChatGPT Plus/Pro subscription.
 *
 * NOT INTENDED FOR: Commercial resale, multi-user services, high-volume
 * automated extraction, or any use that violates OpenAI's Terms of Service.
 *
 * Users are responsible for ensuring their usage complies with:
 * - OpenAI Terms of Use: https://openai.com/policies/terms-of-use/
 * - OpenAI Usage Policies: https://openai.com/policies/usage-policies/
 *
 * For production applications, use the OpenAI Platform API: https://platform.openai.com/
 *
 * @license MIT with Usage Disclaimer (see LICENSE file)
 * @author numman-ali
 * @repository https://github.com/numman-ali/opencode-openai-codex-auth
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";
import {
	createAuthorizationFlow,
	decodeJWT,
	exchangeAuthorizationCode,
	REDIRECT_URI,
} from "./lib/auth/auth.js";
import { openBrowserUrl } from "./lib/auth/browser.js";
import { startLocalOAuthServer } from "./lib/auth/server.js";
import { getCodexMode, loadPluginConfig } from "./lib/config.js";
import {
	AUTH_LABELS,
	CODEX_BASE_URL,
	DUMMY_API_KEY,
	ERROR_MESSAGES,
	JWT_CLAIM_PATH,
	LOG_STAGES,
	OPENAI_HEADER_VALUES,
	OPENAI_HEADERS,
	PLUGIN_NAME,
	PROVIDER_ID,
} from "./lib/constants.js";
import { logRequest } from "./lib/logger.js";
import { getCodexInstructions } from "./lib/prompts/codex.js";
import {
	createCodexHeaders,
	extractRequestUrl,
	handleErrorResponse,
	handleSuccessResponse,
	refreshAndUpdateToken,
	rewriteUrlForCodex,
	shouldRefreshToken,
	transformRequestForCodex,
} from "./lib/request/fetch-helpers.js";
import type { UserConfig } from "./lib/types.js";

/**
 * OpenAI Codex OAuth authentication plugin for opencode
 *
 * This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro
 * OAuth authentication, allowing users to leverage their ChatGPT subscription
 * instead of OpenAI Platform API credits.
 *
 * @example
 * ```json
 * {
 *   "plugin": ["opencode-openai-codex-auth"],
 *   "model": "openai/gpt-5-codex"
 * }
 * ```
 */
export const OpenAIAuthPlugin: Plugin = async ({ client }: PluginInput) => {
	return {
		auth: {
			provider: PROVIDER_ID,
			/**
			 * Loader function that configures OAuth authentication and request handling
			 *
			 * This function:
			 * 1. Validates OAuth authentication
			 * 2. Extracts ChatGPT account ID from access token
			 * 3. Loads user configuration from opencode.json
			 * 4. Fetches Codex system instructions from GitHub (cached)
			 * 5. Returns SDK configuration with custom fetch implementation
			 *
			 * @param getAuth - Function to retrieve current auth state
			 * @param provider - Provider configuration from opencode.json
			 * @returns SDK configuration object or empty object for non-OAuth auth
			 */
			async loader(getAuth: () => Promise<Auth>, provider: unknown) {
				const auth = await getAuth();

				// Only handle OAuth auth type, skip API key auth
				if (auth.type !== "oauth") {
					return {};
				}

				// Extract ChatGPT account ID from JWT access token
				const decoded = decodeJWT(auth.access);
				const accountId = decoded?.[JWT_CLAIM_PATH]?.chatgpt_account_id;

                if (!accountId) {
                    console.error(`[${PLUGIN_NAME}] ${ERROR_MESSAGES.NO_ACCOUNT_ID}`);
                    return {};
                }
				// Extract user configuration (global + per-model options)
				const providerConfig = provider as
					| { options?: Record<string, unknown>; models?: UserConfig["models"] }
					| undefined;
				const userConfig: UserConfig = {
					global: providerConfig?.options || {},
					models: providerConfig?.models || {},
				};

				// Load plugin configuration and determine CODEX_MODE
				// Priority: CODEX_MODE env var > config file > default (true)
				const pluginConfig = loadPluginConfig();
				const codexMode = getCodexMode(pluginConfig);

				// Fetch Codex system instructions (cached with ETag for efficiency)
				const CODEX_INSTRUCTIONS = await getCodexInstructions();

				// Return SDK configuration
				return {
					apiKey: DUMMY_API_KEY,
					baseURL: CODEX_BASE_URL,
					/**
					 * Custom fetch implementation for Codex API
					 *
					 * Handles:
					 * - Token refresh when expired
					 * - URL rewriting for Codex backend
					 * - Request body transformation
					 * - OAuth header injection
					 * - SSE to JSON conversion for non-tool requests
					 * - Error handling and logging
					 *
					 * @param input - Request URL or Request object
					 * @param init - Request options
					 * @returns Response from Codex API
					 */
					async fetch(
						input: Request | string | URL,
						init?: RequestInit,
					): Promise<Response> {
						// Step 1: Check and refresh token if needed
						const currentAuth = await getAuth();
						if (shouldRefreshToken(currentAuth)) {
							const refreshResult = await refreshAndUpdateToken(
								currentAuth,
								client,
							);
							if (!refreshResult.success) {
								return refreshResult.response;
							}
						}

						// Step 2: Extract and rewrite URL for Codex backend
						const originalUrl = extractRequestUrl(input);
						const url = rewriteUrlForCodex(originalUrl);

						// Step 3: Transform request body with Codex instructions
						const transformation = await transformRequestForCodex(
							init,
							url,
							CODEX_INSTRUCTIONS,
							userConfig,
							codexMode,
						);
						const hasTools = transformation?.body.tools !== undefined;
						const requestInit = transformation?.updatedInit ?? init;

						// Step 4: Create headers with OAuth and ChatGPT account info
						const accessToken =
							currentAuth.type === "oauth" ? currentAuth.access : "";
						const headers = createCodexHeaders(
							requestInit,
							accountId,
							accessToken,
							{
								model: transformation?.body.model,
								promptCacheKey: (transformation?.body as any)?.prompt_cache_key,
							},
						);

						// Step 5: Make request to Codex API
						const response = await fetch(url, {
							...requestInit,
							headers,
						});

						// Step 6: Log response
						logRequest(LOG_STAGES.RESPONSE, {
							status: response.status,
							ok: response.ok,
							statusText: response.statusText,
							headers: Object.fromEntries(response.headers.entries()),
						});

						// Step 7: Handle error or success response
						if (!response.ok) {
							return await handleErrorResponse(response);
						}

						return await handleSuccessResponse(response, hasTools);
					},
				};
			},
			methods: [
				{
					label: AUTH_LABELS.OAUTH,
					type: "oauth" as const,
					/**
					 * OAuth authorization flow
					 *
					 * Steps:
					 * 1. Generate PKCE challenge and state for security
					 * 2. Start local OAuth callback server on port 1455
					 * 3. Open browser to OpenAI authorization page
					 * 4. Wait for user to complete login
					 * 5. Exchange authorization code for tokens
					 *
					 * @returns Authorization flow configuration
					 */
					authorize: async () => {
						const { pkce, state, url } = await createAuthorizationFlow();
						const serverInfo = await startLocalOAuthServer({ state });

						// Attempt to open browser automatically
						openBrowserUrl(url);

						return {
							url,
							method: "auto" as const,
							instructions: AUTH_LABELS.INSTRUCTIONS,
							callback: async () => {
								const result = await serverInfo.waitForCode(state);
								serverInfo.close();

								if (!result) {
									return { type: "failed" as const };
								}

								const tokens = await exchangeAuthorizationCode(
									result.code,
									pkce.verifier,
									REDIRECT_URI,
								);

								return tokens?.type === "success"
									? tokens
									: { type: "failed" as const };
							},
						};
					},
				},
				{
					label: AUTH_LABELS.API_KEY,
					type: "api" as const,
				},
			],
		},
	};
};

export default OpenAIAuthPlugin;
</file>

<file path="package.json">
{
  "name": "opencode-openai-codex-auth",
  "version": "3.0.0",
  "description": "OpenAI ChatGPT (Codex backend) OAuth auth plugin for opencode - use your ChatGPT Plus/Pro subscription instead of API credits",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "type": "module",
  "license": "MIT",
  "author": "Numman Ali",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/numman-ali/opencode-openai-codex-auth.git"
  },
  "keywords": [
    "opencode",
    "openai",
    "codex",
    "chatgpt",
    "oauth",
    "gpt-5",
    "plugin",
    "auth",
    "chatgpt-plus",
    "chatgpt-pro"
  ],
  "homepage": "https://github.com/numman-ali/opencode-openai-codex-auth#readme",
  "bugs": {
    "url": "https://github.com/numman-ali/opencode-openai-codex-auth/issues"
  },
  "scripts": {
    "build": "tsc && cp lib/oauth-success.html dist/lib/",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=20.0.0"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "^0.13.7"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^0.13.7",
    "@opencode-ai/sdk": "^0.13.9",
    "@types/node": "^24.6.2",
    "@vitest/ui": "^3.2.4",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  },
  "dependencies": {
    "@openauthjs/openauth": "^0.4.3",
    "hono": "^4.10.4"
  },
  "overrides": {
    "hono": "^4.10.4",
    "vite": "^7.1.12"
  }
}
</file>

<file path="README.md">
# OpenAI ChatGPT OAuth Plugin for opencode

[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
[![Tests](https://github.com/numman-ali/opencode-openai-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/numman-ali/opencode-openai-codex-auth/actions)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)

This plugin enables opencode to use OpenAI's Codex backend via ChatGPT Plus/Pro OAuth authentication, allowing you to use your ChatGPT subscription instead of OpenAI Platform API credits.

> **Found this useful?**
Follow me on [X @nummanthinks](https://x.com/nummanthinks) for future updates and more projects!

## ⚠️ Terms of Service & Usage Notice

**Important:** This plugin is designed for **personal development use only** with your own ChatGPT Plus/Pro subscription. By using this tool, you agree to:

- ✅ Use only for individual productivity and coding assistance
- ✅ Respect OpenAI's rate limits and usage policies
- ✅ Not use to power commercial services or resell access
- ✅ Comply with [OpenAI's Terms of Use](https://openai.com/policies/terms-of-use/) and [Usage Policies](https://openai.com/policies/usage-policies/)

**This tool uses OpenAI's official OAuth authentication** (the same method as OpenAI's official Codex CLI). However, users are responsible for ensuring their usage complies with OpenAI's terms.

### ⚠️ Not Suitable For:
- Commercial API resale or white-labeling
- High-volume automated extraction beyond personal use
- Applications serving multiple users with one subscription
- Any use that violates OpenAI's acceptable use policies

**For production applications or commercial use, use the [OpenAI Platform API](https://platform.openai.com/) with proper API keys.**

---

## Features

- ✅ **ChatGPT Plus/Pro OAuth authentication** - Use your existing subscription
- ✅ **9 pre-configured model variants** - Low/Medium/High reasoning for both gpt-5 and gpt-5-codex
- ✅ **Zero external dependencies** - Lightweight with only @openauthjs/openauth
- ✅ **Auto-refreshing tokens** - Handles token expiration automatically
- ✅ **Prompt caching** - Reuses responses across turns via stable `prompt_cache_key`
- ✅ **Smart auto-updating Codex instructions** - Tracks latest stable release with ETag caching
- ✅ **Full tool support** - write, edit, bash, grep, glob, and more
- ✅ **CODEX_MODE** - Codex-OpenCode bridge prompt with Task tool & MCP awareness (enabled by default)
- ✅ **Automatic tool remapping** - Codex tools → opencode tools
- ✅ **Configurable reasoning** - Control effort, summary verbosity, and text output
- ✅ **Usage-aware errors** - Shows clear guidance when ChatGPT subscription limits are reached
- ✅ **Type-safe & tested** - Strict TypeScript with 159 unit tests + 14 integration tests
- ✅ **Modular architecture** - Easy to maintain and extend

## Installation

### Quick Start

**No npm install needed!** opencode automatically installs plugins when you add them to your config.

#### Recommended: Full Configuration (Codex CLI Experience)

For the complete experience with all reasoning variants matching the official Codex CLI:

1. **Copy the full configuration** from [`config/full-opencode.json`](./config/full-opencode.json) to your opencode config file:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-openai-codex-auth"
  ],
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "medium",
        "reasoningSummary": "auto",
        "textVerbosity": "medium",
        "include": [
          "reasoning.encrypted_content"
        ],
        "store": false
      },
      "models": {
        "gpt-5-codex-low": {
          "name": "GPT 5 Codex Low (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-codex-medium": {
          "name": "GPT 5 Codex Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-codex-high": {
          "name": "GPT 5 Codex High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "medium",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-minimal": {
          "name": "GPT 5 Minimal (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "minimal",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-low": {
          "name": "GPT 5 Low (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-medium": {
          "name": "GPT 5 Medium (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "medium",
            "reasoningSummary": "auto",
            "textVerbosity": "medium",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-high": {
          "name": "GPT 5 High (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "high",
            "reasoningSummary": "detailed",
            "textVerbosity": "high",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-mini": {
          "name": "GPT 5 Mini (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "low",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        },
        "gpt-5-nano": {
          "name": "GPT 5 Nano (OAuth)",
          "limit": {
            "context": 272000,
            "output": 128000
          },
          "options": {
            "reasoningEffort": "minimal",
            "reasoningSummary": "auto",
            "textVerbosity": "low",
            "include": [
              "reasoning.encrypted_content"
            ],
            "store": false
          }
        }
      }
    }
  }
}
```

   **Global config**: `~/.config/opencode/opencode.json`
   **Project config**: `<project>/.opencode.json`

   This gives you 9 model variants with different reasoning levels:
   - **gpt-5-codex** (low/medium/high) - Code-optimized reasoning
   - **gpt-5** (minimal/low/medium/high) - General-purpose reasoning
   - **gpt-5-mini** and **gpt-5-nano** - Lightweight variants

   All appear in the opencode model selector as "GPT 5 Codex Low (OAuth)", "GPT 5 High (OAuth)", etc.

### Prompt caching & usage limits

Codex backend caching is enabled automatically. When OpenCode supplies a `prompt_cache_key` (its session identifier), the plugin forwards it unchanged so Codex can reuse work between turns. The plugin no longer synthesizes its own cache IDs—if the host omits `prompt_cache_key`, Codex will treat the turn as uncached. The bundled CODEX_MODE bridge prompt is synchronized with the latest Codex CLI release, so opencode and Codex stay in lock-step on tool availability. When your ChatGPT subscription nears a limit, opencode surfaces the plugin's friendly error message with the 5-hour and weekly windows, mirroring the Codex CLI summary.

> **Auto-compaction note:** OpenCode's context auto-compaction and usage sidebar only populate when the full configuration above is used (the minimal config lacks the per-model metadata OpenCode needs). Stick with `config/full-opencode.json` if you want live token counts and automatic history compaction inside the UI.

#### Alternative: Minimal Configuration

For a simpler setup (uses plugin defaults: medium reasoning, auto summaries):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-openai-codex-auth"
  ],
  "model": "openai/gpt-5-codex"
}
```

**Note**: This gives you basic functionality but you won't see the different reasoning variants in the model selector.

2. **That's it!** opencode will auto-install the plugin on first run.

> **New to opencode?** Learn more at [opencode.ai](https://opencode.ai)

## Authentication

```bash
opencode auth login
```

Select "OpenAI" → "ChatGPT Plus/Pro (Codex Subscription)"

> **⚠️ First-time setup**: Stop Codex CLI if running (both use port 1455)

---

## Updating the Plugin

**⚠️ Important**: OpenCode does NOT auto-update plugins.

To install the latest version:

```bash
# Clear plugin cache
(cd ~ && sed -i.bak '/"opencode-openai-codex-auth"/d' .cache/opencode/package.json && rm -rf .cache/opencode/node_modules/opencode-openai-codex-auth)

# Restart OpenCode - it will reinstall latest version
opencode
```

Check [releases](https://github.com/numman-ali/opencode-openai-codex-auth/releases) for version history.

## Usage

If using the full configuration, select from the model picker in opencode, or specify via command line:

```bash
# Use different reasoning levels for gpt-5-codex
opencode run "simple task" --model=openai/gpt-5-codex-low
opencode run "complex task" --model=openai/gpt-5-codex-high

# Use different reasoning levels for gpt-5
opencode run "quick question" --model=openai/gpt-5-minimal
opencode run "deep analysis" --model=openai/gpt-5-high

# Or with minimal config (uses defaults)
opencode run "create a hello world file" --model=openai/gpt-5-codex
opencode run "solve this complex problem" --model=openai/gpt-5
```

### Available Model Variants (Full Config)

When using [`config/full-opencode.json`](./config/full-opencode.json), you get these pre-configured variants:

| CLI Model ID | TUI Display Name | Reasoning Effort | Best For |
|--------------|------------------|-----------------|----------|
| `gpt-5-codex-low` | GPT 5 Codex Low (OAuth) | Low | Fast code generation |
| `gpt-5-codex-medium` | GPT 5 Codex Medium (OAuth) | Medium | Balanced code tasks |
| `gpt-5-codex-high` | GPT 5 Codex High (OAuth) | High | Complex code & tools |
| `gpt-5-minimal` | GPT 5 Minimal (OAuth) | Minimal | Quick answers, simple tasks |
| `gpt-5-low` | GPT 5 Low (OAuth) | Low | Faster responses with light reasoning |
| `gpt-5-medium` | GPT 5 Medium (OAuth) | Medium | Balanced general-purpose tasks |
| `gpt-5-high` | GPT 5 High (OAuth) | High | Deep reasoning, complex problems |
| `gpt-5-mini` | GPT 5 Mini (OAuth) | Low | Lightweight tasks |
| `gpt-5-nano` | GPT 5 Nano (OAuth) | Minimal | Maximum speed |

**Usage**: `--model=openai/<CLI Model ID>` (e.g., `--model=openai/gpt-5-codex-low`)
**Display**: TUI shows the friendly name (e.g., "GPT 5 Codex Low (OAuth)")

All accessed via your ChatGPT Plus/Pro subscription.

### Using in Custom Commands

**Important**: Always include the `openai/` prefix:

```yaml
# ✅ Correct
model: openai/gpt-5-codex-low

# ❌ Wrong - will fail
model: gpt-5-codex-low
```

See [Configuration Guide](https://numman-ali.github.io/opencode-openai-codex-auth/configuration) for advanced usage.

### Plugin Defaults

When no configuration is specified, the plugin uses these defaults for all GPT-5 models:

```json
{
  "reasoningEffort": "medium",
  "reasoningSummary": "auto",
  "textVerbosity": "medium"
}
```

- **`reasoningEffort: "medium"`** - Balanced computational effort for reasoning
- **`reasoningSummary: "auto"`** - Automatically adapts summary verbosity
- **`textVerbosity: "medium"`** - Balanced output length

These defaults match the official Codex CLI behavior and can be customized (see Configuration below).

## Configuration

### Recommended: Use Pre-Configured File

The easiest way to get started is to use [`config/full-opencode.json`](./config/full-opencode.json), which provides:
- 9 pre-configured model variants matching Codex CLI presets
- Optimal settings for each reasoning level
- All variants visible in the opencode model selector

See [Installation](#installation) for setup instructions.

### Custom Configuration

If you want to customize settings yourself, you can configure options at provider or model level.

#### Available Settings

⚠️ **Important**: The two base models have different supported values.

| Setting | GPT-5 Values | GPT-5-Codex Values | Plugin Default |
|---------|-------------|-------------------|----------------|
| `reasoningEffort` | `minimal`, `low`, `medium`, `high` | `low`, `medium`, `high` | `medium` |
| `reasoningSummary` | `auto`, `detailed` | `auto`, `detailed` | `auto` |
| `textVerbosity` | `low`, `medium`, `high` | `medium` only | `medium` |
| `include` | Array of strings | Array of strings | `["reasoning.encrypted_content"]` |

> **Note**: `minimal` effort is auto-normalized to `low` for gpt-5-codex (not supported by the API).

#### Global Configuration Example

Apply settings to all models:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "model": "openai/gpt-5-codex",
  "provider": {
    "openai": {
      "options": {
        "reasoningEffort": "high",
        "reasoningSummary": "detailed"
      }
    }
  }
}
```

#### Custom Model Variants Example

Create your own named variants in the model selector:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-codex-auth"],
  "provider": {
    "openai": {
      "models": {
        "codex-fast": {
          "name": "My Fast Codex",
          "options": {
            "reasoningEffort": "low"
          }
        },
        "gpt-5-smart": {
          "name": "My Smart GPT-5",
          "options": {
            "reasoningEffort": "high",
            "textVerbosity": "high"
          }
        }
      }
    }
  }
}
```

**Config key** (e.g., `codex-fast`) is used in CLI: `--model=openai/codex-fast`
**`name` field** (e.g., `"My Fast Codex"`) appears in model selector
**Model type** is auto-detected from the key (contains "codex" → gpt-5-codex, else → gpt-5)

### Advanced Configuration

For advanced options, custom presets, and troubleshooting:

**📖 [Configuration Guide](https://numman-ali.github.io/opencode-openai-codex-auth/configuration)** - Complete reference with examples

## Rate Limits & Responsible Use

This plugin respects the same rate limits enforced by OpenAI's official Codex CLI:

- **Rate limits are determined by your ChatGPT subscription tier** (Plus/Pro)
- **Limits are enforced server-side** through OAuth tokens
- **The plugin does NOT and CANNOT bypass** OpenAI's rate limits

### Best Practices:
- ✅ Use for individual coding tasks, not bulk processing
- ✅ Avoid rapid-fire automated requests
- ✅ Monitor your usage to stay within subscription limits
- ✅ Consider the OpenAI Platform API for higher-volume needs
- ❌ Do not use for commercial services without proper API access
- ❌ Do not share authentication tokens or credentials

**Note:** Excessive usage or violations of OpenAI's terms may result in temporary throttling or account review by OpenAI.

---

## Requirements

- **ChatGPT Plus or Pro subscription** (required)
- **OpenCode** installed ([opencode.ai](https://opencode.ai))

## Troubleshooting

**Common Issues:**

- **401 Unauthorized**: Run `opencode auth login` again
- **Model not found**: Add `openai/` prefix (e.g., `--model=openai/gpt-5-codex-low`)
- **"Item not found" errors**: Update to latest plugin version

**Full troubleshooting guide**: [docs/troubleshooting.md](https://numman-ali.github.io/opencode-openai-codex-auth/troubleshooting)

## Debug Mode

Enable detailed logging:

```bash
DEBUG_CODEX_PLUGIN=1 opencode run "your prompt"
```

For full request/response logs:

```bash
ENABLE_PLUGIN_REQUEST_LOGGING=1 opencode run "your prompt"
```

Logs saved to: `~/.opencode/logs/codex-plugin/`

See [Troubleshooting Guide](https://numman-ali.github.io/opencode-openai-codex-auth/troubleshooting) for details.

## Frequently Asked Questions

### Is this against OpenAI's Terms of Service?

This plugin uses **OpenAI's official OAuth authentication** (the same method as their official Codex CLI). It's designed for personal coding assistance with your own ChatGPT subscription.

However, **users are responsible for ensuring their usage complies with OpenAI's Terms of Use**. This means:
- Personal use for your own development
- Respecting rate limits
- Not reselling access or powering commercial services
- Following OpenAI's acceptable use policies

### Can I use this for my commercial application?

**No.** This plugin is intended for **personal development only**.

For commercial applications, production systems, or services serving multiple users, you must obtain proper API access through the [OpenAI Platform API](https://platform.openai.com/).

### Will my account get banned?

Using OAuth authentication for personal coding assistance aligns with OpenAI's official Codex CLI use case. However, violating OpenAI's terms could result in account action:

**Safe use:**
- Personal coding assistance
- Individual productivity
- Legitimate development work
- Respecting rate limits

**Risky use:**
- Commercial resale of access
- Powering multi-user services
- High-volume automated extraction
- Violating OpenAI's usage policies

### What's the difference between this and scraping session tokens?

**Critical distinction:**
- ✅ **This plugin:** Uses official OAuth authentication through OpenAI's authorization server
- ❌ **Session scraping:** Extracts cookies/tokens from browsers (clearly violates TOS)

OAuth is a **proper, supported authentication method**. Session token scraping and reverse-engineering private APIs are explicitly prohibited by OpenAI's terms.

### Can I use this to avoid paying for the OpenAI API?

**This is not a "free API alternative."**

This plugin allows you to use your **existing ChatGPT subscription** for terminal-based coding assistance (the same use case as OpenAI's official Codex CLI).

If you need API access for applications, automation, or commercial use, you should purchase proper API access from OpenAI Platform.

### Is this affiliated with OpenAI?

**No.** This is an independent open-source project. It uses OpenAI's publicly available OAuth authentication system but is not endorsed, sponsored, or affiliated with OpenAI.

ChatGPT, GPT-5, and Codex are trademarks of OpenAI.

---

## Credits & Attribution

This plugin implements OAuth authentication for OpenAI's Codex backend, using the same authentication flow as:
- [OpenAI's official Codex CLI](https://github.com/openai/codex)
- OpenAI's OAuth authorization server (https://chatgpt.com/oauth)

### Acknowledgments

Based on research and working implementations from:
- [ben-vargas/ai-sdk-provider-chatgpt-oauth](https://github.com/ben-vargas/ai-sdk-provider-chatgpt-oauth)
- [ben-vargas/ai-opencode-chatgpt-auth](https://github.com/ben-vargas/ai-opencode-chatgpt-auth)
- [openai/codex](https://github.com/openai/codex) OAuth flow
- [sst/opencode](https://github.com/sst/opencode)

### Trademark Notice

**Not affiliated with OpenAI.** ChatGPT, GPT-5, GPT-4, GPT-3, Codex, and OpenAI are trademarks of OpenAI, L.L.C. This is an independent open-source project and is not endorsed by, sponsored by, or affiliated with OpenAI.

---

## Documentation

**📖 Documentation:**
- [Installation](#installation) - Get started in 2 minutes
- [Configuration](#configuration) - Customize your setup
- [Troubleshooting](#troubleshooting) - Common issues
- [GitHub Pages Docs](https://numman-ali.github.io/opencode-openai-codex-auth/) - Extended guides
- [Developer Docs](https://numman-ali.github.io/opencode-openai-codex-auth/development/ARCHITECTURE) - Technical deep dive

## License

MIT
</file>

</files>
