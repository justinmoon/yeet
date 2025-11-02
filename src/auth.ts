import { randomUUID } from "crypto";
import { generatePKCE } from "@openauthjs/openauth/pkce";
import type { Config } from "./config";
import { saveConfig } from "./config";

// Anthropic OAuth configuration
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const OAUTH_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const API_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export const CLAUDE_CODE_API_BETA =
  "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14";
export const CLAUDE_CODE_BETA = `claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`;

const CLAUDE_CODE_USER_AGENT = "claude-cli/2.0.22 (external, sdk-cli)";
const CLAUDE_CODE_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

const globalFetch = globalThis.fetch.bind(globalThis);

let identityPromise: Promise<void> | null = null;

async function ensureAnthropicIdentity(config: Config): Promise<void> {
  const anthropic = config.anthropic!;

  if (anthropic.accountUuid && anthropic.userUuid) {
    return;
  }

  if (!anthropic.access) {
    return;
  }

  if (!identityPromise) {
    identityPromise = (async () => {
      try {
        const response = await globalFetch(OAUTH_PROFILE_URL, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${anthropic.access}`,
            "anthropic-beta": CLAUDE_CODE_BETA,
            "anthropic-dangerous-direct-browser-access": "true",
            "user-agent": CLAUDE_CODE_USER_AGENT,
            "x-app": "cli",
            "x-stainless-arch": "arm64",
            "x-stainless-helper-method": "stream",
            "x-stainless-lang": "js",
            "x-stainless-os": "MacOS",
            "x-stainless-package-version": "0.60.0",
            "x-stainless-retry-count": "0",
            "x-stainless-runtime": "node",
            "x-stainless-runtime-version": "v24.3.0",
            "x-stainless-timeout": "600",
          },
        });

        if (response.ok) {
          const profile = await response.json();
          anthropic.accountUuid =
            profile.account?.uuid || anthropic.accountUuid;
          anthropic.organizationUuid =
            profile.organization?.uuid || anthropic.organizationUuid;
        }
      } catch {
        // Ignore failures and fall back to generating identifiers below
      }

      if (!anthropic.userUuid) {
        anthropic.userUuid = randomUUID().toLowerCase();
      }

      await saveConfig(config);
    })().finally(() => {
      identityPromise = null;
    });
  }

  await identityPromise;
}

function normalizeMessageContent(content: any): Array<Record<string, any>> {
  if (typeof content === "string") {
    return [
      {
        type: "text",
        text: content,
      },
    ];
  }

  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === "string") {
        return {
          type: "text",
          text: block,
        };
      }
      return block;
    });
  }

  return [];
}

function buildClaudeCodeSystem(system: unknown): Array<Record<string, any>> {
  const prefix = {
    type: "text",
    text: CLAUDE_CODE_SYSTEM_PREFIX,
  };

  // If system is already an array, prepend our prefix to it
  if (Array.isArray(system)) {
    return [prefix, ...system];
  }

  // If system is a non-empty string, add it after the prefix
  if (typeof system === "string" && system.trim().length > 0) {
    return [
      prefix,
      {
        type: "text",
        text: system,
      },
    ];
  }

  // If system is empty or undefined, just use the prefix
  return [prefix];
}

function injectClaudeCodeMetadata(body: any, config: Config) {
  if (!body || typeof body !== "object") {
    return;
  }

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      if (!message || typeof message !== "object") {
        continue;
      }
      message.content = normalizeMessageContent(message.content);
    }
  }

  const anthropic = config.anthropic!;
  const accountId =
    anthropic.accountUuid ||
    anthropic.organizationUuid ||
    "00000000-0000-0000-0000-000000000000";

  body.system = buildClaudeCodeSystem(body.system);
  body.tools = Array.isArray(body.tools) ? body.tools : [];
  body.metadata = {
    ...(body.metadata ?? {}),
    user_id: `user_${anthropic.userUuid}_account_${accountId}_session_${randomUUID().toLowerCase()}`,
  };
}
export interface OAuthResult {
  url: string;
  verifier: string;
}

export async function startAnthropicOAuth(): Promise<OAuthResult> {
  const pkce = await generatePKCE();

  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set(
    "scope",
    "org:create_api_key user:profile user:inference",
  );
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pkce.verifier);

  return {
    url: url.toString(),
    verifier: pkce.verifier,
  };
}

export async function exchangeOAuthCode(
  code: string,
  verifier: string,
): Promise<{
  type: "success" | "failed";
  refresh?: string;
  access?: string;
  expires?: number;
}> {
  const splits = code.split("#");
  const result = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });

  if (!result.ok) {
    return { type: "failed" };
  }

  const json = await result.json();
  return {
    type: "success",
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

export async function refreshAnthropicToken(refreshToken: string): Promise<{
  access: string;
  expires: number;
} | null> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  return {
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

export function createAnthropicFetch(config: Config) {
  if (!config.anthropic || config.anthropic.type !== "oauth") {
    return fetch;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const anthropic = config.anthropic!;

    // Refresh token if expired or missing
    if (
      !anthropic.access ||
      !anthropic.expires ||
      anthropic.expires < Date.now()
    ) {
      if (!anthropic.refresh) {
        throw new Error("No refresh token available");
      }

      const refreshed = await refreshAnthropicToken(anthropic.refresh);
      if (!refreshed) {
        throw new Error("Failed to refresh Anthropic OAuth token");
      }

      // Update config with new tokens
      anthropic.access = refreshed.access;
      anthropic.expires = refreshed.expires;
      await saveConfig(config);
    }

    const requestHeaders = new Headers(init?.headers ?? {});
    requestHeaders.delete("x-api-key");
    requestHeaders.delete("Accept");

    requestHeaders.set("accept", "application/json");
    requestHeaders.set("authorization", `Bearer ${anthropic.access}`);
    requestHeaders.set("anthropic-beta", CLAUDE_CODE_BETA);
    requestHeaders.set("anthropic-dangerous-direct-browser-access", "true");
    requestHeaders.set("anthropic-version", "2023-06-01");
    requestHeaders.set("user-agent", CLAUDE_CODE_USER_AGENT);
    requestHeaders.set("x-app", "cli");
    requestHeaders.set("x-stainless-arch", "arm64");
    requestHeaders.set("x-stainless-helper-method", "stream");
    requestHeaders.set("x-stainless-lang", "js");
    requestHeaders.set("x-stainless-os", "MacOS");
    requestHeaders.set("x-stainless-package-version", "0.60.0");
    requestHeaders.set("x-stainless-retry-count", "0");
    requestHeaders.set("x-stainless-runtime", "node");
    requestHeaders.set("x-stainless-runtime-version", "v24.3.0");
    requestHeaders.set("x-stainless-timeout", "600");

    let body: BodyInit | null | undefined = init?.body ?? null;
    const urlOriginal = input.toString();
    const shouldTransform =
      typeof body === "string" && urlOriginal.startsWith(API_MESSAGES_URL);

    if (shouldTransform) {
      await ensureAnthropicIdentity(config);
      try {
        const parsed = JSON.parse(body as string);
        injectClaudeCodeMetadata(parsed, config);
        body = JSON.stringify(parsed);
      } catch (error) {
        if (process.env.DEBUG_OAUTH) {
          console.error("Failed to transform Claude request:", error);
        }
      }
    }

    let url = urlOriginal;
    if (url.includes("anthropic.com") && !url.includes("beta=")) {
      url = url + (url.includes("?") ? "&" : "?") + "beta=true";
    }

    if (process.env.DEBUG_OAUTH) {
      console.log("\n=== COMPLETE REQUEST ===");
      console.log("URL:", url);
      console.log("Method:", init?.method || "GET");
      console.log("\nHeaders:");
      requestHeaders.forEach((value, key) => {
        console.log(`  ${key}: ${value}`);
      });
      if (body && typeof body === "string") {
        console.log("\nBody:");
        console.log(body);
      }
      console.log("========================\n");
    }

    return fetch(url, {
      ...init,
      headers: requestHeaders,
      body: body ?? undefined,
    });
  };
}
