import { cyan, dim, green, magenta, red, t, yellow } from "@opentui/core";
import type { MessageContent } from "../agent";
import { runAgent } from "../agent";
import { getWatcherBridge } from "../agents/service";
import {
  popActiveAgentContext,
  pushActiveAgentContext,
} from "../agents/runtime-context";
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
import { createDefaultWorkspaceBinding } from "../workspace/binding";
import { setActiveWorkspaceBinding } from "../workspace/state";

const watcherBridge = getWatcherBridge();

/**
 * Get the active model ID based on the active provider
 */
function getActiveModelId(config: Config): string {
  switch (config.activeProvider) {
    case "anthropic":
      return config.anthropic?.model || "";
    case "openai":
      return config.openai?.model || "";
    case "maple":
      return config.maple?.model || "";
    case "opencode":
      return config.opencode.model;
    default:
      return config.opencode.model;
  }
}

/**
 * Backend logic for handling messages, agent interactions, and session management.
 * This is UI-agnostic and can be used by any frontend implementation.
 */
export async function handleMessage(
  message: string,
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  if (!ui.currentSessionId) {
    ui.saveCurrentSession();
  }
  const activeSessionId = ui.currentSessionId;

  logger.info("Handling user message", {
    messageLength: message.length,
    imageAttachments: ui.imageAttachments.length,
  });

  // Add subtle separator between turns
  if (ui.conversationHistory.length > 0) {
    ui.appendOutput(t`${dim("─")}\n`);
  }

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

  // Display user message with [you] prefix
  if (hasImages) {
    ui.appendOutput(
      t`${cyan("[you]")} ${message} ${dim(`[${ui.imageAttachments.length} image(s)]`)}\n`,
    );
  } else {
    ui.appendOutput(t`${cyan("[you]")} ${message}\n`);
  }

  const activeOrigin = {
    agentId: "primary",
    capability: "primary" as const,
  };
  watcherBridge.emit({
    type: "user_message",
    sessionId: activeSessionId,
    origin: activeOrigin,
    content: messageContent,
    text: message,
    timestamp: new Date().toISOString(),
  });

  ui.clearInput();
  updateTokenCount(ui, config, "Thinking");

  // Create abort controller for cancellation
  const abortController = new AbortController();
  ui.abortController = abortController;
  ui.isGenerating = true;
  const runtimeContext = {
    sessionId: activeSessionId ?? null,
    agentId: "primary",
    capability: "primary" as const,
  };
  pushActiveAgentContext(runtimeContext);

  try {
    // Don't print [yeet] prefix - we'll only show it if there's actual text output

    // Get model info for context window limits
    const modelId = getActiveModelId(config);
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
        watcherBridge.emit({
          type: "tool_call",
          sessionId: activeSessionId,
          origin: activeOrigin,
          toolName: event.name,
          toolArgs: event.args,
          timestamp: new Date().toISOString(),
        });

        if (event.name === "bash") {
          ui.appendOutput(t`\n${magenta("[bash]")} ${event.args?.command}\n`);
        } else if (event.name === "read") {
          ui.appendOutput(t`\n${magenta("[read]")} ${event.args?.path}\n`);
        } else if (event.name === "write") {
          ui.appendOutput(t`\n${magenta("[write]")} ${event.args?.path}\n`);
        } else if (event.name === "edit") {
          ui.appendOutput(t`\n${magenta("[edit]")} ${event.args?.path}\n`);
        } else if (event.name === "search") {
          ui.appendOutput(
            t`\n${magenta("[search]")} "${event.args?.pattern}"${event.args?.path ? ` in ${event.args.path}` : ""}\n`,
          );
        } else if (event.name === "complete") {
          ui.appendOutput(
            t`\n${green("✓ Task complete:")} ${event.args?.summary || ""}\n`,
          );
        } else if (event.name === "clarify") {
          ui.appendOutput(t`\n${yellow(`❓ ${event.args?.question || ""}`)}\n`);
        } else if (event.name === "pause") {
          ui.appendOutput(
            t`\n${yellow(`⏸️  Paused: ${event.args?.reason || ""}`)}\n`,
          );
        }
      } else if (event.type === "tool-result") {
        if (lastToolName === "read") {
          if (event.result?.error) {
            ui.appendOutput(t`  ${red(`❌ ${event.result.error}`)}\n`);
          } else {
            ui.appendOutput(t`  ${green(`✓ Read ${lastToolArgs.path}`)}\n`);
          }
        } else if (lastToolName === "write") {
          if (event.result?.error) {
            ui.appendOutput(t`  ${red(`❌ ${event.result.error}`)}\n`);
          } else {
            ui.appendOutput(t`  ${green(`✓ Created ${lastToolArgs.path}`)}\n`);
          }
        } else if (lastToolName === "edit") {
          if (event.result?.error) {
            ui.appendOutput(t`  ${red(`❌ ${event.result.error}`)}\n`);
          } else {
            ui.appendOutput(t`  ${green(`✓ Updated ${lastToolArgs.path}`)}\n`);
          }
        } else if (lastToolName === "search") {
          if (event.result?.error) {
            ui.appendOutput(t`  ${red(`❌ ${event.result.error}`)}\n`);
          } else if (event.result?.message) {
            ui.appendOutput(`  ${event.result.message}\n`);
          } else if (event.result?.matches) {
            const count = event.result.total || 0;
            ui.appendOutput(
              t`  ${green(`✓ Found ${count} match${count !== 1 ? "es" : ""}`)}\n`,
            );
            const displayMatches = event.result.matches.slice(0, 10);
            for (const match of displayMatches) {
              ui.appendOutput(
                t`    ${dim(`${match.file}:${match.line}:`)} ${match.content}\n`,
              );
            }
            if (event.result.matches.length > 10) {
              ui.appendOutput(
                t`    ${dim(`... and ${event.result.matches.length - 10} more`)}\n`,
              );
            }
          }
        } else if (lastToolName === "bash") {
          if (event.result?.error) {
            ui.appendOutput(t`  ${red(`❌ ${event.result.error}`)}\n`);
          } else if (event.result?.stdout) {
            // Indent bash output
            const indentedOutput = event.result.stdout
              .split("\n")
              .map((line: string) => `  ${line}`)
              .join("\n");
            ui.appendOutput(indentedOutput);
            if (event.result.stderr) {
              ui.appendOutput(t`  ${dim(`stderr: ${event.result.stderr}`)}\n`);
            }
            if (event.result.exitCode !== 0) {
              ui.appendOutput(
                t`  ${red(`(exit code: ${event.result.exitCode})`)}\n`,
              );
            }
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
      watcherBridge.emit({
        type: "assistant_message",
        sessionId: activeSessionId,
        origin: activeOrigin,
        content: assistantResponse.trim(),
        text: assistantResponse.trim(),
        timestamp: new Date().toISOString(),
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
    popActiveAgentContext(runtimeContext);
  }
}

export function updateTokenCount(
  ui: UIAdapter,
  config: Config,
  statusPrefix = "Paused",
): void {
  const modelId = getActiveModelId(config);
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
  const modelId = getActiveModelId(config);

  const {
    createSession,
    saveSession,
    loadSession,
    ensureSessionWorkspace,
  } = require("../sessions");

  if (!ui.currentSessionId) {
    const session = createSession(modelId, config.activeProvider, {
      agentCapability: "primary",
      workspace: createDefaultWorkspaceBinding(process.cwd()),
    });
    ui.currentSessionId = session.id;
    if (session.workspace) {
      setActiveWorkspaceBinding(session.workspace);
    }
    logger.info("Created new session", { id: session.id });
  }

  let session = loadSession(ui.currentSessionId);
  if (!session) {
    session = createSession(modelId, config.activeProvider, {
      agentCapability: "primary",
      workspace: createDefaultWorkspaceBinding(process.cwd()),
    });
    session.id = ui.currentSessionId;
  }

  const workspace = ensureSessionWorkspace(session, process.cwd(), true);
  setActiveWorkspaceBinding(workspace);

  session.conversationHistory = ui.conversationHistory;
  session.currentTokens = ui.currentTokens;
  session.model = modelId;
  session.provider = config.activeProvider;

  saveSession(session);
}
