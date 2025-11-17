import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  CLAUDE_CODE_API_BETA,
  CLAUDE_CODE_BETA,
  createAnthropicFetch,
} from "../auth";
import { loadConfig } from "../config";
import { createMapleFetch } from "../maple";
import { createOpenAIFetch } from "../openai-auth";

export async function createExplainModel(): Promise<LanguageModel> {
  const config = await loadConfig();

  if (config.activeProvider === "anthropic") {
    const anthropicConfig = config.anthropic!;

    if (anthropicConfig.type === "oauth") {
      const customFetch = createAnthropicFetch(config);
      const provider = createAnthropic({
        apiKey: "oauth-token",
        fetch: customFetch as any,
        headers: {
          "anthropic-beta": CLAUDE_CODE_BETA,
        },
      });
      return provider(anthropicConfig.model || "claude-sonnet-4-5-20250929");
    }

    const provider = createAnthropic({
      apiKey: anthropicConfig.apiKey,
      headers: {
        "anthropic-beta": CLAUDE_CODE_API_BETA,
      },
    });

    return provider(anthropicConfig.model || "claude-sonnet-4-5-20250929");
  }

  if (config.activeProvider === "openai") {
    const openaiConfig = config.openai!;
    const customFetch = createOpenAIFetch(config);
    const provider = createOpenAI({
      name: "openai",
      apiKey: "chatgpt-oauth",
      baseURL: "https://chatgpt.com/backend-api",
      fetch: customFetch as any,
    });
    return provider(openaiConfig.model || "gpt-5-codex");
  }

  if (config.activeProvider === "maple") {
    const mapleConfig = config.maple!;
    const mapleFetch = await createMapleFetch({
      apiUrl: mapleConfig.apiUrl,
      apiKey: mapleConfig.apiKey,
      pcr0Values: mapleConfig.pcr0Values,
    });
    const provider = createOpenAICompatible({
      name: "maple",
      baseURL: `${mapleConfig.apiUrl}/v1`,
      fetch: mapleFetch as any,
    });
    return provider(mapleConfig.model);
  }

  const provider = createOpenAICompatible({
    name: "opencode",
    apiKey: config.opencode.apiKey,
    baseURL: config.opencode.baseURL,
  });

  return provider(config.opencode.model);
}
