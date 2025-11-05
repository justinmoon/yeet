import { type StyledText, stringToStyledText } from "@opentui/core";
import { render, useRenderer } from "@opentui/solid";
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import type { MessageContent } from "../agent";
import { readImageFromClipboard } from "../clipboard";
import { executeCommand, handleMapleSetup, parseCommand } from "../commands";
import type { Config } from "../config";
import { logger } from "../logger";
import { getModelInfo } from "../models/registry";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import { cycleTheme, getCurrentTheme, setTheme, themes } from "./colors";
import type { UIAdapter } from "./interface";
import type { ExplainResult } from "../explain";

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

  private getStatusText!: () => string;
  private getOutputContent!: () => Array<string | StyledText>;
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

    const adapter = this;

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
        const [explainVisible, setExplainVisible] = createSignal(false);
        const [explainResult, setExplainResult] = createSignal<
          ExplainResult | null
        >(null);
        const [explainIndex, setExplainIndex] = createSignal(0);
        let textareaRef: any = null;
        const scrollBoxRef: any = null;

        // Store signal setters for use by adapter methods
        this.setStatusText = setStatusText;
        this.setOutputContent = setOutputContent;
        this.setInputValue = setInputValue;
        this.setInputPlaceholder = setInputPlaceholder;
        this.setImageCount = setImageCount;

        this.getStatusText = statusText;
        this.getOutputContent = outputContent;
        this.getInputValue = inputValue;
        this.getInputPlaceholder = inputPlaceholder;
        this.getImageCount = imageCount;

        this.setExplainVisible = setExplainVisible;
        this.setExplainResult = setExplainResult;
        this.setExplainIndex = setExplainIndex;
        this.getExplainVisible = explainVisible;
        this.getExplainResult = explainResult;
        this.getExplainIndex = explainIndex;

        const explainData = createMemo(() => {
          const result = explainResult();
          if (!result) return null;
          const index = Math.max(
            0,
            Math.min(result.sections.length - 1, explainIndex()),
          );
          const section = result.sections[index];
          const diff = section
            ? result.diffs.find((d) => d.id === section.diffId)
            : undefined;
          return {
            result,
            index,
            section,
            diff,
          };
        });

        onMount(() => {
          // Store renderer reference
          this.renderer = renderer;
          this.renderer.keyInput?.on?.("keypress", (key: any) => {
            if (!this.explainModalActive) {
              return;
            }

            if (key.name === "escape") {
              key.preventDefault?.();
              this.hideExplainReview();
              return;
            }

            if (key.name === "left" || key.name === "up") {
              key.preventDefault?.();
              this.previousExplainSection();
              return;
            }

            if (key.name === "right" || key.name === "down") {
              key.preventDefault?.();
              this.nextExplainSection();
              return;
            }
          });

          // Initialize theme from config
          const themeName = this.config.theme || "tokyonight";
          const theme = setTheme(themeName);
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
              <For each={outputContent()}>
                {(content) => renderStyledText(content)}
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
                  if (adapter.explainModalActive) {
                    if (e.name === "escape") {
                      e.preventDefault();
                      adapter.hideExplainReview();
                      return;
                    }
                    if (e.name === "left" || e.name === "up") {
                      e.preventDefault();
                      adapter.previousExplainSection();
                      return;
                    }
                    if (e.name === "right" || e.name === "down") {
                      e.preventDefault();
                      adapter.nextExplainSection();
                      return;
                    }
                    if (e.name === "return") {
                      e.preventDefault();
                      return;
                    }
                  }

                  if (e.name === "return" && !e.shift) {
                    e.preventDefault();
                    const message = textareaRef?.plainText || "";
                    if (message.trim()) {
                      if (adapter.pendingOAuthSetup) {
                        const code = message;
                        const verifier = adapter.pendingOAuthSetup.verifier;
                        adapter.pendingOAuthSetup = undefined;
                        adapter.clearInput();
                        const { handleOAuthCodeInput } = await import(
                          "../commands"
                        );
                        await handleOAuthCodeInput(
                          code,
                          verifier,
                          adapter,
                          adapter.config,
                        );
                      } else if (adapter.pendingMapleSetup) {
                        const apiKey = message;
                        const modelId = adapter.pendingMapleSetup.modelId;
                        adapter.pendingMapleSetup = undefined;
                        adapter.clearInput();
                        await handleMapleSetup(
                          apiKey,
                          modelId,
                          adapter,
                          adapter.config,
                        );
                      } else {
                        const parsed = parseCommand(message);
                        if (parsed.isCommand && parsed.command) {
                          adapter.clearInput();
                          await executeCommand(
                            parsed.command,
                            parsed.args,
                            adapter,
                            adapter.config,
                          );
                        } else {
                          await handleMessage(message, adapter, adapter.config);
                        }
                      }
                    }
                  } else if (e.name === "escape") {
                    if (adapter.isGenerating && adapter.abortController) {
                      adapter.abortController.abort();
                      adapter.appendOutput(
                        "\n\n⚠️  Generation cancelled by user\n",
                      );
                      adapter.setStatus("Cancelled");
                    }
                  }
                }}
              />
            </box>

            <Show when={explainVisible()}>
              <box
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "#0B1120",
                  flexDirection: "column",
                  padding: 1,
                  gap: 1,
                }}
              >
                <Show
                  when={explainData()}
                  fallback={
                    <box flexGrow={1} alignItems="center" justifyContent="center">
                      <text>No tutorial sections available.</text>
                    </box>
                  }
                >
                  {(accessor) => {
                    const data = accessor();
                    if (!data || !data.section) {
                      return (
                        <box flexGrow={1} alignItems="center" justifyContent="center">
                          <text>No tutorial sections available.</text>
                        </box>
                      );
                    }

                    const { result, section, diff, index } = data;
                    const total = result.sections.length;

                    return (
                      <>
                        <box style={{ justifyContent: "space-between" }}>
                          <text>
                            Explain • Section {index + 1}/{total}
                          </text>
                          <text style={{ fg: "#38bdf8" }}>
                            ←/→ navigate • Esc close
                          </text>
                        </box>
                        <box>
                          <text style={{ fg: "#38bdf8" }}>{section.title}</text>
                        </box>
                        <Show when={section.tags?.length}>
                          <text style={{ fg: "#94a3b8" }}>
                            tags: {section.tags?.join(", ")}
                          </text>
                        </Show>
                        <box style={{ flexDirection: "column", gap: 1, flexGrow: 1 }}>
                          <scrollbox style={{ height: 8, flexShrink: 0 }}>
                            <text>{section.explanation}</text>
                          </scrollbox>
                          <box>
                            <text style={{ fg: "#cbd5f5" }}>
                              Diff: {diff ? diff.filePath : "(not found)"}
                            </text>
                          </box>
                          <scrollbox style={{ flexGrow: 1 }}>
                            <For each={diff ? diff.lines : []}>
                              {(line) => {
                                const prefix =
                                  line.type === "add"
                                    ? "+"
                                    : line.type === "remove"
                                      ? "-"
                                      : " ";
                                const color =
                                  line.type === "add"
                                    ? "#22c55e"
                                    : line.type === "remove"
                                      ? "#f87171"
                                      : "#94a3b8";

                                const oldNumber =
                                  line.oldLineNumber ?? "";
                                const newNumber =
                                  line.newLineNumber ?? "";

                                return (
                                  <box style={{ flexDirection: "row", gap: 1 }}>
                                    <text style={{ fg: "#64748b", width: 5 }}>
                                      {String(oldNumber).padStart(3, " ")}
                                    </text>
                                    <text style={{ fg: "#64748b", width: 5 }}>
                                      {String(newNumber).padStart(3, " ")}
                                    </text>
                                    <text style={{ fg: color }}>{`${prefix}${line.content}`}</text>
                                  </box>
                                );
                              }}
                            </For>
                            <Show when={!diff || diff.lines.length === 0}>
                              <text>No diff lines for this section.</text>
                            </Show>
                          </scrollbox>
                        </box>
                      </>
                    );
                  }}
                </Show>
              </box>
            </Show>
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
    if (!this.setExplainVisible || !this.setExplainResult || !this.setExplainIndex) {
      this.appendOutput("Explain view is not available in this UI.\n");
      return;
    }

    this.setExplainResult(result);
    this.setExplainIndex(0);
    this.setExplainVisible(true);
    this.explainModalActive = true;
    this.setStatus(`Explain • ${result.sections.length} section(s)`);
  }

  private hideExplainReview(): void {
    if (this.setExplainVisible) {
      this.setExplainVisible(false);
    }
    if (this.setExplainResult) {
      this.setExplainResult(null);
    }
    this.explainModalActive = false;
    this.setStatus(`Ready`);
    if (this.inputEl?.focus) {
      this.inputEl.focus();
    }
  }

  private nextExplainSection(): void {
    if (!this.getExplainResult || !this.getExplainIndex || !this.setExplainIndex) {
      return;
    }
    const result = this.getExplainResult();
    if (!result) return;
    const current = this.getExplainIndex();
    const next = Math.min(result.sections.length - 1, current + 1);
    this.setExplainIndex(next);
  }

  private previousExplainSection(): void {
    if (!this.getExplainResult || !this.getExplainIndex || !this.setExplainIndex) {
      return;
    }
    const result = this.getExplainResult();
    if (!result) return;
    const current = this.getExplainIndex();
    const next = Math.max(0, current - 1);
    this.setExplainIndex(next);
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
