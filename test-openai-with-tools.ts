#!/usr/bin/env bun
/**
 * Test script to validate OpenAI Codex with tools (like the real agent)
 */

import { createOpenAI } from "@ai-sdk/openai";
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
  const provider = createOpenAI({
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
