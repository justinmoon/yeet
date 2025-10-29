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

export class TUIAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string }> = [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  private sessionModal?: SessionSelectorModal;
  private modalActive = false;

  private renderer!: CliRenderer;
  private input!: TextareaRenderable;
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

    const inputBox = new BoxRenderable(this.renderer, {
      id: "input-box",
      borderStyle: "single",
      borderColor: "blue",
      height: 3,
      border: true,
      zIndex: 100,
    });
    container.add(inputBox);

    this.input = new TextareaRenderable(this.renderer, {
      id: "input",
      placeholder: "Type your message...",
      placeholderColor: "gray",
      wrapMode: "word",
      showCursor: true,
      cursorColor: "blue",
      height: 1,
    });
    inputBox.add(this.input);
    this.input.focus();
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
      // Handle modal navigation
      if (this.modalActive && this.sessionModal) {
        if (key.name === "escape") {
          key.preventDefault();
          this.sessionModal.cancel();
          return;
        }
        if (key.name === "return") {
          key.preventDefault();
          this.sessionModal.selectCurrent();
          return;
        }
        if (key.name === "up") {
          key.preventDefault();
          this.sessionModal.moveUp();
          return;
        }
        if (key.name === "down") {
          key.preventDefault();
          this.sessionModal.moveDown();
          return;
        }
        // Block other input while modal is active
        return;
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
          if (this.pendingMapleSetup) {
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
