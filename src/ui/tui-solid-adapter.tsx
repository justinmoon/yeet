import path from "path";
import { fileURLToPath } from "url";
import {
  type KeyEvent,
  type StyledText,
  addDefaultParsers,
  getTreeSitterClient,
  stringToStyledText,
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
import { createSyntaxStyle } from "./syntax-theme";

// Set up tree-sitter worker path for Bun
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(
  __dirname,
  "../../node_modules/@opentui/core/parser.worker.js",
);
process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;

// Initialize built-in tree-sitter parsers (markdown, javascript, typescript)
addDefaultParsers([]);

export class TUISolidAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string }> = [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  pendingOAuthSetup?: { verifier: string };
  isGenerating = false;
  abortController: AbortController | null = null;

  private config: Config;
  private contentChunks: Array<string | StyledText> = [];
  private messageParts: MessagePart[] = [];
  private inputText = "";
  private statusText = "";
  private scrollBoxEl: any;
  private inputEl: any;
  private renderer: any;

  // Signals for reactive rendering
  private setStatusText!: (text: string) => void;
  private setOutputContent!: (content: Array<string | StyledText>) => void;
  private setMessageParts!: (parts: MessagePart[]) => void;
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
  private getOutputContent!: () => Array<string | StyledText>;
  private getMessageParts!: () => MessagePart[];
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
        const [messageParts, setMessageParts] = createSignal<MessagePart[]>([]);
        const [inputValue, setInputValue] = createSignal("");
        const [inputPlaceholder, setInputPlaceholder] = createSignal(
          "Type your message...",
        );
        const [imageCount, setImageCount] = createSignal(0);
        let textareaRef: any = null;
        const scrollBoxRef: any = null;

        // Initialize theme and create reactive syntax style
        const themeName = this.config.theme || "tokyonight";
        const theme = setTheme(themeName);
        const syntaxStyle = createSyntaxStyle(theme);

        // Store signal setters for use by adapter methods
        this.setStatusText = setStatusText;
        this.setOutputContent = setOutputContent;
        this.setMessageParts = setMessageParts;
        this.setInputValue = setInputValue;
        this.setInputPlaceholder = setInputPlaceholder;
        this.setImageCount = setImageCount;

        this.getStatusText = statusText;
        this.getOutputContent = outputContent;
        this.getMessageParts = messageParts;
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

        // Helper to render styled text content
        const renderStyledText = (content: string | StyledText) => {
          if (typeof content === "string") {
            return <text>{content}</text>;
          }
          // StyledText should be rendered directly without conversion
          return <text>{content as any}</text>;
        };

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
              {/* Legacy text chunks (for backwards compatibility during transition) */}
              <For each={outputContent()}>
                {(content) => renderStyledText(content)}
              </For>

              {/* New message parts with proper markdown rendering */}
              <For each={messageParts()}>
                {(part) => {
                  // Only render "text" parts (assistant responses) with markdown
                  // User messages and separators use the legacy appendOutput path
                  if (part.type === "text") {
                    return (
                      <box paddingLeft={3} marginTop={1} flexShrink={0}>
                        <code
                          filetype="markdown"
                          drawUnstyledText={false}
                          syntaxStyle={syntaxStyle}
                          content={part.content}
                          conceal={true}
                        />
                      </box>
                    );
                  } else if (part.type === "tool") {
                    return (
                      <box marginTop={1} flexShrink={0}>
                        <text>{part.content}</text>
                      </box>
                    );
                  }
                  return null;
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
                onKeyDown={async (e: any) => {
                  if (e.name === "return" && !e.shift) {
                    e.preventDefault();
                    const message = textareaRef?.plainText || "";
                    if (message.trim()) {
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

  appendOutput(text: string | StyledText): void {
    this.contentChunks.push(text);
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
    this.messageParts.push(part);
    this.setMessageParts([...this.messageParts]);

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

  clearOutput(): void {
    this.contentChunks = [];
    this.messageParts = [];
    this.setOutputContent([]);
    this.setMessageParts([]);
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

  private updateAttachmentIndicator(): void {
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
