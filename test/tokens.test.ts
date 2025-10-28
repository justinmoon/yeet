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

  test("removes oldest messages when over budget", () => {
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
