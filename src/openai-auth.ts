import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "crypto";
import type { Config } from "./config";
import { saveConfig } from "./config";
import { logger } from "./logger";
import { getCodexInstructions } from "./codex-instructions";
import { getToolCallByCallId } from "./call-cache";

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
 * Convert Codex Responses API SSE stream to Chat Completions JSON stream
 * This allows AI SDK to properly parse tool calls and text
 */
async function codexSseToChatCompletionsStream(
  codexResponse: Response,
): Promise<Response> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const reader = codexResponse.body!.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      const toolCallsMap = new Map<string, { id: string; name: string; args: string }>();

      const sendChunk = (obj: unknown) => {
        const line = `data: ${JSON.stringify(obj)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE blocks (separated by \n\n)
          while (true) {
            const blockEnd = buffer.indexOf("\n\n");
            if (blockEnd === -1) break;

            const block = buffer.slice(0, blockEnd);
            buffer = buffer.slice(blockEnd + 2);

            // Parse event and data from SSE block
            const lines = block.split("\n");
            let eventType = "";
            let data = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                data = line.slice(6);
              }
            }

            if (!data) continue;

            try {
              const payload = JSON.parse(data);
              console.log(`SSE Event: ${eventType}`);

              // Handle text deltas
              if (eventType === "response.output_text.delta") {
                const text = payload.text || "";
                if (text) {
                  sendChunk({
                    id: "codex",
                    object: "chat.completion.chunk",
                    created: Date.now(),
                    model: "gpt-5-codex",
                    choices: [{
                      index: 0,
                      delta: { content: text },
                      finish_reason: null,
                    }],
                  });
                }
              }

              // Handle function call start
              else if (eventType === "response.function_call.delta") {
                const { id, name, call_id } = payload;
                const toolCallId = call_id || id;
                console.log("=== TOOL CALL START ===");
                console.log("Event payload:", JSON.stringify(payload, null, 2));
                console.log("Extracted ID:", toolCallId);
                if (toolCallId && name) {
                  toolCallsMap.set(toolCallId, { id: toolCallId, name, args: "" });
                  sendChunk({
                    id: "codex",
                    object: "chat.completion.chunk",
                    created: Date.now(),
                    model: "gpt-5-codex",
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: 0,
                          id: toolCallId,
                          type: "function",
                          function: { name, arguments: "" },
                        }],
                      },
                      finish_reason: null,
                    }],
                  });
                }
              }

              // Handle function call arguments delta
              else if (eventType === "response.function_call.arguments.delta") {
                const { call_id, arguments: argsDelta } = payload;
                if (call_id && argsDelta) {
                  const toolCall = toolCallsMap.get(call_id);
                  if (toolCall) {
                    toolCall.args += argsDelta;
                    sendChunk({
                      id: "codex",
                      object: "chat.completion.chunk",
                      created: Date.now(),
                      model: "gpt-5-codex",
                      choices: [{
                        index: 0,
                        delta: {
                          tool_calls: [{
                            index: 0,
                            id: call_id,
                            type: "function",
                            function: { arguments: argsDelta },
                          }],
                        },
                        finish_reason: null,
                      }],
                    });
                  }
                }
              }

              // Handle completion
              else if (
                eventType === "response.done" ||
                eventType === "response.completed"
              ) {
                sendChunk({
                  id: "codex",
                  object: "chat.completion.chunk",
                  created: Date.now(),
                  model: "gpt-5-codex",
                  choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: "stop",
                  }],
                });
              }

              // Log other event types for debugging
              else if (eventType && !eventType.includes("in_progress") && !eventType.includes("created")) {
                logger.debug("Unhandled Codex SSE event:", eventType, payload);
              }
            } catch (parseError) {
              logger.error("Failed to parse SSE data:", data, parseError);
            }
          }
        }
      } catch (error) {
        logger.error("SSE stream error:", error);
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
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

        // Log full request for debugging tool calling
        console.error("\n=== FULL REQUEST BODY ===");
        console.error(JSON.stringify(parsed, null, 2));

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

        // Fix tool schemas - AI SDK doesn't include type: "object" in parameters
        // Codex requires this field for valid JSON Schema
        if (Array.isArray(parsed.tools)) {
          parsed.tools = parsed.tools.map((tool: any) => {
            if (tool.parameters && !tool.parameters.type) {
              tool.parameters.type = "object";
            }
            return tool;
          });
        }

        // Transform input for stateless Codex API (store: false)
        // This is the critical fix for tool calling:
        // 1. Filter out item_reference (AI SDK creates these but they don't work with store:false)
        // 2. Inject real function_call objects before function_call_output items
        // 3. Ensure arguments and output are JSON strings
        if (Array.isArray(parsed.input)) {
          // Log BEFORE transformation
          console.error("\n=== INPUT ARRAY BEFORE TRANSFORMATION ===");
          console.error("Total items:", parsed.input.length);
          parsed.input.forEach((item: any, index: number) => {
            console.error(`Item ${index}:`, JSON.stringify({
              type: item.type,
              role: item.role,
              id: item.id,
              hasCallId: !!item.call_id,
              keys: Object.keys(item)
            }, null, 2));
          });

          // Helper to strip ID from an item
          const stripId = (item: any) => {
            if ('id' in item) {
              const { id, ...rest } = item;
              return rest;
            }
            return item;
          };

          // Step 1: Filter out item_reference and strip all IDs
          const filtered = parsed.input
            .filter((item: any) => item?.type !== 'item_reference')
            .map(stripId);

          // Step 2: Check which function_call objects already exist
          const existingFunctionCalls = new Set(
            filtered
              .filter((item: any) => item?.type === 'function_call' && typeof item.call_id === 'string')
              .map((item: any) => item.call_id)
          );

          // Step 3: Inject missing function_call objects before function_call_output
          const finalInput: any[] = [];
          for (const item of filtered) {
            // If this is a function_call_output, inject the corresponding function_call first (if missing)
            if (item?.type === 'function_call_output') {
              const callId = item.call_id;
              if (callId && !existingFunctionCalls.has(callId)) {
                // Look up the cached tool call
                const cached = getToolCallByCallId(callId);
                if (cached) {
                  console.error(`\n=== INJECTING FUNCTION_CALL for ${callId} ===`);
                  console.error("Cached call:", JSON.stringify(cached, null, 2));

                  finalInput.push({
                    type: 'function_call',
                    name: cached.name,
                    call_id: cached.call_id,
                    arguments: typeof cached.arguments === 'string'
                      ? cached.arguments
                      : JSON.stringify(cached.arguments),
                  });
                  existingFunctionCalls.add(callId);
                } else {
                  console.error(`\n⚠️ WARNING: No cached function_call found for call_id ${callId}`);
                }
              }

              // Normalize output to JSON string
              if (typeof item.output !== 'string') {
                item.output = JSON.stringify(item.output ?? {});
              }
            }

            finalInput.push(item);
          }

          parsed.input = finalInput;

          console.error("\n=== INPUT ARRAY AFTER TRANSFORMATION ===");
          console.error(`Transformed ${parsed.input.length} items`);
          parsed.input.forEach((item: any, index: number) => {
            console.error(`Item ${index}:`, JSON.stringify({
              type: item.type,
              role: item.role,
              name: item.name,
              hasOutput: !!item.output,
              hasCallId: !!item.call_id,
              hasArguments: !!item.arguments,
            }, null, 2));
          });
        }

        // Add reasoning.encrypted_content for context continuity without server storage
        // This is critical for maintaining conversation context with store: false
        if (!parsed.include) {
          parsed.include = ["reasoning.encrypted_content"];
        }


        logger.debug("OpenAI fetch - transformed body:", parsed);
        body = JSON.stringify(parsed);
      } catch (error) {
        logger.error("Failed to transform OpenAI request:", error as Error);
      }
    }

    logger.debug("OpenAI Codex request", { url, hasBody: !!body });

    // Make the request
    const response = await fetch(url, {
      ...init,
      headers,
      body,
    });

    // Don't convert - @ai-sdk/openai expects Responses API format
    return response;
  };
}
