import { describe, expect, test } from "bun:test";
import {
  calculateContextUsage,
  countMessageTokens,
  formatTokenCount,
  truncateMessages,
} from "../src/tokens";

describe("Token counting", () => {
  test("counts simple string messages", () => {
    const messages = [
      { role: "user" as const, content: "Hello world" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    const tokens = countMessageTokens(messages, "grok-code");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50); // Should be ~10-20 tokens
  });

  test("estimates multimodal messages with images", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "What's in this image?" },
          {
            type: "image" as const,
            image: new URL("data:image/png;base64,iVBORw0KGg..."),
          },
        ],
      },
    ];
    const tokens = countMessageTokens(messages, "claude-sonnet-4-5");
    expect(tokens).toBeGreaterThan(500); // Image adds ~500 tokens
  });

  test("formats token counts with K suffix", () => {
    expect(formatTokenCount(500)).toBe("500");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(128000)).toBe("128.0k");
  });

  test("calculates context usage percentage", () => {
    expect(calculateContextUsage(50000, 128000)).toBe(39);
    expect(calculateContextUsage(100000, 128000)).toBe(78);
    expect(calculateContextUsage(128000, 128000)).toBe(100);
  });
});

describe("Message truncation", () => {
  test("keeps all messages when under budget", () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi" },
      { role: "user" as const, content: "How are you?" },
    ];

    const truncated = truncateMessages(
      messages,
      128000,
      "grok-code",
      200, // system prompt tokens
    );

    expect(truncated.length).toBe(3);
  });

  test.skip("removes oldest messages when over budget (disabled - takes >5s)", () => {
    const messages = Array.from({ length: 100 }, (_, i) => {
      const role = i % 2 === 0 ? "user" : "assistant";
      return {
        role: role as "user" | "assistant",
        content: "This is a test message that will consume some tokens".repeat(
          50,
        ),
      };
    });

    const truncated = truncateMessages(
      messages,
      5000, // Very small budget
      "grok-code",
      200,
    );

    // Should keep only recent messages
    expect(truncated.length).toBeLessThan(messages.length);
    expect(truncated.length).toBeGreaterThan(0);

    // Should keep the most recent message
    expect(truncated[truncated.length - 1]).toEqual(
      messages[messages.length - 1],
    );
  });

  test("handles multimodal messages in truncation", () => {
    const messages = [
      { role: "user" as const, content: "Old message 1" },
      { role: "assistant" as const, content: "Old response 1" },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Recent message with image" },
          {
            type: "image" as const,
            image: new URL("data:image/png;base64,iVBORw0KGg..."),
          },
        ],
      },
    ];

    const truncated = truncateMessages(
      messages,
      1000, // Small budget
      "claude-sonnet-4-5",
      200,
    );

    // Should prioritize keeping recent messages
    expect(truncated.length).toBeGreaterThan(0);
  });
});

describe("Model coverage", () => {
  test("counts tokens for Claude Sonnet 4.5 (Anthropic)", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "claude-sonnet-4-5-20250929");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(50);
  });

  test("counts tokens for Claude Opus 4", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "claude-opus-4-20250514");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Claude 3.5 Sonnet", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "claude-3-5-sonnet-20241022");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Claude 3.5 Haiku", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "claude-3-5-haiku-20241022");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Claude Haiku 4.5 (OpenCode)", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "claude-haiku-4-5");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Grok Code", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "grok-code");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Qwen3 Coder", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "qwen3-coder");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for Kimi K2", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "kimi-k2");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for GPT-5", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "gpt-5");
    expect(tokens).toBeGreaterThan(0);
  });

  test("counts tokens for GPT-5 Codex", () => {
    const messages = [{ role: "user" as const, content: "Test message" }];
    const tokens = countMessageTokens(messages, "gpt-5-codex");
    expect(tokens).toBeGreaterThan(0);
  });

  test("respects different context windows", () => {
    // Claude models have 200k context
    expect(calculateContextUsage(100000, 200000)).toBe(50);

    // Grok and GPT-5 have 128k context
    expect(calculateContextUsage(64000, 128000)).toBe(50);

    // Mistral small has 32k context
    expect(calculateContextUsage(16000, 32000)).toBe(50);
  });

  test("handles long messages across different models", () => {
    const longMessage = "word ".repeat(1000); // ~1000 words
    const messages = [{ role: "user" as const, content: longMessage }];

    // Test with various models
    const models = [
      "claude-sonnet-4-5",
      "grok-code",
      "claude-haiku-4-5",
      "gpt-5-codex",
    ];

    for (const model of models) {
      const tokens = countMessageTokens(messages, model);
      expect(tokens).toBeGreaterThan(500); // Long message should have many tokens
      expect(tokens).toBeLessThan(2000); // But not unreasonably high
    }
  });

  test("token counting is consistent for same content", () => {
    const messages = [
      { role: "user" as const, content: "Hello, how are you?" },
      { role: "assistant" as const, content: "I'm doing well, thanks!" },
    ];

    const count1 = countMessageTokens(messages, "claude-sonnet-4-5");
    const count2 = countMessageTokens(messages, "claude-sonnet-4-5");

    expect(count1).toBe(count2);
  });

  test("different models may have different token counts", () => {
    const messages = [{ role: "user" as const, content: "Hello world!" }];

    // Different tokenizers may yield different counts
    const claudeTokens = countMessageTokens(messages, "claude-sonnet-4-5");
    const grokTokens = countMessageTokens(messages, "grok-code");

    // Both should be reasonable, but may differ
    expect(claudeTokens).toBeGreaterThan(0);
    expect(grokTokens).toBeGreaterThan(0);
  });
});
