// Test OpenAI Codex integration with real API calls
import { describe, test } from "bun:test";
import { runAgent } from "../src/agent";
import { loadConfig } from "../src/config";

describe("OpenAI Codex E2E", () => {
  test("simple text generation", async () => {
    const config = await loadConfig();
    if (!config.openai) {
      console.log("⏭️  Skipping OpenAI test - not configured");
      return;
    }

    config.activeProvider = "openai";

    const messages = [{ role: "user" as const, content: "Say hello" }];

    let textReceived = "";
    let toolCallsReceived = 0;
    let errors: string[] = [];

    try {
      for await (const event of runAgent(messages, config, undefined, 1)) {
        console.log(`Event: ${event.type}`, event.content || event.name);

        if (event.type === "text") {
          textReceived += event.content || "";
        }
        if (event.type === "tool") {
          toolCallsReceived++;
        }
        if (event.type === "error") {
          errors.push(event.error || "unknown");
        }
      }

      console.log("\n=== Test Results ===");
      console.log("Text received:", textReceived);
      console.log("Tool calls:", toolCallsReceived);
      console.log("Errors:", errors);

      if (errors.length > 0) {
        throw new Error(`Test had errors: ${errors.join(", ")}`);
      }
    } catch (error: any) {
      console.error("\n❌ Test failed:", error.message);
      throw error;
    }
  }, { timeout: 30000 });

  test("tool call with bash", async () => {
    const config = await loadConfig();
    if (!config.openai) {
      console.log("⏭️  Skipping OpenAI test - not configured");
      return;
    }

    config.activeProvider = "openai";
    config.maxSteps = 3;

    const messages = [{
      role: "user" as const,
      content: "Run the command 'echo hello' using bash"
    }];

    let bashCalled = false;
    let errors: string[] = [];

    try {
      for await (const event of runAgent(messages, config, undefined, 5)) {
        console.log(`Event: ${event.type}`, event);

        if (event.type === "tool" && event.name === "bash") {
          bashCalled = true;
        }
        if (event.type === "error") {
          errors.push(event.error || "unknown");
        }
      }

      console.log("\n=== Tool Call Test Results ===");
      console.log("Bash called:", bashCalled);
      console.log("Errors:", errors);

      if (!bashCalled) {
        throw new Error("Bash tool was never called");
      }
      if (errors.length > 0) {
        throw new Error(`Test had errors: ${errors.join(", ")}`);
      }
    } catch (error: any) {
      console.error("\n❌ Tool call test failed:", error.message);
      throw error;
    }
  }, { timeout: 60000 });
});
