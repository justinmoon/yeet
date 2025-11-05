import { expect, test } from "bun:test";
import type { MessagePart } from "../../src/ui/interface";

test("MessagePart should have required fields", () => {
  const part: MessagePart = {
    id: "test-123",
    type: "text",
    content: "Hello, world!",
  };

  expect(part.id).toBe("test-123");
  expect(part.type).toBe("text");
  expect(part.content).toBe("Hello, world!");
});

test("MessagePart can have different types", () => {
  const textPart: MessagePart = {
    id: "1",
    type: "text",
    content: "# Markdown content",
  };

  const toolPart: MessagePart = {
    id: "2",
    type: "tool",
    content: "Tool output",
  };

  expect(textPart.type).toBe("text");
  expect(toolPart.type).toBe("tool");
});

test("MessagePart can have optional metadata", () => {
  const part: MessagePart = {
    id: "test",
    type: "text",
    content: "Content",
    metadata: {
      timestamp: Date.now(),
      modelId: "claude-sonnet-4",
    },
  };

  expect(part.metadata).toBeDefined();
  expect(part.metadata?.timestamp).toBeTypeOf("number");
  expect(part.metadata?.modelId).toBe("claude-sonnet-4");
});
