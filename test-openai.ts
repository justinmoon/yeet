#!/usr/bin/env bun
/**
 * Quick test script to validate OpenAI Codex plumbing
 */

import { createOpenAI } from "@ai-sdk/openai";
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
  const provider = createOpenAI({
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
