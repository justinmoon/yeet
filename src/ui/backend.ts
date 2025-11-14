import { cyan, dim, red, t, yellow } from "@opentui/core";
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
  if (ui.isGenerating) {
    ui.appendOutput(
      t`${yellow("⚠️  Please wait for the current response to finish (press Esc to cancel).")}\n`,
    );
    return;
  }

  logger.info("Handling user message", {
    messageLength: message.length,
    imageAttachments: ui.imageAttachments.length,
  });

  // Trim trailing newlines for display to keep spacing predictable
  const displayMessage =
    message.replace(/[\r\n]+$/g, "") || message;

  // Build message content (text + images if any)
  const hasImages = ui.imageAttachments.length > 0;
  let messageContent:
    | string
    | Array<{ type: "text"; text: string } | { type: "image"; image: URL }> =
    displayMessage;

  if (hasImages) {
    messageContent = [
      { type: "text", text: displayMessage },
      ...ui.imageAttachments.map((img) => ({
        type: "image" as const,
        image: new URL(`data:${img.mimeType};base64,${img.data}`),
      })),
    ];
  }

  // Display user message with [you] prefix
  if (hasImages) {
    ui.appendOutput(
      t`${cyan("[you]")} ${displayMessage} ${dim(`[${ui.imageAttachments.length} image(s)]`)}\n\n`,
    );
  } else {
    ui.appendOutput(t`${cyan("[you]")} ${displayMessage}\n\n`);
  }

  ui.clearInput();
  updateTokenCount(ui, config, "Thinking");

  // Create abort controller for cancellation
  const abortController = new AbortController();
  ui.abortController = abortController;
  ui.isGenerating = true;

  try {
    // Don't print [yeet] prefix - we'll only show it if there's actual text output

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
          t`\n${yellow(`⚠️  Truncated ${removed} old message(s) to fit context window`)}\n\n`,
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
    let toolMessageCounter = 0;

    const emitToolLine = (toolName: string, text: string) => {
      if (!text) return;
      ui.addMessagePart({
        id: `tool-${toolName}-${Date.now()}-${toolMessageCounter++}`,
        type: "tool",
        content: text,
        metadata: { tool: toolName },
      });
      ui.appendOutput("\n");
    };

    for await (const event of runAgent(
      messages,
      config,
      (tool) => {
        logger.debug("Tool called", { tool });
        updateTokenCount(ui, config, `Running ${tool}`);
      },
      undefined,
      abortController.signal,
    )) {
      logger.debug("Agent event", { type: event.type });

      if (event.type === "text") {
        textChunks++;
        logger.debug("Text chunk received", {
          content: event.content?.substring(0, 50),
          chunkNumber: textChunks,
        });
        const text = event.content || "";
        assistantResponse += text;
        updateTokenCount(ui, config, "Responding");
      } else if (event.type === "tool") {
        lastToolName = event.name || "";
        lastToolArgs = event.args || {};

        if (event.name === "bash") {
          emitToolLine("bash", event.args?.command || "");
        } else if (event.name === "read") {
          emitToolLine("read", event.args?.path || "");
        } else if (event.name === "write") {
          emitToolLine("write", event.args?.path || "");
        } else if (event.name === "edit") {
          emitToolLine("edit", event.args?.path || "");
        } else if (event.name === "search") {
          const pattern = event.args?.pattern || "";
          const location = event.args?.path ? ` in ${event.args.path}` : "";
          emitToolLine("search", `"${pattern}"${location}`);
        } else if (event.name === "complete") {
          emitToolLine(
            "complete",
            `✓ Task complete${event.args?.summary ? `: ${event.args.summary}` : ""}`,
          );
        } else if (event.name === "clarify") {
          emitToolLine("clarify", `❓ ${event.args?.question || ""}`);
        } else if (event.name === "pause") {
          emitToolLine("pause", `⏸️  ${event.args?.reason || ""}`);
        }
      } else if (event.type === "tool-result") {
        if (!lastToolName) {
          continue;
        }
        if (lastToolName === "read") {
          if (event.result?.error) {
            emitToolLine(lastToolName, `❌ ${event.result.error}`);
          } else {
            emitToolLine(lastToolName, `✓ Read ${lastToolArgs.path}`);
          }
        } else if (lastToolName === "write") {
          if (event.result?.error) {
            emitToolLine(lastToolName, `❌ ${event.result.error}`);
          } else {
            emitToolLine(lastToolName, `✓ Created ${lastToolArgs.path}`);
          }
        } else if (lastToolName === "edit") {
          if (event.result?.error) {
            emitToolLine(lastToolName, `❌ ${event.result.error}`);
          } else {
            emitToolLine(lastToolName, `✓ Updated ${lastToolArgs.path}`);
          }
        } else if (lastToolName === "search") {
          if (event.result?.error) {
            emitToolLine(lastToolName, `❌ ${event.result.error}`);
          } else if (event.result?.message) {
            emitToolLine(lastToolName, event.result.message);
          } else if (event.result?.matches) {
            const count = event.result.total || 0;
            const lines = [
              `✓ Found ${count} match${count !== 1 ? "es" : ""}`,
              ...event.result.matches
                .slice(0, 10)
                .map(
                  (match: any) =>
                    `${match.file}:${match.line}: ${match.content}`,
                ),
            ];
            if (event.result.matches.length > 10) {
              lines.push(
                `... and ${event.result.matches.length - 10} more`,
              );
            }
            emitToolLine(lastToolName, lines.join("\n"));
          }
        } else if (lastToolName === "bash") {
          if (event.result?.error) {
            emitToolLine(lastToolName, `❌ ${event.result.error}`);
          } else if (event.result?.stdout) {
            let text = event.result.stdout;
            if (event.result.stderr) {
              text += `\nstderr: ${event.result.stderr}`;
            }
            if (event.result.exitCode !== 0) {
              text += `\n(exit code: ${event.result.exitCode})`;
            }
            emitToolLine(lastToolName, text);
          }
        }
      } else if (event.type === "error") {
        ui.appendOutput(t`\n${red(`❌ Error: ${event.error}`)}\n`);
      }
    }

    // Add assistant response as a message part for markdown rendering
    if (assistantResponse.trim()) {
      ui.addMessagePart({
        id: `assistant-${Date.now()}`,
        type: "text",
        content: assistantResponse.trim(),
      });
    }

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

    // Auto-save session after each message
    ui.saveCurrentSession();

    // Update status back to Paused when done
    updateTokenCount(ui, config, "Paused");

    logger.info("Message handled successfully", {
      textChunks,
      historyLength: ui.conversationHistory.length,
      tokens: ui.currentTokens,
      sessionId: ui.currentSessionId,
    });
  } catch (error: any) {
    // Handle abort error specially
    if (error.name === "AbortError" || abortController.signal.aborted) {
      logger.info("Generation cancelled by user");
      updateTokenCount(ui, config, "Cancelled");
    } else {
      logger.error("Error handling message", {
        error: error.message,
        stack: error.stack,
      });
      ui.appendOutput(t`\n${red(`❌ Error: ${error.message}`)}\n`);
      updateTokenCount(ui, config, "Error");
    }
  } finally {
    // Clean up generation state
    ui.isGenerating = false;
    ui.abortController = null;
  }
}

export function updateTokenCount(
  ui: UIAdapter,
  config: Config,
  statusPrefix = "Paused",
): void {
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

  const statusSuffix = `${modelInfo.name} | ${tokenDisplay}/${maxDisplay} (${usage}%)`;

  if (usage >= 80) {
    ui.setStatus(`${statusPrefix} | ⚠️  ${statusSuffix}`);
  } else {
    ui.setStatus(`${statusPrefix} | ${statusSuffix}`);
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
