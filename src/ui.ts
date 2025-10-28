import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
} from "@opentui/core";
import {
  type AgentEvent,
  type ImageAttachment,
  type MessageContent,
  runAgent,
} from "./agent";
import { readImageFromClipboard } from "./clipboard";
import { executeCommand, handleMapleSetup, parseCommand } from "./commands";
import type { Config } from "./config";
import { logger } from "./logger";
import { getModelInfo } from "./models/registry";
import {
  calculateContextUsage,
  countMessageTokens,
  formatTokenCount,
  truncateMessages,
} from "./tokens";

export interface UI {
  input: TextareaRenderable;
  output: TextRenderable;
  status: TextRenderable;
  contentBuffer: string;
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }>;
  imageAttachments: ImageAttachment[];
  currentTokens: number;
  appendOutput: (text: string) => void;
  setStatus: (text: string) => void;
  clearInput: () => void;
  clearAttachments: () => void;
  updateTokenCount: () => void;
  pendingMapleSetup?: {
    modelId: string;
  };
}

export function createUI(renderer: CliRenderer, config: Config): UI {
  renderer.setBackgroundColor("#0D1117");

  // Main container
  const container = new BoxRenderable(renderer, {
    id: "main",
    padding: 1,
  });
  renderer.root.add(container);

  // Get current model info for status
  const currentModelId =
    config.activeProvider === "opencode"
      ? config.opencode.model
      : config.maple?.model || "";
  const modelInfo = getModelInfo(currentModelId);
  const modelDisplay = modelInfo
    ? `${modelInfo.name} (${config.activeProvider})`
    : currentModelId;

  // Status bar at top
  const status = new TextRenderable(renderer, {
    id: "status",
    content: `${modelDisplay} | 0/${modelInfo?.contextWindow || "?"} (0%)`,
    fg: "#8B949E",
    height: 1,
  });
  container.add(status);

  // Output area (grows to fill space) - with scrolling
  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "output-scroll",
    borderStyle: "single",
    borderColor: "#30363D",
    title: "Conversation",
    titleAlignment: "left",
    flexGrow: 1,
    flexShrink: 1, // Allow shrinking to not overlap input
    border: true,
    stickyScroll: true,
    stickyStart: "bottom",
    scrollY: true,
    scrollX: false,
    overflow: "hidden", // Clip content that would overflow
  });
  container.add(scrollBox);

  // Output text (no wrapper box)
  const output = new TextRenderable(renderer, {
    id: "output",
    content: "",
    fg: "#C9D1D9",
  });
  scrollBox.add(output);

  // Input area (auto-height at bottom)
  const inputBox = new BoxRenderable(renderer, {
    id: "input-box",
    borderStyle: "single",
    borderColor: "#58A6FF",
    title: "Your Message",
    titleAlignment: "left",
    height: "auto", // Auto-expand based on content
    border: true,
    zIndex: 100,
    backgroundColor: "#0D1117",
  });
  container.add(inputBox);

  const input = new TextareaRenderable(renderer, {
    id: "input",
    textColor: "#F0F6FC",
    backgroundColor: "#0D1117",
    placeholder: "Type your message...",
    placeholderColor: "#6E7681",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#58A6FF",
    height: 1, // Start with 1 line
  });
  inputBox.add(input);
  input.focus();

  // Attachment indicator (shows when images are attached)
  const attachmentIndicator = new TextRenderable(renderer, {
    id: "attachment-indicator",
    content: "",
    fg: "#8B949E",
  });
  inputBox.add(attachmentIndicator);

  const updateAttachmentIndicator = () => {
    if (ui.imageAttachments.length > 0) {
      attachmentIndicator.content = `📎 ${ui.imageAttachments.length} image(s) attached`;
    } else {
      attachmentIndicator.content = "";
    }
  };

  const ui: UI = {
    input,
    output,
    status,
    contentBuffer: "",
    conversationHistory: [],
    imageAttachments: [],
    currentTokens: 0,
    appendOutput: (text: string) => {
      ui.contentBuffer += text;
      output.content = ui.contentBuffer;

      // Force layout recalculation and scroll to bottom
      // @ts-ignore - internal API but necessary for correct rendering
      scrollBox.recalculateBarProps?.();

      // Scroll to bottom (show newest content)
      // @ts-ignore - accessing internal scroll properties
      const maxScroll = Math.max(
        0,
        scrollBox.scrollHeight - scrollBox.viewport.height,
      );
      scrollBox.scrollTop = maxScroll;

      // @ts-ignore - optional internal API for forcing re-render
      renderer.requestAnimationFrame?.(() => {
        // Double render to ensure layout is correct
      });
    },
    setStatus: (text: string) => {
      status.content = text;
    },
    clearInput: () => {
      input.editBuffer.setText("", { history: false });
    },
    clearAttachments: () => {
      ui.imageAttachments = [];
      updateAttachmentIndicator();
    },
    updateTokenCount: () => {
      const modelId =
        config.activeProvider === "maple"
          ? config.maple!.model
          : config.opencode.model;
      const modelInfo = getModelInfo(modelId);

      if (!modelInfo) {
        ui.currentTokens = 0;
        return;
      }

      // Count tokens in conversation
      const tokens = countMessageTokens(ui.conversationHistory, modelId);
      ui.currentTokens = tokens;

      // Update status with token info
      const tokenDisplay = formatTokenCount(tokens);
      const maxTokens = modelInfo.contextWindow;
      const usage = calculateContextUsage(tokens, maxTokens);
      const maxDisplay = formatTokenCount(maxTokens);

      // Warn if approaching limit
      if (usage >= 80) {
        ui.setStatus(
          `⚠️  ${modelInfo.name} | ${tokenDisplay}/${maxDisplay} (${usage}%)`,
        );
      } else {
        ui.setStatus(
          `${modelInfo.name} | ${tokenDisplay}/${maxDisplay} (${usage}%)`,
        );
      }
    },
  };

  // Handle Ctrl-V for image paste
  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    if (key.name === "v" && key.ctrl) {
      key.preventDefault();
      const image = await readImageFromClipboard();
      if (image) {
        ui.imageAttachments.push(image);
        updateAttachmentIndicator();
        logger.info("Image pasted from clipboard", {
          count: ui.imageAttachments.length,
          mimeType: image.mimeType,
        });
      }
      return;
    }

    if (key.name === "return" && !key.shift) {
      key.preventDefault();
      const message = input.editBuffer.getText();
      if (message.trim()) {
        // Check if we're waiting for Maple API key
        if (ui.pendingMapleSetup) {
          const apiKey = message;
          const modelId = ui.pendingMapleSetup.modelId;
          ui.pendingMapleSetup = undefined;
          ui.clearInput();
          await handleMapleSetup(apiKey, modelId, ui, config);
        } else {
          const parsed = parseCommand(message);
          if (parsed.isCommand && parsed.command) {
            ui.clearInput();
            await executeCommand(parsed.command, parsed.args, ui, config);
          } else {
            await handleMessage(message, ui, config);
          }
        }
      }
    }
  });

  return ui;
}

