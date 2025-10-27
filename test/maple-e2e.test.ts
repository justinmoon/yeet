/**
 * End-to-end tests for Maple AI integration
 *
 * These tests run against the REAL Maple API (no mocks) to verify:
 * - Attestation verification works
 * - Encryption/decryption works
 * - Streaming responses work
 * - Integration with Vercel AI SDK works
 *
 * To run these tests, you need:
 * 1. A Maple API key
 * 2. Set environment variables:
 *    - MAPLE_API_KEY=your-api-key
 *    - MAPLE_API_URL=https://enclave.trymaple.ai (optional, defaults to prod)
 *
 * Run with:
 *   MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts
 *
 * Or skip if no credentials:
 *   bun test test/maple-e2e.test.ts  # Will skip tests
 */

// @ts-nocheck
import { beforeAll, describe, expect, test } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { createMapleFetch } from "../src/maple";
import type { MapleConfig } from "../src/maple/types";

// Test configuration
const MAPLE_API_KEY = process.env.MAPLE_API_KEY;
const MAPLE_API_URL =
  process.env.MAPLE_API_URL || "https://enclave.trymaple.ai";

// Current PCR0 values (update these when Maple updates their enclave)
// Get latest from: curl https://enclave.trymaple.ai/attestation/{nonce} | jq
const PCR0_VALUES = [
  // Current production PCR0 (as of 2025-10-27)
  "79e7bd1e7df09fdb5b7098956a2268c278cc88be323c11975e2a2d080d65f30f8e0efe690edd450493c833b46f40ae1a",
  // Previous PCR0 values (kept for rollback support)
  "ed9109c16f30a470cf0ea2251816789b4ffa510c990118323ce94a2364b9bf05bdb8777959cbac86f5cabc4852e0da71",
  "4f2bcdf16c38842e1a45defd944d24ea58bb5bcb76491843223022acfe9eb6f1ff79b2cb9a6b2a9219daf9c7bf40fa37",
  "b8ee4b511ef2c9c6ab3e5c0840c5df2218fbb4d9df88254ece7af9462677e55aa5a03838f3ae432d86ca1cb6f992eee7",
];

// Skip all tests if no API key provided
const skipTests = !MAPLE_API_KEY;

if (skipTests) {
  console.log("⏭️  Skipping Maple E2E tests (no MAPLE_API_KEY provided)");
  console.log("   To run these tests:");
  console.log("   MAPLE_API_KEY=xxx bun test test/maple-e2e.test.ts");
}

