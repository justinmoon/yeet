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
import {
  formatMessageLine,
  formatToolSummary,
  type AttachmentRef,
  type ToolCallInfo,
  type ToolSummaryCounts,
} from "./history-renderer";
import { appendHistoryEntry } from "./history-spacing";

const watcherBridge = getWatcherBridge();

/**
 * Extract history rendering config with defaults.
 * Provides a consistent interface for accessing UI history settings.
 */
export function getHistoryConfig(config: Config) {
  return {
    showMetadata: config.ui?.history?.showMetadata ?? true,
    inlineDiffs: config.ui?.history?.inlineDiffs ?? true,
    verboseTools: config.ui?.history?.verboseTools ?? false,
  };
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
  const turnId = `${activeSessionId ?? "session"}-${Date.now()}`;

  logger.info("Handling user message", {
    messageLength: message.length,
    imageAttachments: ui.imageAttachments.length,
  });

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

  // Display user message using formatter
  const historyConfig = getHistoryConfig(config);
  const attachments: AttachmentRef[] = hasImages
    ? ui.imageAttachments.map((_, index) => ({
        type: "image" as const,
        index: index + 1,
      }))
    : [];
  appendHistoryEntry(
    ui,
    `${turnId}-user`,
    formatMessageLine(
      "user",
      message,
      { timestamp: new Date() },
      attachments,
      historyConfig.showMetadata,
    ),
  );

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
    let assistantTextChunks = 0;
    let currentToolGroupId: string | null = null;
    let currentToolCallId = 0;

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
        let text = event.content || "";
        if (assistantTextChunks === 0) {
          text = text.replace(/^\s+/, "");
        }
        if (!text) {
          continue;
        }
        assistantResponse += text;
        updateTokenCount(ui, config, "Responding");
        if (text.trim().length > 0) {
          if (assistantTextChunks === 0) {
            // First chunk: show [yeet] prefix with formatMessageLine
            appendHistoryEntry(
              ui,
              `${turnId}-assistant`,
              formatMessageLine(
                "assistant",
                text,
                { timestamp: new Date() },
                undefined,
                historyConfig.showMetadata,
              ),
            );
          } else {
            // Subsequent chunks: just append text without prefix
            appendHistoryEntry(ui, `${turnId}-assistant`, text);
          }
          assistantTextChunks++;
        }
      } else if (event.type === "tool") {
        lastToolName = event.name || "";
        lastToolArgs = event.args || {};
        assistantTextChunks = 0;
        currentToolCallId += 1;
        currentToolGroupId = `${turnId}-tool-${currentToolCallId}`;
        watcherBridge.emit({
          type: "tool_call",
          sessionId: activeSessionId,
          origin: activeOrigin,
          toolName: event.name,
          toolArgs: event.args,
          timestamp: new Date().toISOString(),
        });

        // Use formatter for tool summary (will be enhanced in tool-result with counts)
        const toolInfo: ToolCallInfo = {
          name: event.name || "",
          args: event.args,
        };

        // Special handling for non-standard tools
        if (event.name === "complete") {
          const statusGroup = `${turnId}-status-${currentToolCallId}`;
          currentToolGroupId = statusGroup;
          appendHistoryEntry(
            ui,
            statusGroup,
            t`${green("✓ Task complete:")} ${event.args?.summary || ""}\n`,
          );
        } else if (event.name === "clarify") {
          const statusGroup = `${turnId}-status-${currentToolCallId}`;
          currentToolGroupId = statusGroup;
          appendHistoryEntry(
            ui,
            statusGroup,
            t`${yellow(`❓ ${event.args?.question || ""}`)}\n`,
          );
        } else if (event.name === "pause") {
          const statusGroup = `${turnId}-status-${currentToolCallId}`;
          currentToolGroupId = statusGroup;
          appendHistoryEntry(
            ui,
            statusGroup,
            t`${yellow(`⏸️  Paused: ${event.args?.reason || ""}`)}\n`,
          );
        } else {
          currentToolGroupId = `${turnId}-tool-${currentToolCallId}`;
          // Don't show tool summary yet - wait for result with actual counts
        }
      } else if (event.type === "tool-result") {
        const toolGroup =
          currentToolGroupId ?? `${turnId}-tool-${currentToolCallId || 0}`;

        // Build tool info and counts from result
        const toolInfo: ToolCallInfo = {
          name: lastToolName || "",
          args: lastToolArgs,
          result: event.result,
        };
        const counts: ToolSummaryCounts = {};

        // Handle errors for all tools
        if (event.result?.error) {
          // Show tool summary with error
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );
          appendHistoryEntry(
            ui,
            toolGroup,
            t`  ${red(`❌ ${event.result.error}`)}\n`,
          );
          continue;
        }

        // Handle tool-specific results with counts
        if (lastToolName === "read") {
          // Count lines for read
          if (event.result?.content) {
            counts.totalLines = (event.result.content as string).split("\n").length;
          }
          // Show tool summary
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );

          // Show verbose file content if enabled
          if (historyConfig.verboseTools && event.result?.content) {
            const lines = (event.result.content as string).split("\n");
            const preview = lines.slice(0, 20).join("\n");
            appendHistoryEntry(ui, toolGroup, t`${dim(preview)}\n`);
            if (lines.length > 20) {
              appendHistoryEntry(
                ui,
                toolGroup,
                t`${dim(`... and ${lines.length - 20} more lines`)}\n`,
              );
            }
          }
        } else if (lastToolName === "write") {
          // Count lines for write
          if (event.result?.content) {
            counts.totalLines = (event.result.content as string).split("\n").length;
          }
          // Show tool summary
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );
        } else if (lastToolName === "edit") {
          // Count added/removed lines from diff
          if (event.result?.diff) {
            const diff = event.result.diff as string;
            const diffLines = diff.split("\n");
            let added = 0;
            let removed = 0;
            for (const line of diffLines) {
              if (line.startsWith("+") && !line.startsWith("+++")) added++;
              if (line.startsWith("-") && !line.startsWith("---")) removed++;
            }
            counts.linesAdded = added;
            counts.linesRemoved = removed;
          }
          // Show tool summary with diff counts
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );

          // Show inline diff if enabled
          if (historyConfig.inlineDiffs && event.result?.diff) {
            const diff = event.result.diff as string;
            const diffLines = diff.split("\n");
            for (const line of diffLines) {
              if (line.startsWith("+") && !line.startsWith("+++")) {
                appendHistoryEntry(ui, toolGroup, t`  ${green(line)}\n`);
              } else if (line.startsWith("-") && !line.startsWith("---")) {
                appendHistoryEntry(ui, toolGroup, t`  ${red(line)}\n`);
              } else {
                appendHistoryEntry(ui, toolGroup, t`  ${dim(line)}\n`);
              }
            }
          }
        } else if (lastToolName === "search") {
          // Count matches
          if (event.result?.total !== undefined) {
            counts.totalLines = event.result.total;
          }
          // Show tool summary
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );

          // Search results are always shown (when available)
          if (event.result?.message) {
            appendHistoryEntry(
              ui,
              toolGroup,
              `  ${event.result.message}\n`,
            );
          } else if (event.result?.matches) {
            const displayMatches = event.result.matches.slice(0, 10);
            for (const match of displayMatches) {
              appendHistoryEntry(
                ui,
                toolGroup,
                t`  ${dim(`${match.file}:${match.line}:`)} ${match.content}\n`,
              );
            }
            if (event.result.matches.length > 10) {
              appendHistoryEntry(
                ui,
                toolGroup,
                t`  ${dim(`... and ${event.result.matches.length - 10} more`)}\n`,
              );
            }
          }
        } else if (lastToolName === "bash") {
          // Get exit code and line count for bash
          counts.exitCode = event.result?.exitCode ?? 0;
          if (event.result?.stdout) {
            counts.totalLines = (event.result.stdout as string).split("\n").length;
          }
          // Show tool summary with exit code
          appendHistoryEntry(
            ui,
            toolGroup,
            formatToolSummary(toolInfo, counts, historyConfig.showMetadata),
          );

          // Show bash output if verbose mode is enabled
          if (historyConfig.verboseTools && event.result?.stdout) {
            appendHistoryEntry(
              ui,
              toolGroup,
              `  ${(event.result.stdout as string).trimEnd()}\n`,
            );
            if (event.result.stderr) {
              appendHistoryEntry(
                ui,
                toolGroup,
                t`  ${dim(`stderr: ${event.result.stderr}`)}\n`,
              );
            }
          }
        }
      } else if (event.type === "error") {
        appendHistoryEntry(
          ui,
          `${turnId}-status-error`,
          t`${red(`❌ Error: ${event.error}`)}\n`,
        );
      }
    }

    // Add assistant response if it never streamed during the turn
    if (assistantResponse.trim() && assistantTextChunks === 0) {
      appendHistoryEntry(
        ui,
        `${turnId}-assistant`,
        formatMessageLine(
          "assistant",
          assistantResponse.trim(),
          { timestamp: new Date() },
          undefined,
          historyConfig.showMetadata,
        ),
      );
    }
    if (assistantResponse.trim()) {
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
