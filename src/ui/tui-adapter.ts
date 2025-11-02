import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
} from "@opentui/core";
import type { MessageContent } from "../agent";
import { readImageFromClipboard } from "../clipboard";
import { executeCommand, handleMapleSetup, parseCommand } from "../commands";
import type { Config } from "../config";
import { logger } from "../logger";
import { getModelInfo } from "../models/registry";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import type { UIAdapter } from "./interface";
import { SessionSelectorModal } from "./session-modal";
import { ModelSelectorModal } from "./model-modal";

export class TUIAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string }> = [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  pendingOAuthSetup?: { verifier: string };
  private sessionModal?: SessionSelectorModal;
  private modelModal?: ModelSelectorModal;
  private modalActive = false;

  private renderer!: CliRenderer;
  private input!: TextareaRenderable;
  private inputBox!: BoxRenderable;
  private output!: TextRenderable;
  private status!: TextRenderable;
  private scrollBox!: ScrollBoxRenderable;
  private contentBuffer = "";
  private config: Config;
  private userInputCallback?: (message: string) => Promise<void>;
  private commandCallback?: (command: string, args: string[]) => Promise<void>;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Create renderer
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      targetFps: 60,
    });

    // Setup UI components
    this.setupComponents();

    // Setup input handlers
    this.setupInputHandlers();

    // Start renderer
    this.renderer.start();
    logger.info("TUI renderer started");

    console.log(
      "Yeet started. Type your message and press Enter to send (Shift+Enter for newlines).",
    );
  }

  async stop(): Promise<void> {
    if (this.renderer) {
      this.renderer.stop();
    }
  }

  onUserInput(callback: (message: string) => Promise<void>): void {
    this.userInputCallback = callback;
  }

  onCommand(
    callback: (command: string, args: string[]) => Promise<void>,
  ): void {
    this.commandCallback = callback;
  }

  appendOutput(text: string): void {
    this.contentBuffer += text;
    this.output.content = this.contentBuffer;

    // Force layout recalculation and scroll to bottom
    // @ts-ignore
    this.scrollBox.recalculateBarProps?.();

    // @ts-ignore
    const maxScroll = Math.max(
      0,
      this.scrollBox.scrollHeight - this.scrollBox.viewport.height,
    );
    this.scrollBox.scrollTop = maxScroll;

    // @ts-ignore
    this.renderer.requestAnimationFrame?.(() => {});
  }

  clearOutput(): void {
    this.contentBuffer = "";
    this.output.content = this.contentBuffer;
  }

  setStatus(text: string): void {
    this.status.content = text;
  }

  clearInput(): void {
    this.input.editBuffer.setText("", { history: false });
    this.inputBox.height = 3; // Reset to minimum height
  }

  clearAttachments(): void {
    this.imageAttachments = [];
    this.updateAttachmentIndicator();
  }

  updateTokenCount(): void {
    updateTokenCount(this, this.config);
  }

  saveCurrentSession(): void {
    saveCurrentSession(this, this.config);
  }

  private setupComponents(): void {
    const container = new BoxRenderable(this.renderer, {
      id: "main",
      padding: 1,
    });
    this.renderer.root.add(container);

    const currentModelId =
      this.config.activeProvider === "opencode"
        ? this.config.opencode.model
        : this.config.maple?.model || "";
    const modelInfo = getModelInfo(currentModelId);
    const modelDisplay = modelInfo
      ? `${modelInfo.name} (${this.config.activeProvider})`
      : currentModelId;

    this.status = new TextRenderable(this.renderer, {
      id: "status",
      content: `${modelDisplay} | 0/${modelInfo?.contextWindow || "?"} (0%)`,
      fg: "gray",
      height: 1,
    });
    container.add(this.status);

    this.scrollBox = new ScrollBoxRenderable(this.renderer, {
      id: "output-scroll",
      borderStyle: "single",
      borderColor: "gray",
      flexGrow: 1,
      flexShrink: 1,
      border: true,
      stickyScroll: true,
      stickyStart: "bottom",
      scrollY: true,
      scrollX: false,
      overflow: "hidden",
    });
    container.add(this.scrollBox);

    this.output = new TextRenderable(this.renderer, {
      id: "output",
      content: "",
    });
    this.scrollBox.add(this.output);

    this.inputBox = new BoxRenderable(this.renderer, {
      id: "input-box",
      borderStyle: "single",
      borderColor: "blue",
      minHeight: 3,
      flexGrow: 0,
      flexShrink: 0,
      border: true,
      zIndex: 100,
    });
    container.add(this.inputBox);

    this.input = new TextareaRenderable(this.renderer, {
      id: "input",
      placeholder: "Type your message...",
      placeholderColor: "gray",
      wrapMode: "word",
      showCursor: true,
      cursorColor: "blue",
      flexGrow: 1,
      flexShrink: 0,
    });
    this.inputBox.add(this.input);
    this.input.focus();
  }

  private adjustInputHeight(): void {
    const text = this.input.editBuffer.getText();
    const terminalHeight = this.renderer.height;
    const maxInputHeight = Math.floor(terminalHeight / 2);

    // Count lines in the text, accounting for word wrapping
    // Subtract 4 for borders and padding
    const inputWidth = this.renderer.width - 4;
    let lineCount = 1;

    if (text) {
      const lines = text.split("\n");
      lineCount = lines.reduce((total, line) => {
        if (line.length === 0) return total + 1;
        // Account for word wrapping
        return total + Math.ceil(line.length / Math.max(1, inputWidth));
      }, 0);
    }

    // Add padding for borders (2 lines for top/bottom border)
    const desiredHeight = Math.min(lineCount + 2, maxInputHeight);
    const newHeight = Math.max(3, desiredHeight); // Minimum 3 lines

    if (this.inputBox.height !== newHeight) {
      this.inputBox.height = newHeight;
    }
  }

  showModelSelector(): void {
    const { MODELS, getModelInfo } = require("../models/registry");
    const { saveConfig } = require("../config");

    // Filter models based on auth status
    const availableModels = MODELS.filter((model: any) => {
      if (model.provider === "anthropic") {
        return (
          !!this.config.anthropic?.apiKey || !!this.config.anthropic?.refresh
        );
      }
      if (model.provider === "opencode") {
        return !!this.config.opencode.apiKey;
      }
      if (model.provider === "maple") {
        return !!this.config.maple?.apiKey;
      }
      return false;
    });

    if (availableModels.length === 0) {
      this.appendOutput(
        "No models available. Please configure authentication first.\n",
      );
      this.appendOutput("Run /auth login for Anthropic OAuth\n");
      return;
    }

    this.modelModal = new ModelSelectorModal(
      this.renderer,
      availableModels,
      this.config,
    );

    this.modelModal.setOnSelect(async (modelId: string) => {
      this.modalActive = false;
      this.modelModal?.hide();
      this.modelModal = undefined;
      this.input.focus();

      const modelInfo = getModelInfo(modelId);
      if (!modelInfo) return;

      // Update config
      this.config.activeProvider = modelInfo.provider;
      if (modelInfo.provider === "anthropic") {
        if (!this.config.anthropic) {
          this.config.anthropic = { type: "api", apiKey: "" };
        }
        this.config.anthropic.model = modelId;
      } else if (modelInfo.provider === "opencode") {
        this.config.opencode.model = modelId;
      } else if (modelInfo.provider === "maple") {
        if (this.config.maple) {
          this.config.maple.model = modelId;
        }
      }

      await saveConfig(this.config);
      this.appendOutput(
        `✓ Switched to ${modelInfo.name} (${modelInfo.provider})\n`,
      );
      this.setStatus(`Ready • ${modelInfo.name} • Press Enter to send`);
    });

    this.modelModal.setOnCancel(() => {
      this.modalActive = false;
      this.modelModal?.hide();
      this.modelModal = undefined;
      this.input.focus();
    });

    this.modalActive = true;
    this.modelModal.show();
  }

  showSessionSelector(): void {
    const { listSessions, loadSession } = require("../sessions");
    const sessions = listSessions();

    if (sessions.length === 0) {
      this.appendOutput("No saved sessions found.\n");
      return;
    }

    // Load previews for sessions
    const sessionsWithPreviews = sessions.slice(0, 50).map((s: any) => {
      const fullSession = loadSession(s.id);
      let preview = "";
      if (fullSession && fullSession.conversationHistory.length > 0) {
        const firstUserMsg = fullSession.conversationHistory.find(
          (m: any) => m.role === "user",
        );
        if (firstUserMsg) {
          preview =
            typeof firstUserMsg.content === "string"
              ? firstUserMsg.content
              : "[message with images]";
        }
      }
      return { ...s, preview };
    });

    this.sessionModal = new SessionSelectorModal(
      this.renderer,
      sessionsWithPreviews,
    );

    this.sessionModal.setOnSelect(async (sessionId: string) => {
      this.modalActive = false;
      this.sessionModal?.hide();
      this.sessionModal = undefined;
      this.input.focus();
      const { loadSession } = require("../sessions");
      const session = loadSession(sessionId);

      if (!session) {
        this.appendOutput(`❌ Failed to load session: ${sessionId}\n`);
        return;
      }

      // Load session into UI
      this.currentSessionId = session.id;
      this.conversationHistory = session.conversationHistory;
      this.currentTokens = session.currentTokens;

      // Display conversation history
      this.clearOutput();
      this.appendOutput(`✓ Loaded session ${session.id}\n`);
      if (session.name) {
        this.appendOutput(`  Name: ${session.name}\n`);
      }
      this.appendOutput(
        `  ${session.model} • ${session.totalMessages} messages\n\n`,
      );

      // Replay conversation
      for (const message of session.conversationHistory) {
        if (message.role === "user") {
          const hasImages =
            Array.isArray(message.content) &&
            message.content.some((p: any) => p.type === "image");
          if (hasImages) {
            const imageCount = (message.content as any[]).filter(
              (p) => p.type === "image",
            ).length;
            const text = (message.content as any[])
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("");
            this.appendOutput(`You: ${text} [${imageCount} image(s)]\n\n`);
          } else {
            this.appendOutput(`You: ${message.content}\n\n`);
          }
        } else {
          this.appendOutput(`Assistant: ${message.content}\n\n`);
        }
      }

      this.updateTokenCount();
    });

    this.sessionModal.setOnCancel(() => {
      this.modalActive = false;
      this.sessionModal?.hide();
      this.sessionModal = undefined;
      this.input.focus();
    });

    this.modalActive = true;
    this.sessionModal.show();
  }

  private setupInputHandlers(): void {
    this.renderer.keyInput.on("keypress", async (key: KeyEvent) => {
      // Adjust input height on every keypress
      this.adjustInputHeight();

      // Handle modal navigation
      if (this.modalActive) {
        const modal = this.sessionModal || this.modelModal;
        if (modal) {
          if (key.name === "escape") {
            key.preventDefault();
            modal.cancel();
            return;
          }
          if (key.name === "return") {
            key.preventDefault();
            modal.selectCurrent();
            return;
          }
          if (key.name === "up") {
            key.preventDefault();
            modal.moveUp();
            return;
          }
          if (key.name === "down") {
            key.preventDefault();
            modal.moveDown();
            return;
          }
          // Block other input while modal is active
          return;
        }
      }
      if (key.name === "v" && key.ctrl) {
        key.preventDefault();
        const image = await readImageFromClipboard();
        if (image) {
          this.imageAttachments.push(image);
          this.updateAttachmentIndicator();
          logger.info("Image pasted from clipboard", {
            count: this.imageAttachments.length,
            mimeType: image.mimeType,
          });
        }
        return;
      }

      if (key.name === "return" && !key.shift) {
        key.preventDefault();
        const message = this.input.editBuffer.getText();
        if (message.trim()) {
          if (this.pendingOAuthSetup) {
            const code = message;
            const verifier = this.pendingOAuthSetup.verifier;
            this.pendingOAuthSetup = undefined;
            this.clearInput();
            const { handleOAuthCodeInput } = await import("../commands");
            await handleOAuthCodeInput(code, verifier, this, this.config);
          } else if (this.pendingMapleSetup) {
            const apiKey = message;
            const modelId = this.pendingMapleSetup.modelId;
            this.pendingMapleSetup = undefined;
            this.clearInput();
            await handleMapleSetup(apiKey, modelId, this, this.config);
          } else {
            const parsed = parseCommand(message);
            if (parsed.isCommand && parsed.command) {
              this.clearInput();
              await executeCommand(
                parsed.command,
                parsed.args,
                this,
                this.config,
              );
            } else {
              await handleMessage(message, this, this.config);
            }
          }
        }
      }
    });
  }

  private updateAttachmentIndicator(): void {
    const modelId =
      this.config.activeProvider === "maple"
        ? this.config.maple!.model
        : this.config.opencode.model;
    const modelInfo = getModelInfo(modelId);
    const modelName = modelInfo?.name || modelId;

    if (this.imageAttachments.length > 0) {
      this.setStatus(
        `${modelName} | ${this.currentTokens > 0 ? `${this.currentTokens}/${modelInfo?.contextWindow || "?"}` : "0/?"} | 📎 ${this.imageAttachments.length} image(s)`,
      );
    } else {
      this.updateTokenCount();
    }
  }
}

export async function createTUIAdapter(config: Config): Promise<UIAdapter> {
  const adapter = new TUIAdapter(config);
  await adapter.start();
  return adapter;
}
