import {
  type KeyEvent,
  type PasteEvent,
  type StyledText,
  dim,
  t,
} from "@opentui/core";
import { render, useRenderer } from "@opentui/solid";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import type { MessageContent } from "../agent";
import { readImageFromClipboard } from "../clipboard";
import { executeCommand, handleMapleSetup, parseCommand } from "../commands";
import type { Config } from "../config";
import type { ExplainResult } from "../explain";
import { interpretExplainKey } from "../explain/keymap";
import { logger } from "../logger";
import { getModelInfo } from "../models/registry";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import { cycleTheme, getCurrentTheme, setTheme, themes } from "./colors";
import type { UIAdapter } from "./interface";
import type { MessagePart } from "./interface";
import { normalizePastedPath, readImageFromPath } from "../utils/paste";
import {
  formatAssistantMessage,
  formatToolMessage,
} from "./message-format";

export class TUISolidAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string; name?: string }> =
    [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  pendingOAuthSetup?: { verifier: string };
  isGenerating = false;
  abortController: AbortController | null = null;

  private config: Config;
  private contentChunks: Array<string | StyledText> = [];
  private inputText = "";
  private statusText = "";
  private scrollBoxEl: any;
  private inputEl: any;
  private renderer: any;

  // Signals for reactive rendering
  private setStatusText!: (text: string) => void;
  private setOutputContent!: (content: Array<string | StyledText>) => void;
  private setInputValue!: (value: string) => void;
  private setInputPlaceholder!: (placeholder: string) => void;
  private setImageCount!: (count: number) => void;

  private setExplainVisible?: (value: boolean) => void;
  private setExplainResult?: (value: ExplainResult | null) => void;
  private setExplainIndex?: (value: number) => void;

  private getExplainVisible?: () => boolean;
  private getExplainResult?: () => ExplainResult | null;
  private getExplainIndex?: () => number;

  private explainModalActive = false;
  private explainState: { result: ExplainResult | null; index: number } = {
    result: null,
    index: 0,
  };

  private getStatusText!: () => string;
  private getInputValue!: () => string;
  private getInputPlaceholder!: () => string;
  private getImageCount!: () => number;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Get model info for initial status
    const currentModelId =
      this.config.activeProvider === "anthropic"
        ? this.config.anthropic?.model || ""
        : this.config.activeProvider === "maple"
          ? this.config.maple?.model || ""
          : this.config.opencode.model;
    const modelInfo = getModelInfo(currentModelId);
    const initialStatus = modelInfo
      ? `Paused | ${modelInfo.name} | 0/${modelInfo.contextWindow} (0%)`
      : "Paused";

    render(
      () => {
        const renderer = useRenderer();
        const [statusText, setStatusText] = createSignal(initialStatus);
        const [outputContent, setOutputContent] = createSignal<
          Array<string | StyledText>
        >([]);
        const [inputValue, setInputValue] = createSignal("");
        const [inputPlaceholder, setInputPlaceholder] = createSignal(
          "Type your message...",
        );
        const [imageCount, setImageCount] = createSignal(0);
        let textareaRef: any = null;
        const scrollBoxRef: any = null;

        const themeName = this.config.theme || "tokyonight";
        const theme = setTheme(themeName);
        // Store signal setters for use by adapter methods
        this.setStatusText = setStatusText;
        this.setOutputContent = setOutputContent;
        this.setInputValue = setInputValue;
        this.setInputPlaceholder = setInputPlaceholder;
        this.setImageCount = setImageCount;

        this.getStatusText = statusText;
        this.getInputValue = inputValue;
        this.getInputPlaceholder = inputPlaceholder;
        this.getImageCount = imageCount;

        onMount(() => {
          // Store renderer reference
          this.renderer = renderer;

          const handleExplainKeys = (key: KeyEvent) => {
            this.processExplainKeyEvent(key);
          };

          this.renderer.keyInput?.on?.("keypress", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrepeat", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrelease", handleExplainKeys);

          // Set background color
          renderer.setBackgroundColor(theme.background);

          if (textareaRef) {
            textareaRef.focus();
          }
          // Show welcome message
          if (this.contentChunks.length === 0) {
            this.contentChunks.push(
              "Welcome to Yeet. Type your message and press Enter to send (Shift+Enter for newlines).\n",
            );
            setOutputContent([...this.contentChunks]);
          }
        });

        return (
          <box style={{ flexDirection: "column", flexGrow: 1 }}>
            {/* Header */}
            <box style={{ backgroundColor: "#DCDCDC", height: 1 }}>
              <text style={{ fg: "#000000" }}>{statusText()}</text>
            </box>

            {/* Spacing */}
            <box style={{ height: 1 }}>
              <text> </text>
            </box>

            {/* Main content area - scrollable */}
            <scrollbox
              ref={(el: any) => {
                this.scrollBoxEl = el;
              }}
              style={{ flexGrow: 1 }}
            >
              <For each={outputContent()}>
                {(chunk) => {
                  if (typeof chunk === "string") {
                    return <text>{chunk}</text>;
                  }
                  return <text>{chunk as any}</text>;
                }}
              </For>
            </scrollbox>

            {/* Spacing */}
            <box style={{ height: 1 }}>
              <text> </text>
            </box>

            {/* Footer */}
            <box
              style={{ backgroundColor: "#DCDCDC", height: 1, flexShrink: 0 }}
            >
              <textarea
                ref={(el: any) => {
                  textareaRef = el;
                  this.inputEl = el;
                }}
                placeholder={inputPlaceholder()}
                textColor="#000000"
                focusedTextColor="#000000"
                placeholderColor="#666666"
                cursorColor="#000000"
                wrapMode="word"
                showCursor={true}
                onContentChange={() => {
                  if (textareaRef) {
                    const text = textareaRef.plainText;
                    this.inputText = text;
                    setInputValue(text);
                  }
                }}
                onPaste={(event: PasteEvent) => {
                  void this.handlePasteEvent(event);
                }}
                onKeyDown={async (e: any) => {
                  if (e.name === "return" && !e.shift) {
                    e.preventDefault();
                    const message = textareaRef?.plainText || "";
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
                        this.pendingOAuthSetup = undefined;
                        this.clearInput();
                        const { handleOAuthCodeInput } = await import(
                          "../commands"
                        );
                        await handleOAuthCodeInput(
                          code,
                          verifier,
                          this,
                          this.config,
                        );
                      } else if (this.pendingMapleSetup) {
                        const apiKey = message;
                        const modelId = this.pendingMapleSetup.modelId;
                        this.pendingMapleSetup = undefined;
                        this.clearInput();
                        await handleMapleSetup(
                          apiKey,
                          modelId,
                          this,
                          this.config,
                        );
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
                  } else if (
                    e.name === "v" &&
                    (e.ctrl || e.meta) &&
                    !e.shift
                  ) {
                    const attached = await this.tryAttachClipboardImage(
                      "clipboard-shortcut",
                    );
                    if (attached) {
                      e.preventDefault();
                    }
                  } else if (e.name === "escape") {
                    if (this.isGenerating && this.abortController) {
                      this.abortController.abort();
                      this.appendOutput(
                        "\n\n⚠️  Generation cancelled by user\n",
                      );
                      this.setStatus("Cancelled");
                    }
                  }
                }}
              />
            </box>
          </box>
        );
      },
      {
        exitOnCtrlC: true,
        targetFps: 30,
      },
    );
  }

  async stop(): Promise<void> {
    // The renderer is managed by @opentui/solid's render() function
    // We don't have direct access to stop it, but exitOnCtrlC handles cleanup
  }

  onUserInput(callback: (message: string) => Promise<void>): void {
    // Not used in Solid implementation - handled via onSubmit
  }

  onCommand(
    callback: (command: string, args: string[]) => Promise<void>,
  ): void {
    // Not used in Solid implementation - handled via onSubmit
  }

  appendOutput(chunk: string | StyledText): void {
    this.contentChunks.push(chunk);
    this.setOutputContent([...this.contentChunks]);

    // Auto-scroll to bottom
    if (this.scrollBoxEl) {
      setTimeout(() => {
        this.scrollBoxEl.scrollTop = Math.max(
          0,
          this.scrollBoxEl.scrollHeight -
            (this.scrollBoxEl.viewport?.height || 0),
        );
      }, 0);
    }
  }

  addMessagePart(part: MessagePart): void {
    if (part.type === "text") {
      this.appendOutput(formatAssistantMessage(part.content));
      return;
    }

    if (part.type === "tool") {
      const toolName =
        part.metadata?.tool ?? part.metadata?.name ?? part.metadata ?? "tool";
      this.appendOutput(formatToolMessage(toolName, part.content));
      return;
    }

    this.appendOutput(part.content);
  }

  clearOutput(): void {
    this.contentChunks = [];
    this.setOutputContent([]);
  }

  setStatus(text: string): void {
    this.statusText = text;
    this.setStatusText(text);
  }

  clearInput(): void {
    this.inputText = "";
    this.setInputValue("");
    if (this.inputEl) {
      this.inputEl.editBuffer?.setText("", { history: false });
    }
  }

  clearAttachments(): void {
    this.imageAttachments = [];
    this.updateAttachmentIndicator();
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

  updateTokenCount(): void {
    updateTokenCount(this, this.config, "Paused");
  }

  saveCurrentSession(): void {
    saveCurrentSession(this, this.config);
  }

  setBackgroundColor(color: string): void {
    if (this.renderer) {
      this.renderer.setBackgroundColor(color);
    }
  }

  showExplainReview(result: ExplainResult): void {
    this.explainModalActive = true;
    this.explainState = { result, index: 0 };
    this.setExplainVisible?.(true);
    this.setExplainResult?.(result);
    this.setExplainIndex?.(0);
  }

  hideExplainReview(): void {
    this.explainModalActive = false;
    this.explainState = { result: null, index: 0 };
    this.setExplainVisible?.(false);
    this.setExplainResult?.(null);
    this.setExplainIndex?.(0);
  }

  private nextExplainSection(): void {
    if (!this.explainState.result) return;
    const nextIndex = Math.min(
      this.explainState.index + 1,
      this.explainState.result.sections.length - 1,
    );
    this.explainState.index = nextIndex;
    this.setExplainIndex?.(nextIndex);
  }

  private previousExplainSection(): void {
    if (!this.explainState.result) return;
    const prevIndex = Math.max(this.explainState.index - 1, 0);
    this.explainState.index = prevIndex;
    this.setExplainIndex?.(prevIndex);
  }

  private processExplainKeyEvent(
    key: Pick<KeyEvent, "name" | "code"> & {
      preventDefault?: () => void;
      raw?: string;
      sequence?: string;
    },
  ): void {
    if (!this.explainModalActive) {
      return;
    }

    if (!key || typeof key !== "object") {
      return;
    }

    const action = interpretExplainKey({
      name: key?.name,
      code: key?.code,
    });

    logger.debug("explain-key", {
      action,
      name: key?.name,
      code: key?.code,
      raw: key?.raw,
      sequence: key?.sequence,
    });

    switch (action) {
      case "close":
        key.preventDefault?.();
        this.hideExplainReview();
        break;
      case "previous":
        key.preventDefault?.();
        this.previousExplainSection();
        break;
      case "next":
        key.preventDefault?.();
        this.nextExplainSection();
        break;
      case "submit":
        key.preventDefault?.();
        break;
      default:
        break;
    }
  }

  private async handlePasteEvent(event: PasteEvent): Promise<void> {
    const pastedText = event.text ?? "";

    if (await this.tryAttachImageFromPathCandidate(pastedText)) {
      event.preventDefault();
      return;
    }

    if (!pastedText.trim()) {
      const attached = await this.tryAttachClipboardImage("clipboard-paste");
      if (attached) {
        event.preventDefault();
      }
    }
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

  private async tryAttachClipboardImage(source: string): Promise<boolean> {
    const image = await readImageFromClipboard();
    if (!image) {
      return false;
    }

    this.addImageAttachment(image, source);
    return true;
  }

  private updateAttachmentIndicator(): void {
    const modelId =
      this.config.activeProvider === "anthropic"
        ? this.config.anthropic?.model || ""
        : this.config.activeProvider === "maple"
          ? this.config.maple?.model || ""
          : this.config.opencode.model;
    const modelInfo = getModelInfo(modelId);
    const modelName = modelInfo?.name || modelId;

    if (this.imageAttachments.length > 0) {
      const tokenPortion =
        this.currentTokens > 0
          ? `${this.currentTokens}/${modelInfo?.contextWindow || "?"}`
          : "0/?";
      this.setStatus(
        `${modelName} | ${tokenPortion} | 📎 ${this.imageAttachments.length} image(s)`,
      );
    } else {
      this.updateTokenCount();
    }

    this.setImageCount(this.imageAttachments.length);
  }
}

export async function createTUISolidAdapter(
  config: Config,
): Promise<UIAdapter> {
  const adapter = new TUISolidAdapter(config);
  await adapter.start();
  return adapter;
}
