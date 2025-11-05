import { type KeyEvent, type StyledText, stringToStyledText } from "@opentui/core";
import { render, useRenderer } from "@opentui/solid";
import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
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
import { interpretExplainKey } from "../explain/keymap";

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
  private explainState: { result: ExplainResult | null; index: number } = {
    result: null,
    index: 0,
  };

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

        createEffect(() => {
          const index = explainIndex();
          logger.debug("explain-index-signal", { index });
        });

        createEffect(() => {
          const data = explainData();
          logger.debug("explain-render", {
            index: data?.index ?? null,
            title: data?.section?.title ?? null,
            diffPath: data?.diff?.filePath ?? null,
            snippet: data?.section?.explanation?.slice(0, 48) ?? null,
            visible: explainVisible(),
          });
        });

        onMount(() => {
          // Store renderer reference
          this.renderer = renderer;

          const handleExplainKeys = (key: KeyEvent) => {
            this.processExplainKeyEvent(key);
          };

          this.renderer.keyInput?.on?.("keypress", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrepeat", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrelease", handleExplainKeys);

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
                    e.preventDefault();
                    return;
                  }

                  const keyName = (e.name || e.key || e.code || "").toLowerCase();

                  if ((keyName === "return" || keyName === "enter") && !e.shift) {
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
                  } else if (keyName === "escape") {
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
                  keyed
                  fallback={
                    <box flexGrow={1} alignItems="center" justifyContent="center">
                      <text>No tutorial sections available.</text>
                    </box>
                  }
                >
                  {(data) => {
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
                      <box
                        style={{ flexDirection: "column", gap: 1, flexGrow: 1 }}
                        data-explain-section={section.id}
                      >
                        <box style={{ justifyContent: "space-between" }}>
                          <text>
                            Explain • Section {index + 1}/{total}
                          </text>
                          <text style={{ fg: "#38bdf8" }}>
                            Left/Right navigate • Esc close
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
                        <scrollbox style={{ height: 8, flexShrink: 0 }}>
                          <text>{section.explanation}</text>
                        </scrollbox>
                        <box>
                          <text style={{ fg: "#cbd5f5" }}>
                            Diff: {diff ? diff.filePath : "(not found)"}
                          </text>
                        </box>
                        <scrollbox
                          style={{ flexGrow: 1 }}
                          data-explain-diff={diff ? diff.id : "missing"}
                        >
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

                              const oldNumber = line.oldLineNumber ?? "";
                              const newNumber = line.newLineNumber ?? "";

                              return (
                                <box
                                  style={{ flexDirection: "row", gap: 1 }}
                                  data-explain-diff-line={`${section.id}-${line.oldLineNumber ?? "n"}-${line.newLineNumber ?? "n"}`}
                                >
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

    this.explainState.result = result;
    this.explainState.index = 0;
    this.setExplainResult(result);
    this.setExplainIndex(0);
    this.setExplainVisible(true);
    this.explainModalActive = true;
    if (this.inputEl?.blur) {
      this.inputEl.blur();
    }
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
    this.explainState.result = null;
    this.explainState.index = 0;
    this.setStatus(`Ready`);
    if (this.inputEl?.focus) {
      this.inputEl.focus();
    }
  }

  private updateExplainSection(delta: number): void {
    const setter = this.setExplainIndex;
    const activeResult = this.explainState.result ?? this.getExplainResult?.();

    if (!setter || !activeResult) {
      logger.debug("explain-index-missing", {
        hasSetter: Boolean(setter),
        hasResult: Boolean(activeResult),
        delta,
      });
      return;
    }

    const total = activeResult.sections.length;
    if (total === 0) {
      logger.debug("explain-index-empty");
      return;
    }

    setter((currentSignal: number | undefined) => {
      const current =
        typeof currentSignal === "number" ? currentSignal : this.explainState.index;
      const next = Math.max(0, Math.min(total - 1, current + delta));

      if (next === current) {
        logger.debug("explain-index-noop", { current, delta, total });
        this.explainState.index = current;
        return current;
      }

      this.explainState.index = next;
      this.renderer?.requestRender?.();
      this.renderer?.requestAnimationFrame?.(() => {});
      logger.debug("explain-index-update", { current, next, total, delta });
      return next;
    });
  }

  private nextExplainSection(): void {
    this.updateExplainSection(1);
  }

  private previousExplainSection(): void {
    this.updateExplainSection(-1);
  }

  private processExplainKeyEvent(key: Pick<KeyEvent, "name" | "key" | "code"> & {
    preventDefault?: () => void;
    raw?: string;
    sequence?: string;
  }): void {
    if (!this.explainModalActive) {
      return;
    }

    if (!key || typeof key !== "object") {
      return;
    }

    const action = interpretExplainKey({
      name: key?.name,
      key: key?.key,
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