async function handleMessage(message: string, ui: UI, config: Config) {
  logger.info("Handling user message", {
    messageLength: message.length,
    imageAttachments: ui.imageAttachments.length,
  });

  // Add separator if there's already content
  if (ui.contentBuffer.length > 0) {
    ui.appendOutput("\n" + "─".repeat(60) + "\n\n");
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
        // Vercel AI SDK expects URL object with data URL
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
  ui.setStatus("Agent thinking... • Press Enter to send");

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
      const SYSTEM_PROMPT_TOKENS = 200; // Estimate for system prompt
      const originalLength = messages.length;
      messages = truncateMessages(
        messages,
        modelInfo.contextWindow,
        modelId,
        SYSTEM_PROMPT_TOKENS,
      );

      // Warn user if we had to truncate
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
      ui.setStatus(`Running ${tool}... • Press Enter to send`);
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

        // Show minimal tool call info
        if (event.name === "bash") {
          ui.appendOutput(`\n[bash] ${event.args?.command}\n`);
        } else if (event.name === "read") {
          ui.appendOutput(`\n[read] ${event.args?.path}\n`);
        } else if (event.name === "write") {
          ui.appendOutput(`\n[write] ${event.args?.path}\n`);
        } else if (event.name === "edit") {
          ui.appendOutput(`\n[edit] ${event.args?.path}\n`);
        }
      } else if (event.type === "tool-result") {
        // Display user-friendly tool results
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
        } else if (lastToolName === "bash") {
          // For bash, show stdout/stderr as before
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
        // Never display JSON
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

    logger.info("Message handled successfully", {
      textChunks,
      historyLength: ui.conversationHistory.length,
      tokens: ui.currentTokens,
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
