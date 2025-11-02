import type { MessageContent } from "../agent";
import { runAgent } from "../agent";
import type { Config } from "../config";
import { logger } from "../logger";
import { getModelInfo } from "../models/registry";
import {
  calculateContextUsage,
  countMessageTokens,
  formatTokenCount,
  truncateMessages,
} from "../tokens";
import type { UIAdapter } from "./interface";

/**
 * Backend logic for handling messages, agent interactions, and session management.
 * This is UI-agnostic and can be used by any frontend implementation.
 */
export async function handleMessage(
  message: string,
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  logger.info("Handling user message", {
    messageLength: message.length,
    imageAttachments: ui.imageAttachments.length,
  });

  // Add separator if there's already content
  ui.appendOutput("\n" + "─".repeat(60) + "\n\n");

  // Build message content (text + images if any)
  const hasImages = ui.imageAttachments.length > 0;
  let messageContent:
    | string
    | Array<{ type: "text"; text: string } | { type: "image"; image: URL }> =
    message;

  if (hasImages) {
    messageContent = [
      { type: "text", text: message },
      ...ui.imageAttachments.map((img) => ({
        type: "image" as const,
        image: new URL(`data:${img.mimeType};base64,${img.data}`),
      })),
    ];
  }

  // Display user message with attachment count
  if (hasImages) {
    ui.appendOutput(
      `You: ${message} [${ui.imageAttachments.length} image(s)]\n\n`,
    );
  } else {
    ui.appendOutput(`You: ${message}\n\n`);
  }

  ui.clearInput();
  ui.setStatus("Agent thinking...");

  try {
    ui.appendOutput("Assistant: ");

    // Get model info for context window limits
    const modelId =
      config.activeProvider === "maple"
        ? config.maple!.model
        : config.opencode.model;
    const modelInfo = getModelInfo(modelId);

    // Build conversation history with current message
    let messages = [
      ...ui.conversationHistory,
      { role: "user" as const, content: messageContent },
    ];

    // Truncate if approaching context limit
    if (modelInfo) {
      const SYSTEM_PROMPT_TOKENS = 200;
      const originalLength = messages.length;
      messages = truncateMessages(
        messages,
        modelInfo.contextWindow,
        modelId,
        SYSTEM_PROMPT_TOKENS,
      );

      if (messages.length < originalLength) {
        const removed = originalLength - messages.length;
        ui.appendOutput(
          `\n⚠️  Truncated ${removed} old message(s) to fit context window\n\n`,
        );
        logger.info("Truncated conversation history", {
          removed,
          remaining: messages.length,
        });
      }
    }

    let assistantResponse = "";
    let textChunks = 0;
    let lastToolName = "";
    let lastToolArgs: any = {};

    for await (const event of runAgent(messages, config, (tool) => {
      logger.debug("Tool called", { tool });
      ui.setStatus(`Running ${tool}...`);
    })) {
      logger.debug("Agent event", { type: event.type });

      if (event.type === "text") {
        textChunks++;
        logger.debug("Text chunk received", {
          content: event.content?.substring(0, 50),
          chunkNumber: textChunks,
        });
        const text = event.content || "";
        assistantResponse += text;
        ui.appendOutput(text);
      } else if (event.type === "tool") {
        lastToolName = event.name || "";
        lastToolArgs = event.args || {};

        if (event.name === "bash") {
          ui.appendOutput(`\n[bash] ${event.args?.command}\n`);
        } else if (event.name === "read") {
          ui.appendOutput(`\n[read] ${event.args?.path}\n`);
        } else if (event.name === "write") {
          ui.appendOutput(`\n[write] ${event.args?.path}\n`);
        } else if (event.name === "edit") {
          ui.appendOutput(`\n[edit] ${event.args?.path}\n`);
        } else if (event.name === "search") {
          ui.appendOutput(
            `\n[search] "${event.args?.pattern}"${event.args?.path ? ` in ${event.args.path}` : ""}\n`,
          );
        } else if (event.name === "complete") {
          ui.appendOutput(`\n✓ Task complete: ${event.args?.summary || ""}\n`);
        } else if (event.name === "clarify") {
          ui.appendOutput(`\n❓ ${event.args?.question || ""}\n`);
        } else if (event.name === "pause") {
          ui.appendOutput(`\n⏸️  Paused: ${event.args?.reason || ""}\n`);
        }
      } else if (event.type === "tool-result") {
        if (lastToolName === "read") {
          if (event.result?.error) {
            ui.appendOutput(`❌ ${event.result.error}\n`);
          } else {
            ui.appendOutput(`✓ Read ${lastToolArgs.path}\n`);
          }
        } else if (lastToolName === "write") {
          if (event.result?.error) {
            ui.appendOutput(`❌ ${event.result.error}\n`);
          } else {
            ui.appendOutput(`✓ Created ${lastToolArgs.path}\n`);
          }
        } else if (lastToolName === "edit") {
          if (event.result?.error) {
            ui.appendOutput(`❌ ${event.result.error}\n`);
          } else {
            ui.appendOutput(`✓ Updated ${lastToolArgs.path}\n`);
          }
        } else if (lastToolName === "search") {
          if (event.result?.error) {
            ui.appendOutput(`❌ ${event.result.error}\n`);
          } else if (event.result?.message) {
            ui.appendOutput(`${event.result.message}\n`);
          } else if (event.result?.matches) {
            const count = event.result.total || 0;
            ui.appendOutput(
              `✓ Found ${count} match${count !== 1 ? "es" : ""}\n`,
            );
            const displayMatches = event.result.matches.slice(0, 10);
            for (const match of displayMatches) {
              ui.appendOutput(
                `  ${match.file}:${match.line}: ${match.content}\n`,
              );
            }
            if (event.result.matches.length > 10) {
              ui.appendOutput(
                `  ... and ${event.result.matches.length - 10} more\n`,
              );
            }
          }
        } else if (lastToolName === "bash") {
          if (event.result?.error) {
            ui.appendOutput(`❌ ${event.result.error}\n`);
          } else if (event.result?.stdout) {
            ui.appendOutput(event.result.stdout);
            if (event.result.stderr) {
              ui.appendOutput(`stderr: ${event.result.stderr}\n`);
            }
            if (event.result.exitCode !== 0) {
              ui.appendOutput(`(exit code: ${event.result.exitCode})\n`);
            }
          }
        }
      } else if (event.type === "error") {
        ui.appendOutput(`\n❌ Error: ${event.error}\n`);
      }
    }
    ui.appendOutput("\n");

    // Save conversation to history
    ui.conversationHistory.push({ role: "user", content: messageContent });
    if (assistantResponse) {
      ui.conversationHistory.push({
        role: "assistant",
        content: assistantResponse,
      });
    }

    // Clear image attachments after successful send
    ui.clearAttachments();

    // Update token count display
    ui.updateTokenCount();

    // Auto-save session after each message
    ui.saveCurrentSession();

    logger.info("Message handled successfully", {
      textChunks,
      historyLength: ui.conversationHistory.length,
      tokens: ui.currentTokens,
      sessionId: ui.currentSessionId,
    });
  } catch (error: any) {
    logger.error("Error handling message", {
      error: error.message,
      stack: error.stack,
    });
    ui.appendOutput(`\n❌ Error: ${error.message}\n`);
    ui.updateTokenCount();
  }
}

