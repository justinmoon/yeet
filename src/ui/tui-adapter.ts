import {
  BoxRenderable,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  RGBA,
  ScrollBoxRenderable,
  type StyledText,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
  cyan,
  dim,
  green,
  stringToStyledText,
  t,
} from "@opentui/core";
import type { MessageContent } from "../agent";
import { readImageFromClipboard } from "../clipboard";
import { handleMapleSetup } from "../commands";
import type { Config } from "../config";
import { logger } from "../logger";
import { getModelInfo } from "../models/registry";
import { normalizePastedPath, readImageFromPath } from "../utils/paste";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import type { UIAdapter } from "./interface";
import { ModelSelectorModal } from "./model-modal";
import { SessionSelectorModal } from "./session-modal";

export class TUIAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string; name?: string }> =
    [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  pendingOAuthSetup?: {
    verifier: string;
    provider?: "anthropic" | "openai";
    state?: string;
  };
  isGenerating = false;
  abortController: AbortController | null = null;
  private sessionModal?: SessionSelectorModal;
  private modelModal?: ModelSelectorModal;
  private modalActive = false;

  private renderer!: CliRenderer;
  private input!: TextareaRenderable;
  private inputBox!: BoxRenderable;
  private output!: TextRenderable;
  private status!: TextRenderable;
  private scrollBox!: ScrollBoxRenderable;
  private contentChunks: Array<string | StyledText> = [];
  private config: Config;
  private userInputCallback?: (message: string) => Promise<void>;
  private commandCallback?: (command: string, args: string[]) => Promise<void>;
  private collapsedPastes = new Map<string, string>();
  private collapsedPasteCounter = 0;

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

  appendOutput(text: string | StyledText): void {
    this.contentChunks.push(text);
    this.renderOutput();
  }

  addMessagePart(part: import("./interface").MessagePart): void {
    if (part.type === "text") {
      this.appendOutput(t`${green("[yeet]")} ${part.content}`);
    } else if (part.type === "tool") {
      const toolName =
        part.metadata?.tool ?? part.metadata?.name ?? part.metadata ?? "tool";
      this.appendOutput(`[${toolName}] ${part.content}`);
    } else {
      this.appendOutput(`${part.content}`);
    }
  }

  clearOutput(): void {
    this.contentChunks = [];
    this.renderOutput();
  }

  setStatus(text: string): void {
    this.status.content = text;
  }

  clearInput(): void {
    this.input.editBuffer.setText("", { history: false });
    this.collapsedPastes.clear();
    this.collapsedPasteCounter = 0;
    this.inputBox.height = 1; // Reset to minimum height
  }

  clearAttachments(): void {
    this.imageAttachments = [];
    this.updateAttachmentIndicator();
  }

  updateTokenCount(): void {
    updateTokenCount(this, this.config, "Paused");
  }

  saveCurrentSession(): void {
    saveCurrentSession(this, this.config);
  }

  private async handlePasteEvent(event: PasteEvent): Promise<void> {
    if (this.modalActive) {
      event.preventDefault();
      return;
    }

    const pastedText = event.text ?? "";

    if (await this.tryAttachImageFromPathCandidate(pastedText)) {
      event.preventDefault();
      return;
    }

    const trimmed = pastedText.trim();
    if (!trimmed) {
      const image = await readImageFromClipboard();
      if (image) {
        event.preventDefault();
        this.addImageAttachment(image, "clipboard-paste");
      }
      return;
    }

    if (this.collapsePastedTextIfNeeded(pastedText)) {
      event.preventDefault();
    }
  }

  private collapsePastedTextIfNeeded(text: string): boolean {
    const normalized = text.replace(/\r/g, "");
    const lineCount = Math.max(
      1,
      normalized.length === 0 ? 0 : normalized.split("\n").length,
    );
    const charCount = normalized.length;
    const shouldCollapse = lineCount >= 3 || charCount > 150;

    if (!shouldCollapse) {
      return false;
    }

    const id = ++this.collapsedPasteCounter;
    const placeholder = `[Pasted ~${lineCount} lines #${id}]`;
    this.collapsedPastes.set(placeholder, text);
    this.input.insertText(`${placeholder} `);
    logger.info("Collapsed large paste", {
      placeholder,
      lineCount,
      charCount,
    });
    return true;
  }

  private pruneCollapsedPastes(): void {
    const currentText = this.input?.editBuffer.getText() ?? "";
    for (const placeholder of Array.from(this.collapsedPastes.keys())) {
      if (!currentText.includes(placeholder)) {
        this.collapsedPastes.delete(placeholder);
      }
    }
  }

  private expandCollapsedPastes(text: string): string {
    if (this.collapsedPastes.size === 0) {
      return text;
    }

    let expanded = text;
    for (const [placeholder, original] of this.collapsedPastes.entries()) {
      if (expanded.includes(placeholder)) {
        expanded = expanded.split(placeholder).join(original);
      }
    }

    return expanded;
  }

  private async tryAttachImageFromPathCandidate(
    rawText: string,
  ): Promise<boolean> {
    const normalized = normalizePastedPath(rawText);
    if (!normalized) {
      return false;
    }

    const image = await readImageFromPath(normalized);
    if (!image) {
      logger.debug("Pasted path is not an image or failed to load", {
        path: normalized,
      });
      return false;
    }

    this.addImageAttachment(image, normalized);
    return true;
  }

  private addImageAttachment(
    image: { mimeType: string; data: string; name?: string },
    source: string,
  ): void {
    this.imageAttachments.push(image);
    this.updateAttachmentIndicator();
    const label = image.name || image.mimeType || "image";
    this.appendOutput(t`${dim(`📎 Attached ${label}`)}\n`);
    logger.info("Image attachment added", {
      source,
      name: image.name,
      mimeType: image.mimeType,
      count: this.imageAttachments.length,
    });
  }

  private setupComponents(): void {
    const container = new BoxRenderable(this.renderer, {
      id: "main",
      padding: 1,
    });
    this.renderer.root.add(container);

    const currentModelId =
      this.config.activeProvider === "anthropic"
        ? this.config.anthropic?.model || ""
        : this.config.activeProvider === "openai"
          ? this.config.openai?.model || ""
          : this.config.activeProvider === "maple"
            ? this.config.maple?.model || ""
            : this.config.opencode.model;
    const modelInfo = getModelInfo(currentModelId);
    const modelDisplay = modelInfo
      ? `${modelInfo.name} (${modelInfo.provider})`
      : currentModelId;

    // Status bar at top with light background (full width)
    this.status = new TextRenderable(this.renderer, {
      id: "status",
      content: `${modelDisplay} | 0/${modelInfo?.contextWindow || "?"} (0%)`,
      fg: RGBA.fromInts(0, 0, 0, 255),
      bg: RGBA.fromInts(220, 220, 220, 255),
      height: 1,
      flexGrow: 1,
      flexShrink: 0,
    });
    container.add(this.status);

    // Messages area (no border)
    this.scrollBox = new ScrollBoxRenderable(this.renderer, {
      id: "output-scroll",
      flexGrow: 1,
      flexShrink: 1,
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

    // Input area
    this.inputBox = new BoxRenderable(this.renderer, {
      id: "input-box",
      height: 1,
      flexGrow: 0,
      flexShrink: 0,
    });
    container.add(this.inputBox);

    this.input = new TextareaRenderable(this.renderer, {
      id: "input",
      placeholder: "Type your message...",
      wrapMode: "word",
      showCursor: true,
      cursorColor: "blue",
      flexGrow: 1,
      flexShrink: 0,
      onContentChange: () => this.pruneCollapsedPastes(),
    });
    this.inputBox.add(this.input);
    this.input.focus();
    this.input.onPaste = (event: PasteEvent) => {
      void this.handlePasteEvent(event);
    };
  }

  private adjustInputHeight(): void {
    const text = this.input.editBuffer.getText();
    const terminalHeight = this.renderer.height;
    const maxInputHeight = Math.floor(terminalHeight / 2);

    // Count lines in the text, accounting for word wrapping
    // Subtract 2 for padding (no borders now)
    const inputWidth = this.renderer.width - 2;
    let lineCount = 1;

    if (text) {
      const lines = text.split("\n");
      lineCount = lines.reduce((total, line) => {
        if (line.length === 0) return total + 1;
        // Account for word wrapping
        return total + Math.ceil(line.length / Math.max(1, inputWidth));
      }, 0);
    }

    // No borders, just the text content
    const desiredHeight = Math.min(lineCount, maxInputHeight);
    const newHeight = Math.max(1, desiredHeight); // Minimum 1 line

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
      if (model.provider === "openai") {
        return !!this.config.openai?.refresh;
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
      this.appendOutput("Run /login-anthropic or /login-openai to authenticate\n");
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
      } else if (modelInfo.provider === "openai") {
        if (this.config.openai) {
          this.config.openai.model = modelId;
        }
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
      for (let i = 0; i < session.conversationHistory.length; i++) {
        const message = session.conversationHistory[i];

        // Add subtle separator between turns (except before first message)
        if (i > 0) {
          this.appendOutput(t`${dim("─")}\n`);
        }

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
            this.appendOutput(
              t`${cyan("[you]")} ${text} ${dim(`[${imageCount} image(s)]`)}\n`,
            );
          } else {
            this.appendOutput(t`${cyan("[you]")} ${message.content}\n`);
          }
        } else {
          this.appendOutput(t`${green("[yeet]")} ${message.content}\n`);
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

      // Handle escape to cancel generation
      if (key.name === "escape" && this.isGenerating && this.abortController) {
        key.preventDefault();
        this.abortController.abort();
        this.appendOutput("\n\n⚠️  Generation cancelled by user\n");
        this.setStatus("Cancelled");
        return;
      }

      if (key.name === "v" && key.ctrl && !key.shift && !key.meta) {
        const image = await readImageFromClipboard();
        if (image) {
          key.preventDefault();
          this.addImageAttachment(image, "clipboard-shortcut");
          return;
        }
      }

      if (key.name === "return" && !key.shift) {
        key.preventDefault();
        const rawMessage = this.input.editBuffer.getText();
        const message = this.expandCollapsedPastes(rawMessage);
        if (message.trim()) {
          if (this.isGenerating) {
            this.appendOutput(
              t`${dim("⚠️  Still working on the previous request (press Esc to cancel).")}\n`,
            );
            return;
          }

          if (this.pendingOAuthSetup) {
            const code = message;
            const verifier = this.pendingOAuthSetup.verifier;
            const provider = this.pendingOAuthSetup.provider || "anthropic";
            const state = this.pendingOAuthSetup.state;
            this.pendingOAuthSetup = undefined;
            this.clearInput();
            const { handleOAuthCodeInput } = await import("../commands");
            await handleOAuthCodeInput(code, verifier, this, this.config, provider, state);
          } else if (this.pendingMapleSetup) {
            const apiKey = message;
            const modelId = this.pendingMapleSetup.modelId;
            this.pendingMapleSetup = undefined;
            this.clearInput();
            await handleMapleSetup(apiKey, modelId, this, this.config);
          } else {
            await handleMessage(message, this, this.config);
          }
        }
      }
    });
  }

  private updateAttachmentIndicator(): void {
    const modelId =
      this.config.activeProvider === "anthropic"
        ? this.config.anthropic?.model || ""
        : this.config.activeProvider === "openai"
          ? this.config.openai?.model || ""
          : this.config.activeProvider === "maple"
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

  private renderOutput(): void {
    const combined = this.contentChunks.map((chunk) =>
      typeof chunk === "string" ? stringToStyledText(chunk) : chunk,
    );

    const allChunks = combined.flatMap((st) => st.chunks);
    const StyledTextClass = stringToStyledText("").constructor as any;
    const mergedContent = new StyledTextClass(allChunks);

    this.output.content = mergedContent;

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
}

export async function createTUIAdapter(config: Config): Promise<UIAdapter> {
  const adapter = new TUIAdapter(config);
  await adapter.start();
  return adapter;
}
