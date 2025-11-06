--- Response ---

Below is the shortest, *working* path to get Codex tool‑calling + streaming working in **yeet**, plus a fallback shim if you really want to keep `openai-compatible`.

---

## TL;DR (what’s actually wrong)

* **opencode** uses an SDK that already targets **OpenAI *Responses* API** semantics:

  * Sends **Responses‑style tool schema**: `tools[].{ type:"function", name, description, parameters }`
  * Streams **Responses Data Stream SSE**: `event: response.output_text.delta`, `…function_call…`, etc.
  * Has an SSE parser that understands those events.

* **yeet** uses **Vercel AI SDK’s `openai-compatible` provider**, which expects **Chat Completions**:

  * Sends **Chat Completions tool schema**: `tools[].{ type:"function", function:{ name,… } }`
  * Expects **Chat Completions stream**: `{"choices":[{"delta":{"content":"…"}}]}` chunks.

So your current setup **mismatches both request and stream formats**:

* Codex complains: `Missing required parameter: 'tools[0].name'` → it wants `name` at the top level.
* AI SDK can’t parse Codex SSE → it expects Chat Completions JSON deltas.

No mystery middleware in the plugin—the “magic” is: **opencode’s SDK speaks Responses API** so the plugin can just pass SSE through.

---

## Fix (recommended): switch yeet to the AI SDK **OpenAI Responses** provider

This keeps your agent logic and `streamText()` intact, *and* makes the plugin’s “return raw SSE for tools” path correct—because the provider will parse `response.*` events.

### 1) Swap providers

```diff
- import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
+ import { createOpenAI } from "@ai-sdk/openai";
```

```diff
// src/agent.ts
- const provider = createOpenAICompatible({
+ const provider = createOpenAI({
    name: "openai",
    apiKey: "chatgpt-oauth",
    baseURL: "https://chatgpt.com/backend-api",
    fetch: customFetch as any,
});
```

```diff
// test-openai-with-tools.ts & test-openai.ts
- import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
+ import { createOpenAI } from "@ai-sdk/openai";

- const provider = createOpenAICompatible({
+ const provider = createOpenAI({
    name: "openai",
    apiKey: "chatgpt-oauth",
    baseURL: "https://chatgpt.com/backend-api",
    fetch: customFetch as any,
});
```

```diff
// package.json
{
  "dependencies": {
-   "@ai-sdk/openai-compatible": "^1.0.0",
+   "@ai-sdk/openai": "^2.0.40",
    "ai": "^5.0.8",
    ...
  }
}
```

### 2) Keep your fetch wrapper, but **stop stripping tools**

Your `src/openai-auth.ts` currently deletes tools:

```diff
- delete parsed.tools; // Codex tools format is different from OpenAI
```

Remove that line. The `@ai-sdk/openai` provider already constructs **Responses** tool schema that Codex expects (`tools[0].name` etc.). Let it pass through.

### 3) Leave SSE streaming alone

* For **tool calls**, let the Codex stream flow through as text/event‑stream.
  The `@ai-sdk/openai` provider will parse `response.*` events and emit `text-delta` / `tool-call` / `tool-result` chunks—exactly what your agent loop consumes.

* For **non‑tool** cases, you can keep your “SSE → JSON” converter if you want parity with your existing `generateText` test, but it’s not required for tool‑calling.

### 4) Keep the minimal request tweaks you already do

It’s fine to keep:

* URL rewrite `…/responses` → `…/codex/responses`
* `store=false`, `stream=true`
* Inject `instructions` (only if absent) using your GitHub fetcher
* Remove unsupported knobs (temperature/top_p/…); the provider won’t send most of them anyway

Your current “messages → input” conversion **won’t trigger** with the `@ai-sdk/openai` provider (it already sends `input`), so you can leave that block in place safely, or delete it for cleanliness.

---

## What this answers (your three questions)

1. **Does the plugin actually work with tools?**
   **Yes**—in **opencode**. The plugin forwards the **Responses Data Stream** unchanged and preserves the **Responses tool schema**. opencode’s SDK parses those events and tools. There’s no false advertising; the mismatch is on yeet’s side (Chat Completions vs Responses).

