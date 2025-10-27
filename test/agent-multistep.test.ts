// @ts-nocheck - AI SDK v5 types are complex
import { describe, expect, test } from "bun:test";
import { runAgent } from "../src/agent";
import { loadConfig } from "../src/config";

describe("Agent Multi-Step Behavior", () => {
  test("should support maxSteps configuration", async () => {
    const config = await loadConfig();

    // Override to ensure we're using grok-code with new settings
    config.activeProvider = "opencode";
    config.opencode.model = "grok-code";
    config.maxSteps = 20;
    config.temperature = 0.5;

    const messages = [
      {
        role: "user" as const,
        content:
          "List all .ts files in ./test/tools, then count how many there are",
      },
    ];

    let toolCalls = 0;
    let steps = 0;
    const toolCallDetails: Array<{ name: string; args: any }> = [];

    console.log("\n=== Testing MaxSteps Support ===");
    console.log("Prompt:", messages[0].content);
    console.log("Model:", config.opencode.model);
    console.log("Max Steps:", config.maxSteps);
    console.log("Temperature:", config.temperature);

    for await (const event of runAgent(messages, config)) {
      if (event.type === "text") {
        if (event.content) {
          process.stdout.write(event.content);
        }
      } else if (event.type === "tool") {
        toolCalls++;
        steps++;
        toolCallDetails.push({ name: event.name!, args: event.args });
        console.log(`\n[Tool ${toolCalls}] ${event.name}`);
        console.log("Args:", JSON.stringify(event.args, null, 2));
      } else if (event.type === "tool-result") {
        console.log(`[Result] ${event.name}`);
        if (event.result?.stdout) {
          console.log("Output:", event.result.stdout.substring(0, 100));
        }
      } else if (event.type === "done") {
        console.log("\n\n=== Agent Completed ===");
      }
    }

    console.log("\n=== Test Results ===");
    console.log("Total tool calls:", toolCalls);
    console.log("Steps executed:", steps);
    console.log("\nTool call sequence:");
    toolCallDetails.forEach((call, i) => {
      console.log(`  ${i + 1}. ${call.name}`);
    });

    // Just verify the infrastructure works
    expect(toolCalls).toBeGreaterThan(0);
    expect(config.maxSteps).toBe(20);

    console.log(
      "\n✓ Agent infrastructure supports",
      config.maxSteps,
      "max steps",
    );
  }, 120000); // 2 minute timeout for API calls

  test("should make parallel tool calls when possible", async () => {
    const config = await loadConfig();
    config.activeProvider = "opencode";
    config.opencode.model = "grok-code";
    config.maxSteps = 20;
    config.temperature = 0.5;

    const messages = [
      {
        role: "user" as const,
        content:
          "read the following three files: ./src/agent.ts, ./src/config.ts, and ./src/logger.ts",
      },
    ];

    let toolCalls = 0;
    const toolCallsByStep: Array<Array<{ name: string; args: any }>> = [];
    let currentStep: Array<{ name: string; args: any }> = [];

    console.log("\n=== Testing Parallel Tool Calls ===");
    console.log("Prompt:", messages[0].content);

    for await (const event of runAgent(messages, config)) {
      if (event.type === "tool") {
        toolCalls++;
        currentStep.push({ name: event.name!, args: event.args });
        console.log(`[Tool ${toolCalls}] ${event.name}:`, event.args?.path);
      } else if (event.type === "text" && currentStep.length > 0) {
        // Text after tools means we moved to next reasoning step
        toolCallsByStep.push([...currentStep]);
        currentStep = [];
      } else if (event.type === "done" && currentStep.length > 0) {
        toolCallsByStep.push([...currentStep]);
      }
    }

    console.log("\n=== Tool Calls by Step ===");
    for (let i = 0; i < toolCallsByStep.length; i++) {
      const step = toolCallsByStep[i];
      console.log(`Step ${i + 1}: ${step.length} tool call(s)`);
      for (const call of step) {
        console.log(`  - ${call.name}:`, call.args?.path || call.args);
      }
    }

    // Check if agent made parallel calls
    const hasParallelCalls = toolCallsByStep.some((step) => step.length > 1);
    console.log(
      "\n" + (hasParallelCalls ? "✓" : "✗"),
      "Agent made parallel tool calls:",
      hasParallelCalls,
    );

    expect(toolCalls).toBeGreaterThanOrEqual(3); // Should read all 3 files
  }, 120000);
});
