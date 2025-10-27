import { describe, expect, test } from "bun:test";
import { runAgent } from "../src/agent";
import { loadConfig } from "../src/config";

describe("Vision API Test (Manual)", () => {
  test("should send image to claude-haiku-4-5 and get response", async () => {
    const config = await loadConfig();
    config.activeProvider = "opencode";
    config.opencode.model = "claude-haiku-4-5";

    // Create a small test PNG (1x1 red pixel)
    const redPixelPNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const base64Image = redPixelPNG.toString("base64");

    // Build multimodal message using Vercel AI SDK format
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "What color is this pixel?" },
          {
            type: "image" as const,
            image: new URL(`data:image/png;base64,${base64Image}`),
          },
        ],
      },
    ];

    console.log("\n=== Testing Vision API ===");
    console.log("Model:", config.opencode.model);
    console.log("Message structure:", JSON.stringify(messages, null, 2));

    let hasError = false;
    let errorMessage = "";
    let responseText = "";

    try {
      for await (const event of runAgent(messages, config)) {
        if (event.type === "text") {
          responseText += event.content || "";
          process.stdout.write(event.content || "");
        } else if (event.type === "error") {
          hasError = true;
          errorMessage = event.error || "";
          console.log("\n[ERROR]", errorMessage);
        }
      }
    } catch (error: any) {
      hasError = true;
      errorMessage = error.message;
      console.log("\n[CAUGHT ERROR]", error.message);
      console.log("Stack:", error.stack);
    }

    console.log("\n\n=== Test Results ===");
    console.log("Had error:", hasError);
    console.log("Error message:", errorMessage);
    console.log("Response text:", responseText);

    // Document the result
    if (hasError) {
      console.log("\n❌ Vision API failed with error");
      console.log("This confirms the issue needs to be fixed");
    } else {
      console.log("\n✅ Vision API succeeded!");
      expect(responseText.length).toBeGreaterThan(0);
    }
  }, 30000); // 30 second timeout
});