2. **How does opencode use the plugin differently than yeet?**

   * Uses **`@opencode-ai/sdk`**, whose `streamText()`:

     * emits tool calls from **Responses** stream events,
     * already knows Codex’s SSE (`response.output_text.delta`, tool-call deltas, etc.).
   * Sends **Responses‑style tools** (`tools[].name`, not nested `function`).
   * Because of that, the plugin can `return new Response(response.body, …)` and everything works.

3. **Proper way to integrate Codex with AI SDK?**

   * **Simplest & robust**: switch to `@ai-sdk/openai` (Responses provider) as shown above. No custom SSE parsing, no home‑rolled tool transforms.
   * If you must keep `openai-compatible`, see the shim below.

---

## Fallback (if you insist on `openai-compatible`)

You need **both** a request shim (tools) and a stream shim (SSE → Chat Completions deltas).

### A) Request shim: convert tools to Responses schema

Drop this into your `createOpenAIFetch` body transform—**instead of** deleting `parsed.tools`:

```ts
function toCodexTools(openaiCompatibleTools: any[] | undefined) {
  if (!Array.isArray(openaiCompatibleTools)) return undefined;
  // Chat Completions → Responses
  return openaiCompatibleTools.map((t) => {
    if (t?.type === "function" && t.function) {
      const fn = t.function;
      return {
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    }
    return t; // pass-through for safety
  });
}

// …
if (Array.isArray(parsed.tools)) {
  parsed.tools = toCodexTools(parsed.tools);
}
```

### B) Stream shim: convert Codex SSE → Chat Completions JSON lines

Wrap the Codex `Response` and re‑emit **fake** Chat Completions deltas that Vercel’s parser accepts:

```ts
async function codexSseToChatCompletionsStream(codex: Response): Promise<Response> {
  const dec = new TextDecoder();
  const enc = new TextEncoder();

  const reader = codex.body!.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buf = "";

      const send = (obj: unknown) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // process complete event blocks
        for (;;) {
          const idx = buf.indexOf("\n\n");
          if (idx === -1) break;
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          const lines = block.split("\n");
          let event = "";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) event = line.slice(7).trim();
            if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (!data) continue;

          try {
            const payload = JSON.parse(data);

            // map the common cases
            if (event === "response.output_text.delta" && typeof payload.text === "string") {
              // Chat Completions style delta
              send({ id: "codex", object: "chat.completion.chunk",
                     choices: [{ delta: { content: payload.text } }] });
            }

            // tool calls: map Responses function_call deltas → chat tool_calls deltas
            if (event.endsWith(".function_call.arguments.delta")) {
              const { id, name, arguments: argsDelta } = payload;
              send({
                id: "codex",
                object: "chat.completion.chunk",
                choices: [{
                  delta: {
                    tool_calls: [{
                      index: 0, // naive: single active call
                      id,
                      type: "function",
                      function: {
                        name,
                        arguments: argsDelta, // streamed arguments
                      },
                    }],
                  },
                }],
              });
            }

            if (event === "response.done" || event === "response.completed") {
              // end-of-stream signal
              send({ id: "codex", object: "chat.completion.chunk", choices: [{ finish_reason: "stop", delta: {} }] });
            }
          } catch {
            // ignore malformed
          }
        }
      }

      controller.close();
    },
  });

  // Chat Completions streaming mime:
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
```

Then in your fetch wrapper:

```ts
const response = await fetch(url, { ...init, headers });
if (!hasTools) return await convertSseToJson(response, headers);
return await codexSseToChatCompletionsStream(response);
```

> Caveats: this shim is intentionally minimal. If Codex concurrently streams multiple tool calls or uses different event names, you’ll need to enrich the mapper (track `index`/IDs, emit `tool_calls[].index` correctly, etc.). The **Responses provider** avoids all of this.

---

## Sanity checklist

* [ ] Using `@ai-sdk/openai` provider (not `openai-compatible`)
* [ ] No longer deleting `parsed.tools`
* [ ] `createOpenAIFetch` still:

  * sets `accept: text/event-stream`
  * rewrites `/responses` → `/codex/responses`
  * injects `instructions` when absent
  * strips unsupported knobs
* [ ] Tool test (`test-openai-with-tools.ts`) now streams and emits `tool-call` chunks

---

## Why this works

* Codex is the **Responses API** behind ChatGPT.
* opencode’s plugin and SDK **speak Responses natively**.
* Switching yeet to the **Responses provider** aligns both the **tools schema** and the **stream format**, eliminating all the mismatches without bespoke glue.


