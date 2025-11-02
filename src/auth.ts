import { generatePKCE } from "@openauthjs/openauth/pkce";
import type { Config } from "./config";
import { saveConfig } from "./config";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export interface OAuthResult {
  url: string;
  verifier: string;
}

export async function startAnthropicOAuth(): Promise<OAuthResult> {
  const pkce = await generatePKCE();

  const url = new URL("https://claude.ai/oauth/authorize");
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "redirect_uri",
    "https://console.anthropic.com/oauth/code/callback",
  );
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
  const result = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: "https://console.anthropic.com/oauth/code/callback",
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
  const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
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

    // Remove x-api-key from init headers FIRST
    const initHeaders = init?.headers ? { ...init.headers } : {};
    if ("x-api-key" in initHeaders) {
      delete (initHeaders as any)["x-api-key"];
    }
    if ("Accept" in initHeaders) {
      delete (initHeaders as any)["Accept"];
    }

    // Add OAuth bearer token and required headers (match Claude Code exactly)
    // Our headers MUST override SDK headers, so we put init headers first
    const headers = {
      ...initHeaders,
      accept: "application/json",
      authorization: `Bearer ${anthropic.access}`,
      "anthropic-beta":
        "oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      "anthropic-dangerous-direct-browser-access": "true",
      "user-agent": "claude-cli/2.0.22 (external, cli)",
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
    };

    // Add ?beta=true to URL (match Claude Code)
    let url = input.toString();
    if (url.includes("anthropic.com") && !url.includes("beta=")) {
      url = url + (url.includes("?") ? "&" : "?") + "beta=true";
    }

    return fetch(url, {
      ...init,
      headers,
    });
  };
}
