import { encoding_for_model, get_encoding } from "tiktoken";
import type { MessageContent } from "./agent";

/**
 * Estimates token count for messages using tiktoken.
 * Falls back to character-based estimation if tiktoken fails.
 */
export function countMessageTokens(
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  model: string,
): number {
  try {
    // Use cl100k_base encoding (used by GPT-4, Claude, etc)
    const encoding = get_encoding("cl100k_base");

    let tokens = 0;

    for (const message of messages) {
      // Role token overhead (~4 tokens per message for role/formatting)
      tokens += 4;

      if (typeof message.content === "string") {
        tokens += encoding.encode(message.content).length;
      } else {
        // Multimodal content
        for (const part of message.content) {
          if (part.type === "text") {
            tokens += encoding.encode(part.text).length;
          } else if (part.type === "image") {
            // Images: rough estimate based on OpenAI's pricing
            // High detail: ~765 tokens, low detail: ~85 tokens
            // We'll use a middle estimate of ~500 tokens per image
            tokens += 500;
          }
        }
      }
    }

    encoding.free();
    return tokens;
  } catch (error) {
    // Fallback: rough estimate (1 token ≈ 4 characters)
    let totalChars = 0;
    for (const message of messages) {
      if (typeof message.content === "string") {
        totalChars += message.content.length;
      } else {
        for (const part of message.content) {
          if (part.type === "text") {
            totalChars += part.text.length;
          } else {
            totalChars += 2000; // Image estimate
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }
}

/**
 * Formats token count with K suffix for readability
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

/**
 * Calculates percentage of context window used
 */
export function calculateContextUsage(
  currentTokens: number,
  maxTokens: number,
): number {
  return Math.round((currentTokens / maxTokens) * 100);
}

/**
 * Truncates messages to fit within token budget.
 * Always keeps system prompt and most recent messages.
 */
export function truncateMessages(
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  maxTokens: number,
  model: string,
  systemPromptTokens: number,
): Array<{ role: "user" | "assistant"; content: MessageContent }> {
  const targetTokens = Math.floor(maxTokens * 0.8); // Keep 20% buffer

  // If already under budget, return as-is
  const currentTokens = countMessageTokens(messages, model);
  if (currentTokens + systemPromptTokens <= targetTokens) {
    return messages;
  }

  // Keep removing oldest messages until we fit
  const truncated = [...messages];
  while (truncated.length > 0) {
    const tokens = countMessageTokens(truncated, model);
    if (tokens + systemPromptTokens <= targetTokens) {
      break;
    }
    truncated.shift(); // Remove oldest message
  }

  return truncated;
}