export function updateTokenCount(ui: UIAdapter, config: Config): void {
  const modelId =
    config.activeProvider === "anthropic"
      ? config.anthropic?.model || ""
      : config.activeProvider === "maple"
        ? config.maple!.model
        : config.opencode.model;
  const modelInfo = getModelInfo(modelId);

  if (!modelInfo) {
    ui.currentTokens = 0;
    return;
  }

  const tokens = countMessageTokens(ui.conversationHistory, modelId);
  ui.currentTokens = tokens;

  const tokenDisplay = formatTokenCount(tokens);
  const maxTokens = modelInfo.contextWindow;
  const usage = calculateContextUsage(tokens, maxTokens);
  const maxDisplay = formatTokenCount(maxTokens);

  if (usage >= 80) {
    ui.setStatus(
      `⚠️  ${modelInfo.name} | ${tokenDisplay}/${maxDisplay} (${usage}%)`,
    );
  } else {
    ui.setStatus(
      `${modelInfo.name} | ${tokenDisplay}/${maxDisplay} (${usage}%)`,
    );
  }
}

export function saveCurrentSession(ui: UIAdapter, config: Config): void {
  const modelId =
    config.activeProvider === "maple"
      ? config.maple!.model
      : config.opencode.model;

  const { createSession, saveSession, loadSession } = require("../sessions");

  if (!ui.currentSessionId) {
    const session = createSession(modelId, config.activeProvider);
    ui.currentSessionId = session.id;
    logger.info("Created new session", { id: session.id });
  }

  let session = loadSession(ui.currentSessionId);
  if (!session) {
    session = createSession(modelId, config.activeProvider);
    session.id = ui.currentSessionId;
  }

  session.conversationHistory = ui.conversationHistory;
  session.currentTokens = ui.currentTokens;
  session.model = modelId;
  session.provider = config.activeProvider;

  saveSession(session);
}
