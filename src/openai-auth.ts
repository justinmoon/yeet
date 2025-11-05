import { generatePKCE } from "@openauthjs/openauth/pkce";
import { randomBytes } from "crypto";
import type { Config } from "./config";
import { saveConfig } from "./config";
import { logger } from "./logger";

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

    // Rewrite URL to Codex backend
    url = url.replace("/responses", "/codex/responses");

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