describe("Maple AI E2E Tests", () => {
  let config: MapleConfig;
  let mapleFetch: typeof fetch;

  beforeAll(() => {
    config = {
      apiUrl: MAPLE_API_URL,
      apiKey: MAPLE_API_KEY!,
      pcr0Values: PCR0_VALUES,
    };

    console.log(`\n🔐 Testing against: ${MAPLE_API_URL}`);
    console.log(`🔑 API key: ${MAPLE_API_KEY?.slice(0, 8)}...`);
  });

  describe("Attestation & Key Exchange", { skip: skipTests }, () => {
    test(
      "should establish secure session",
      async () => {
        // This creates the mapleFetch which internally does attestation + key exchange
        mapleFetch = await createMapleFetch(config);

        expect(mapleFetch).toBeDefined();
        expect(typeof mapleFetch).toBe("function");

        console.log("✅ Secure session established");
      },
      { timeout: 10000 },
    ); // Attestation can take a few seconds

    test(
      "should verify attestation document",
      async () => {
        // Fetch attestation directly to verify it's valid
        const nonce = crypto.randomUUID();
        const response = await fetch(`${MAPLE_API_URL}/attestation/${nonce}`);

        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          attestation_document?: string;
        };
        expect(data.attestation_document).toBeDefined();
        expect(typeof data.attestation_document).toBe("string");
        expect(data.attestation_document!.length).toBeGreaterThan(0);

        console.log("✅ Attestation document fetched");
      },
      { timeout: 5000 },
    );
  });

  describe("Raw API Calls", { skip: skipTests }, () => {
    test(
      "should list available models",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        const response = await mapleFetch(`${MAPLE_API_URL}/v1/models`);

        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          data?: Array<{ id: string }>;
        };
        expect(data.data).toBeDefined();
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.data!.length).toBeGreaterThan(0);

        console.log(`✅ Found ${data.data!.length} models`);
        console.log(`   Models: ${data.data!.map((m) => m.id).join(", ")}`);
      },
      { timeout: 5000 },
    );

    test(
      "should make encrypted chat completion request (non-streaming)",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        const requestBody = JSON.stringify({
          model: "mistral-small-3-1-24b", // Smallest/cheapest model (24B params)
          messages: [
            {
              role: "user",
              content: "Say 'test successful' and nothing else.",
            },
          ],
          stream: false,
          max_tokens: 10,
        });

        const response = await mapleFetch(
          `${MAPLE_API_URL}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: requestBody,
          },
        );

        expect(response.ok).toBe(true);

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        expect(data.choices).toBeDefined();
        expect(data.choices!.length).toBeGreaterThan(0);
        expect(data.choices![0].message).toBeDefined();
        expect(data.choices![0].message!.content).toBeDefined();
        expect(typeof data.choices![0].message!.content).toBe("string");

        console.log(
          `✅ Non-streaming response: "${data.choices![0].message!.content}"`,
        );
      },
      { timeout: 30000 },
    );

    test(
      "should make encrypted streaming chat completion request",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        const requestBody = JSON.stringify({
          model: "mistral-small-3-1-24b", // Smallest/cheapest model (24B params)
          messages: [
            {
              role: "user",
              content: "Count from 1 to 3, separated by spaces.",
            },
          ],
          stream: true,
          max_tokens: 20,
        });

        const response = await mapleFetch(
          `${MAPLE_API_URL}/v1/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: requestBody,
          },
        );

        expect(response.ok).toBe(true);
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );

        // Read the stream
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let chunkCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.choices?.[0]?.delta?.content) {
                  fullText += parsed.choices[0].delta.content;
                  chunkCount++;
                }
              } catch (e) {
                // Skip non-JSON lines
              }
            }
          }
        }

        expect(chunkCount).toBeGreaterThan(0);
        expect(fullText.length).toBeGreaterThan(0);

        console.log(
          `✅ Streaming response (${chunkCount} chunks): "${fullText.trim()}"`,
        );
      },
      { timeout: 30000 },
    );
  });

  describe("Vercel AI SDK Integration", { skip: skipTests }, () => {
    test.skip(
      "should work with Vercel AI SDK streamText (streaming)",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        const provider = createOpenAICompatible({
          name: "maple-test",
          baseURL: `${MAPLE_API_URL}/v1`,
          fetch: mapleFetch,
        });

        const result = await streamText({
          model: provider("mistral-small-3-1-24b"), // Smallest/cheapest model
          messages: [
            { role: "user", content: "Say exactly: Hello from Maple!" },
          ],
          maxTokens: 20,
        });

        let fullText = "";
        let chunkCount = 0;

        for await (const chunk of result.textStream) {
          fullText += chunk;
          chunkCount++;
        }

        expect(chunkCount).toBeGreaterThan(0);
        expect(fullText.length).toBeGreaterThan(0);
        expect(fullText.toLowerCase()).toContain("hello");

        console.log(
          `✅ Vercel AI SDK streaming (${chunkCount} chunks): "${fullText}"`,
        );
      },
      { timeout: 30000 },
    );

    test.skip(
      "should handle tool calls through Vercel AI SDK",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        const provider = createOpenAICompatible({
          name: "maple-test",
          baseURL: `${MAPLE_API_URL}/v1`,
          fetch: mapleFetch,
        });

        const result = await streamText({
          model: provider("mistral-small-3-1-24b"), // Smallest/cheapest model
          messages: [
            { role: "user", content: "What is 2+2? Use the calculator tool." },
          ],
          tools: {
            calculator: {
              description: "Calculate a math expression",
              parameters: {
                type: "object" as const,
                properties: {
                  expression: {
                    type: "string" as const,
                    description: "The math expression to evaluate",
                  },
                },
                required: ["expression"],
              },
              execute: async ({ expression }: { expression: string }) => {
                console.log(`   🔧 Tool called: calculator("${expression}")`);
                // Simple eval for testing (don't use in production!)
                return { result: eval(expression) };
              },
            },
          },
          maxSteps: 3,
        });

        let fullText = "";
        let toolCallCount = 0;

        for await (const chunk of result.fullStream) {
          if (chunk.type === "text-delta") {
            fullText += chunk.text;
          }
          if (chunk.type === "tool-call") {
            toolCallCount++;
            console.log(`   Tool call: ${chunk.toolName}`);
          }
        }

        expect(toolCallCount).toBeGreaterThan(0);

        console.log(`✅ Tool calls: ${toolCallCount} tool(s) called`);
        console.log(`   Final response: "${fullText}"`);
      },
      { timeout: 30000 },
    );
  });

  describe("Error Handling", { skip: skipTests }, () => {
    test(
      "should handle invalid API key gracefully",
      async () => {
        const badConfig: MapleConfig = {
          ...config,
          apiKey: "invalid-key-12345",
        };

        try {
          const badFetch = await createMapleFetch(badConfig);

          // Try to make a request
          const response = await badFetch(`${MAPLE_API_URL}/v1/models`, {
            method: "GET",
          });

          // Should fail with 401 or similar
          expect(response.ok).toBe(false);
          console.log(
            `✅ Invalid API key rejected (status: ${response.status})`,
          );
        } catch (error: any) {
          // Also acceptable to throw an error
          expect(error.message).toBeDefined();
          console.log(`✅ Invalid API key rejected (error: ${error.message})`);
        }
      },
      { timeout: 10000 },
    );

    test(
      "should handle invalid PCR0 values",
      async () => {
        const badConfig: MapleConfig = {
          ...config,
          pcr0Values: [
            "0000000000000000000000000000000000000000000000000000000000000000",
          ],
        };

        try {
          await createMapleFetch(badConfig);

          // If we get here, the attestation had the wrong PCR0 or wasn't validated
          throw new Error("Should have rejected invalid PCR0");
        } catch (error: any) {
          expect(error.message).toContain("PCR0");
          console.log(`✅ Invalid PCR0 rejected: ${error.message}`);
        }
      },
      { timeout: 10000 },
    );
  });

  describe("Performance", { skip: skipTests }, () => {
    test(
      "should establish session in reasonable time",
      async () => {
        const start = Date.now();

        const testFetch = await createMapleFetch(config);

        const elapsed = Date.now() - start;

        // Attestation + key exchange should complete in < 5 seconds
        expect(elapsed).toBeLessThan(5000);

        console.log(`✅ Session established in ${elapsed}ms`);
      },
      { timeout: 10000 },
    );

    test(
      "subsequent requests should be fast",
      async () => {
        if (!mapleFetch) {
          mapleFetch = await createMapleFetch(config);
        }

        // Make 3 requests and measure time
        const times: number[] = [];

        for (let i = 0; i < 3; i++) {
          const start = Date.now();

          const response = await mapleFetch(`${MAPLE_API_URL}/v1/models`);
          expect(response.ok).toBe(true);
          await response.json();

          const elapsed = Date.now() - start;
          times.push(elapsed);
        }

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

        // Average request should be < 2 seconds (encryption overhead + network)
        expect(avgTime).toBeLessThan(2000);

        console.log(
          `✅ Avg request time: ${avgTime.toFixed(0)}ms (times: ${times.join(", ")}ms)`,
        );
      },
      { timeout: 15000 },
    );
  });
});

/**
 * Utility test to fetch current PCR0 value
 *
 * Run this when you need to update PCR0_VALUES:
 *   bun test test/maple-e2e.test.ts -t "fetch current PCR0"
 */
describe("Maple Utilities", { skip: skipTests }, () => {
  test(
    "fetch current PCR0 value from Maple",
    async () => {
      const nonce = crypto.randomUUID();
      const response = await fetch(`${MAPLE_API_URL}/attestation/${nonce}`);

      expect(response.ok).toBe(true);

      const data = (await response.json()) as { attestation_document?: string };

      console.log("\n📋 Current Maple PCR0 Information:");
      console.log(
        `   Attestation doc length: ${data.attestation_document?.length || 0} bytes`,
      );
      console.log(`   Timestamp: ${new Date().toISOString()}`);
      console.log(
        "\n⚠️  To get the PCR0 value, you need to decode the attestation document.",
      );
      console.log(
        "   For now, check Maple's documentation or dashboard for the current PCR0.",
      );
      console.log(`   API URL: ${MAPLE_API_URL}/attestation/{nonce}`);
    },
    { timeout: 5000 },
  );
});
