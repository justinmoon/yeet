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
import { startAnthropicOAuth } from "../auth";
import {
  handleMapleSetup,
  handleOAuthCodeInput,
} from "../commands";
import type { Config } from "../config";
import { saveConfig } from "../config";
import type { ExplainResult } from "../explain";
import { interpretExplainKey } from "../explain/keymap";
import { logger } from "../logger";
import { startOpenAIOAuth } from "../openai-auth";
import type { CallbackServer } from "../openai-callback-server";
import { startCallbackServer } from "../openai-callback-server";
import { MODELS, getModelInfo } from "../models/registry";
import { listSessions, loadSession, type Session } from "../sessions";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import { cycleTheme, getCurrentTheme, setTheme, themes } from "./colors";
import type { MessagePart, UIAdapter } from "./interface";
import { createSyntaxStyle } from "./syntax-theme";

type CommandPaletteMode =
  | "actions"
  | "sessions"
  | "models"
  | "themes"
  | "help"
  | "auth"
  | "explain";

interface CommandPaletteEntry {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  detailLines?: string[];
  run?: () => Promise<void> | void;
}

type AuthProvider = "anthropic" | "openai";

interface AuthFlowState {
  stage: "idle" | "starting" | "waiting" | "success" | "error" | "cancelled";
  message?: string;
  url?: string;
}

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
  pendingOAuthSetup?: {
    verifier: string;
    provider?: "anthropic" | "openai";
    state?: string;
  };
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

  private setCommandPaletteOpen?: (value: boolean) => void;
  private setCommandPaletteQuery?: (value: string) => void;
  private setCommandPaletteIndex?: (value: number) => void;
  private setCommandPaletteEntries?: (
    entries: CommandPaletteEntry[],
  ) => void;
  private setCommandPaletteMode?: (mode: CommandPaletteMode) => void;
  private setCommandPaletteTitle?: (title: string) => void;
  private getCommandPaletteOpen?: () => boolean;
  private getCommandPaletteQuery?: () => string;
  private getCommandPaletteIndex?: () => number;
  private getCommandPaletteEntries?: () => CommandPaletteEntry[];
  private getCommandPaletteMode?: () => CommandPaletteMode;
  private getCommandPaletteTitle?: () => string;
  private authFlowState: Record<AuthProvider, AuthFlowState> = {
    anthropic: { stage: "idle" },
    openai: { stage: "idle" },
  };
  private authPaletteProvider?: AuthProvider;
  private openAICallbackServer: CallbackServer | null = null;

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
        : this.config.activeProvider === "openai"
          ? this.config.openai?.model || ""
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
        const [inputHeight, setInputHeight] = createSignal(1);
        const [explainVisible, setExplainVisible] = createSignal(false);
        const [explainResult, setExplainResult] = createSignal<
          ExplainResult | null
        >(null);
        const [explainIndex, setExplainIndex] = createSignal(0);
        const [commandPaletteOpen, setCommandPaletteOpen] =
          createSignal(false);
        const [commandPaletteQuery, setCommandPaletteQuery] =
          createSignal("");
        const [commandPaletteIndex, setCommandPaletteIndex] =
          createSignal(0);
        const [commandPaletteEntries, setCommandPaletteEntries] = createSignal<
          CommandPaletteEntry[]
        >([]);
        const [commandPaletteMode, setCommandPaletteMode] =
          createSignal<CommandPaletteMode>("actions");
        const [commandPaletteTitle, setCommandPaletteTitle] = createSignal(
          "Command Palette · ⏎ to run · Esc to close",
        );
        let textareaRef: any = null;
        const scrollBoxRef: any = null;
        let paletteInputRef: any = null;
        let paletteScrollRef: any = null;
        const filteredPaletteEntries = createMemo(() => {
          const query = commandPaletteQuery().trim().toLowerCase();
          const entries = commandPaletteEntries();
          if (!query) {
            return entries;
          }
          return entries.filter((entry) => {
            const haystack = `${entry.label} ${entry.description} ${(entry.keywords || []).join(" ")} ${(entry.detailLines || []).join(" ")}`.toLowerCase();
            return haystack.includes(query);
          });
        });

        // Initialize theme and syntax style for markdown rendering
        const themeName = this.config.theme || "tokyonight";
        const theme = setTheme(themeName);
        const syntaxStyle = createSyntaxStyle(theme);

        const updateInputHeight = (overrideText?: string) => {
          const rendererInstance: any = this.renderer || renderer;
          const availableWidth = Math.max(
            1,
            (rendererInstance?.width ?? 80) - 4,
          );
          const terminalHeight = rendererInstance?.height ?? 24;
          // Grow up to roughly 40% of the viewport so long prompts stay visible
          const maxVisibleRows = Math.max(2, Math.floor(terminalHeight * 0.4));
          const text =
            overrideText ??
            textareaRef?.plainText ??
            this.inputText ??
            this.getInputValue?.() ??
            "";

          let lineCount = 1;
          if (text.length > 0) {
            const lines = text.split("\n");
            lineCount = lines.reduce((total, line) => {
              if (line.length === 0) {
                return total + 1;
              }
              const wraps = Math.ceil(line.length / availableWidth);
              return total + Math.max(wraps, 1);
            }, 0);
          }

          const desiredHeight = Math.min(
            Math.max(lineCount, 1),
            maxVisibleRows,
          );
          if (inputHeight() !== desiredHeight) {
            setInputHeight(desiredHeight);
          }
        };

        // Store signal setters for use by adapter methods
        this.setStatusText = setStatusText;
        this.setOutputContent = setOutputContent;
        this.setMessageParts = setMessageParts;
        this.setInputValue = setInputValue;
        this.setInputPlaceholder = setInputPlaceholder;
        this.setImageCount = setImageCount;
        this.setExplainVisible = setExplainVisible;
        this.setExplainResult = setExplainResult;
        this.setExplainIndex = setExplainIndex;
        this.setCommandPaletteOpen = setCommandPaletteOpen;
        this.setCommandPaletteQuery = setCommandPaletteQuery;
        this.setCommandPaletteIndex = setCommandPaletteIndex;
        this.setCommandPaletteEntries = setCommandPaletteEntries;
        this.setCommandPaletteMode = setCommandPaletteMode;
        this.setCommandPaletteTitle = setCommandPaletteTitle;

        this.getStatusText = statusText;
        this.getOutputContent = outputContent;
        this.getMessageParts = messageParts;
        this.getInputValue = inputValue;
        this.getInputPlaceholder = inputPlaceholder;
        this.getImageCount = imageCount;
        this.getExplainVisible = explainVisible;
        this.getExplainResult = explainResult;
        this.getExplainIndex = explainIndex;
        this.getCommandPaletteOpen = commandPaletteOpen;
        this.getCommandPaletteQuery = commandPaletteQuery;
        this.getCommandPaletteIndex = commandPaletteIndex;
        this.getCommandPaletteEntries = commandPaletteEntries;
        this.getCommandPaletteMode = commandPaletteMode;
        this.getCommandPaletteTitle = commandPaletteTitle;

        const initialEntries = this.buildRootPaletteEntries();
        setCommandPaletteEntries(initialEntries);
        setCommandPaletteIndex(
          this.getFirstSelectableIndex(initialEntries),
        );

        onMount(() => {
          // Store renderer reference
          this.renderer = renderer;

          const handleExplainKeys = (key: KeyEvent) => {
            this.processExplainKeyEvent(key);
          };

          this.renderer.keyInput?.on?.("keypress", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrepeat", handleExplainKeys);
          this.renderer.keyInput?.on?.("keyrelease", handleExplainKeys);
          const handlePaletteKeys = (key: KeyEvent) => {
            if (this.shouldOpenCommandPalette(key)) {
              key.preventDefault?.();
              this.showCommandPalette();
              return;
            }

            if (
              commandPaletteOpen() &&
              key.name === "escape" &&
              !this.explainModalActive
            ) {
              key.preventDefault?.();
              this.hideCommandPalette();
            }
          };

          this.renderer.keyInput?.on?.("keypress", handlePaletteKeys);

          // Set background color
          renderer.setBackgroundColor(theme.background);

          if (textareaRef) {
            textareaRef.focus();
          }
          updateInputHeight(this.inputText);
          // Show welcome message
          if (this.contentChunks.length === 0) {
            this.contentChunks.push(
              "Welcome to Yeet. Type your message and press Enter to send (Shift+Enter for newlines).\n",
            );
            setOutputContent([...this.contentChunks]);
          }
        });

        createEffect(() => {
          const value = inputValue();
          updateInputHeight(value);
        });

        createEffect(() => {
          commandPaletteQuery();
          setCommandPaletteIndex(
            this.getFirstSelectableIndex(filteredPaletteEntries()),
          );
        });

        createEffect(() => {
          if (commandPaletteOpen()) {
            setTimeout(() => {
              if (paletteInputRef) {
                paletteInputRef.editBuffer?.setText("", { history: false });
                paletteInputRef.focus?.();
              }
            }, 0);
          } else if (textareaRef) {
            setTimeout(() => {
              textareaRef.focus?.();
            }, 0);
          }
        });

        createEffect(() => {
          const mode = commandPaletteMode();
          if (mode === "explain" && paletteInputRef) {
            setTimeout(() => {
              paletteInputRef.editBuffer?.setText("", { history: false });
              paletteInputRef.focus?.();
            }, 0);
          }
        });

        const scrollPaletteToIndex = (index: number) => {
          if (!paletteScrollRef) return;
          const viewportHeight = paletteScrollRef.viewport?.height || 1;
          const itemHeight = 3;
          const target = index * itemHeight;
          const currentScroll = paletteScrollRef.scrollTop || 0;
          if (target < currentScroll) {
            paletteScrollRef.scrollTop = target;
          } else if (target > currentScroll + viewportHeight - itemHeight) {
            paletteScrollRef.scrollTop = Math.max(
              0,
              target - viewportHeight + itemHeight,
            );
          }
        };

        createEffect(() => {
          scrollPaletteToIndex(commandPaletteIndex());
        });

        // Helper to render styled text content
        const renderStyledText = (content: string | StyledText) => {
          if (typeof content === "string") {
            return <text>{content}</text>;
          }
          // StyledText should be rendered directly without conversion
          return <text>{content as any}</text>;
        };

        const runPaletteEntry = async (
          entry?: CommandPaletteEntry,
        ): Promise<void> => {
          await this.handlePaletteEntry(entry);
        };

        return (
          <box
            style={{ flexDirection: "column", flexGrow: 1, position: "relative" }}
          >
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
              {/* Legacy text chunks (for backwards compatibility) */}
              <For each={outputContent()}>
                {(content) => renderStyledText(content)}
              </For>

              {/* New message parts with markdown rendering */}
              <For each={messageParts()}>
                {(part) => {
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
              style={{
                backgroundColor: "#DCDCDC",
                height: inputHeight(),
                flexShrink: 0,
              }}
            >
              <textarea
                ref={(el: any) => {
                  textareaRef = el;
                  this.inputEl = el;
                  updateInputHeight(
                    textareaRef?.plainText ?? this.inputText ?? "",
                  );
                }}
                placeholder={inputPlaceholder()}
                textColor="#000000"
                focusedTextColor="#000000"
                placeholderColor="#666666"
                cursorColor="#000000"
                wrapMode="word"
                showCursor={true}
                style={{ height: inputHeight(), flexGrow: 1 }}
                onContentChange={() => {
                  if (textareaRef) {
                    const text = textareaRef.plainText;
                    this.inputText = text;
                    setInputValue(text);
                    updateInputHeight(text);
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
                        const provider = (this.pendingOAuthSetup.provider ||
                          "anthropic") as AuthProvider;
                        const state = this.pendingOAuthSetup.state;
                        this.pendingOAuthSetup = undefined;
                        this.clearInput();
                        await this.completeOAuthCodeEntry(
                          code,
                          provider,
                          verifier,
                          state,
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
                        await handleMessage(message, this, this.config);
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

            <Show when={commandPaletteOpen()}>
              <box
                style={{
                  position: "absolute",
                  top: 3,
                  left: 6,
                  right: 6,
                  backgroundColor: "#171722",
                  flexDirection: "column",
                  padding: 1,
                  zIndex: 100,
                }}
              >
                <box marginBottom={1}>
                  <text style={{ fg: "#7aa2f7" }}>
                    {commandPaletteTitle()}
                  </text>
                </box>
                <box marginBottom={1}>
                  <textarea
                    ref={(el: any) => {
                      paletteInputRef = el;
                    }}
                    placeholder={
                      commandPaletteMode() === "actions"
                        ? "Search commands..."
                        : "Filter results..."
                    }
                    textColor="#FFFFFF"
                    focusedTextColor="#FFFFFF"
                    placeholderColor="#7f7f91"
                    cursorColor="#FFFFFF"
                    wrapMode="off"
                    showCursor={true}
                    style={{ height: 1 }}
                    onContentChange={() => {
                      const text = paletteInputRef?.plainText || "";
                      setCommandPaletteQuery(text);
                    }}
                    onKeyDown={async (e: any) => {
                      if (e.name === "escape") {
                        e.preventDefault();
                        this.hideCommandPalette();
                        return;
                      }
                      if (
                        e.name === "backspace" &&
                        !paletteInputRef?.plainText &&
                        commandPaletteMode() !== "actions"
                      ) {
                        e.preventDefault();
                        this.showActionPalette();
                        return;
                      }
                      if (e.name === "down") {
                        e.preventDefault();
                        const entries = filteredPaletteEntries();
                        if (entries.length === 0) return;
                        const next = this.findNextSelectableIndex(
                          entries,
                          commandPaletteIndex(),
                          1,
                        );
                        setCommandPaletteIndex(next);
                        return;
                      }
                      if (e.name === "up") {
                        e.preventDefault();
                        const entries = filteredPaletteEntries();
                        if (entries.length === 0) return;
                        const next = this.findNextSelectableIndex(
                          entries,
                          commandPaletteIndex(),
                          -1,
                        );
                        setCommandPaletteIndex(next);
                        return;
                      }
                      if (e.name === "return") {
                        e.preventDefault();
                        // Special handling for explain mode
                        if (commandPaletteMode() === "explain") {
                          const prompt = paletteInputRef?.plainText || "";
                          if (prompt.trim()) {
                            await this.runExplain(prompt);
                          }
                          return;
                        }
                        const selected =
                          filteredPaletteEntries()[commandPaletteIndex()];
                        await runPaletteEntry(selected);
                      }
                    }}
                  />
                </box>
                <Show
                  when={filteredPaletteEntries().length > 0}
                  fallback={
                    <box>
                      <text style={{ fg: "#7f7f91" }}>
                        No results match "{commandPaletteQuery()}"
                      </text>
                    </box>
                  }
                >
                  <scrollbox
                    ref={(el: any) => {
                      paletteScrollRef = el;
                    }}
                    style={{
                      maxHeight: 15,
                      paddingTop: 1,
                    }}
                  >
                    <For each={filteredPaletteEntries()}>
                      {(action, index) => {
                        const selected = () =>
                          index() === commandPaletteIndex();
                        return (
                          <box
                            style={{
                              paddingLeft: 1,
                              paddingRight: 1,
                              paddingTop: 0,
                              paddingBottom: 0,
                              marginBottom: 1,
                              backgroundColor: selected()
                                ? "#2b2f44"
                                : "#171722",
                              flexDirection: "column",
                            }}
                          >
                            <text
                              style={{
                                fg: selected() ? "#ffffff" : "#c0caf5",
                              }}
                            >
                              {action.label}
                            </text>
                            <text style={{ fg: "#7aa2f7" }}>
                              {action.description}
                            </text>
                            <For each={action.detailLines || []}>
                              {(line) => (
                                <text style={{ fg: "#7f7f91" }}>{line}</text>
                              )}
                            </For>
                          </box>
                        );
                      }}
                    </For>
                  </scrollbox>
                </Show>
              </box>
            </Show>

            <Show when={explainVisible()}>
              <box
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "#171722",
                  flexDirection: "column",
                  zIndex: 200,
                }}
              >
                {/* Header */}
                <box style={{ backgroundColor: "#DCDCDC", height: 1 }}>
                  <text style={{ fg: "#000000" }}>
                    Tutorial Review · ←/→ Navigate · q/Esc to close
                  </text>
                </box>

                {/* Content */}
                <Show when={explainResult()}>
                  {(result) => {
                    const currentSection = () => {
                      const idx = explainIndex();
                      return result().sections[idx];
                    };
                    const currentDiff = () => {
                      const section = currentSection();
                      return result().diffs.find(
                        (d) => d.id === section?.diffId,
                      );
                    };

                    return (
                      <scrollbox
                        style={{
                          flexGrow: 1,
                          padding: 2,
                        }}
                      >
                        <box style={{ flexDirection: "column" }}>
                          {/* Section info */}
                          <box marginBottom={1}>
                            <text style={{ fg: "#7aa2f7", bold: true }}>
                              Section {explainIndex() + 1} of{" "}
                              {result().sections.length}
                            </text>
                          </box>

                          {/* Title */}
                          <box marginBottom={1}>
                            <text style={{ fg: "#FFFFFF", bold: true }}>
                              {currentSection()?.title}
                            </text>
                          </box>

                          {/* Tags */}
                          <Show when={currentSection()?.tags?.length}>
                            <box marginBottom={1}>
                              <text style={{ fg: "#7f7f91" }}>
                                Tags: {currentSection()?.tags?.join(", ")}
                              </text>
                            </box>
                          </Show>

                          {/* Explanation */}
                          <box marginBottom={2}>
                            <text style={{ fg: "#FFFFFF" }}>
                              {currentSection()?.explanation}
                            </text>
                          </box>

                          {/* Diff */}
                          <Show when={currentDiff()}>
                            <box marginBottom={1}>
                              <text style={{ fg: "#7aa2f7", bold: true }}>
                                Diff: {currentDiff()?.filePath}
                              </text>
                            </box>
                            <box style={{ flexDirection: "column" }}>
                              <For each={currentDiff()?.lines || []}>
                                {(line) => {
                                  const color =
                                    line.type === "add"
                                      ? "#73daca"
                                      : line.type === "remove"
                                        ? "#f7768e"
                                        : "#7f7f91";
                                  const prefix =
                                    line.type === "add"
                                      ? "+"
                                      : line.type === "remove"
                                        ? "-"
                                        : " ";
                                  return (
                                    <box>
                                      <text style={{ fg: color }}>
                                        {prefix}
                                        {line.content}
                                      </text>
                                    </box>
                                  );
                                }}
                              </For>
                            </box>
                          </Show>
                        </box>
                      </scrollbox>
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

  private openExplainPrompt(): void {
    this.setCommandPaletteMode?.("explain");
    this.setCommandPaletteTitle?.("Explain Changes · Enter your prompt · Esc to cancel");
    this.setCommandPaletteQuery?.("");
    this.applyPaletteEntries([
      this.createInfoEntry(
        "explain-info",
        "What would you like to understand?",
        "Type a prompt like 'explain what changed' or 'show me the diff against master'",
      ),
    ]);
  }

  private async runExplain(prompt: string): Promise<void> {
    this.hideCommandPalette();

    try {
      const { explain } = await import("../explain");
      const { inferGitParams } = await import("../explain/infer-params");

      // Infer git parameters from prompt
      const params = await inferGitParams({
        prompt,
        cwd: undefined,
        base: undefined,
        head: undefined,
      });

      // Run explain
      const result = await explain({
        prompt,
        cwd: params.cwd,
        base: params.base,
        head: params.head,
      });

      // Show result in modal
      this.showExplainReview(result);
    } catch (error: any) {
      this.appendOutput(`\n\n⚠️ Explain failed: ${error.message}\n`);
    }
  }

  private buildRootPaletteEntries(): CommandPaletteEntry[] {
    return [
      {
        id: "explain-changes",
        label: "Explain Changes",
        description: "Generate tutorial from git diff",
        keywords: ["explain", "diff", "tutorial", "changes", "git"],
        run: () => this.openExplainPrompt(),
      },
      {
        id: "resume-session",
        label: "Resume Session",
        description: "Browse and load saved chat sessions",
        keywords: ["session", "resume", "history", "load"],
        run: () => this.openSessionsPalette(),
      },
      {
        id: "switch-model",
        label: "Switch Model",
        description: "Choose a different provider/model pair",
        keywords: [
          "model",
          "switch",
          "provider",
          "anthropic",
          "openai",
          "gpt",
          "codex",
          "maple",
          "opencode",
        ],
        run: () => this.openModelPalette(),
      },
      {
        id: "choose-theme",
        label: "Choose Theme",
        description: "Select one of the available color palettes",
        keywords: ["theme", "color", "appearance"],
        run: () => this.openThemePalette(),
      },
      {
        id: "link-anthropic",
        label: "Link Anthropic Account",
        description: this.describeAuthFlow("anthropic"),
        keywords: ["auth", "anthropic", "login", "oauth"],
        run: () => this.openOAuthPalette("anthropic", { autoStart: true }),
      },
      {
        id: "link-openai",
        label: "Link OpenAI Account",
        description: this.describeAuthFlow("openai"),
        keywords: ["auth", "openai", "chatgpt", "login"],
        run: () => this.openOAuthPalette("openai", { autoStart: true }),
      },
      {
        id: "show-help",
        label: "Help & Shortcuts",
        description: "Reference for palette actions and hotkeys",
        keywords: ["help", "palette", "docs"],
        run: () => this.openHelpPalette(),
      },
    ];
  }

  private shouldOpenCommandPalette(key: KeyEvent): boolean {
    if (!key || this.getCommandPaletteOpen?.() || this.explainModalActive) {
      return false;
    }
    const name =
      typeof key.name === "string" ? key.name.toLowerCase() : undefined;
    const meta = (key as any).meta || (key as any).cmd;
    const ctrlShiftP = name === "p" && key.ctrl && key.shift;
    const ctrlO = name === "o" && key.ctrl;
    const metaO = name === "o" && meta;
    return ctrlShiftP || ctrlO || metaO;
  }

  private showCommandPalette(): void {
    this.showActionPalette();
    this.setCommandPaletteOpen?.(true);
  }

  private hideCommandPalette(): void {
    if (!this.getCommandPaletteOpen?.()) {
      return;
    }
    this.setCommandPaletteOpen?.(false);
    this.showActionPalette();
  }

  private showActionPalette(): void {
    this.authPaletteProvider = undefined;
    this.setCommandPaletteMode?.("actions");
    this.setCommandPaletteTitle?.("Command Palette · ⏎ to run · Esc to close");
    this.setCommandPaletteQuery?.("");
    this.applyPaletteEntries(this.buildRootPaletteEntries());
  }

  private createBackEntry(
    label = "← Back to commands",
    handler?: () => void,
  ): CommandPaletteEntry {
    return {
      id: `back-${label}`,
      label,
      description: "Return to the previous view",
      keywords: ["back", "return", "commands"],
      run: () => {
        if (handler) {
          handler();
          return;
        }
        this.showActionPalette();
      },
    };
  }

  private createInfoEntry(
    id: string,
    label: string,
    description = "",
  ): CommandPaletteEntry {
    return {
      id,
      label,
      description,
      keywords: [],
    };
  }

  private isPaletteEntrySelectable(entry?: CommandPaletteEntry): boolean {
    return Boolean(entry?.run);
  }

  private getFirstSelectableIndex(entries: CommandPaletteEntry[]): number {
    const idx = entries.findIndex((entry) =>
      this.isPaletteEntrySelectable(entry),
    );
    return idx === -1 ? 0 : idx;
  }

  private findNextSelectableIndex(
    entries: CommandPaletteEntry[],
    startIndex: number,
    direction: 1 | -1,
  ): number {
    let idx = startIndex;
    while (true) {
      idx += direction;
      if (idx < 0 || idx >= entries.length) {
        return startIndex;
      }
      if (this.isPaletteEntrySelectable(entries[idx])) {
        return idx;
      }
    }
  }

  private applyPaletteEntries(entries: CommandPaletteEntry[]): void {
    this.setCommandPaletteEntries?.(entries);
    this.setCommandPaletteIndex?.(this.getFirstSelectableIndex(entries));
  }

  private openOAuthPalette(
    provider: AuthProvider,
    options?: { autoStart?: boolean },
  ): void {
    this.authPaletteProvider = provider;
    const title =
      provider === "anthropic"
        ? "Link Anthropic Account"
        : "Link OpenAI Account";
    this.setCommandPaletteMode?.("auth");
    this.setCommandPaletteTitle?.(`${title} · Esc to close`);
    this.setCommandPaletteQuery?.("");
    const entries = this.buildOAuthEntries(provider);
    this.applyPaletteEntries(entries);

    const flow = this.authFlowState[provider];
    if (
      options?.autoStart &&
      (flow.stage === "idle" ||
        flow.stage === "cancelled" ||
        flow.stage === "error")
    ) {
      void this.launchOAuthFlow(provider);
    }
  }

  private buildOAuthEntries(provider: AuthProvider): CommandPaletteEntry[] {
    const flow = this.authFlowState[provider];
    const providerLabel = provider === "anthropic" ? "Anthropic" : "OpenAI";
    const entries: CommandPaletteEntry[] = [
      this.createBackEntry("← Back to commands", () => {
        this.authPaletteProvider = undefined;
        this.showActionPalette();
      }),
    ];

    switch (flow.stage) {
      case "idle":
      case "error":
      case "cancelled":
        entries.push({
          id: `auth-${provider}-start`,
          label: "Open login in browser",
          description:
            flow.stage === "error"
              ? "Retry the OAuth flow"
              : `Launch ${providerLabel} authentication`,
          detailLines: [
            flow.message ||
              (provider === "anthropic"
                ? "Connect your Claude Pro/Max account."
                : "Connect your ChatGPT Pro / Codex account."),
          ],
          run: () => this.launchOAuthFlow(provider),
        });
        break;
      case "starting":
        entries.push({
          id: `auth-${provider}-cancel`,
          label: "Cancel login",
          description: "Stop the OAuth flow",
          detailLines: [flow.message || "Launching browser…"],
          run: () => this.cancelAuthFlow(provider),
        });
        break;
      case "waiting":
        entries.push({
          id: `auth-${provider}-cancel`,
          label: "Cancel login",
          description: "Abort the current OAuth attempt",
          detailLines: [
            flow.message ||
              "Waiting for authorization. Paste the code when ready.",
            ...(flow.url ? [flow.url] : []),
          ],
          run: () => this.cancelAuthFlow(provider),
        });
        break;
      case "success":
        entries.push(
          this.createInfoEntry(
            `auth-${provider}-done`,
            "✅ Account linked",
            `${providerLabel} is ready to use.`,
          ),
        );
        break;
    }

    return entries;
  }

  private async launchOAuthFlow(provider: AuthProvider): Promise<void> {
    if (provider === "anthropic") {
      await this.launchAnthropicOAuth();
    } else {
      await this.launchOpenAIOAuth();
    }
  }

  private async launchAnthropicOAuth(): Promise<void> {
    const flow = this.authFlowState.anthropic;
    if (flow.stage === "starting" || flow.stage === "waiting") {
      return;
    }

    this.updateAuthFlow("anthropic", {
      stage: "starting",
      message: "Launching Anthropic login…",
      url: undefined,
    });

    try {
      const { url, verifier } = await startAnthropicOAuth();
      this.pendingOAuthSetup = { verifier, provider: "anthropic" };
      this.updateAuthFlow("anthropic", {
        stage: "waiting",
        message: "Browser opened. Paste the authorization code back here.",
        url,
      });
      await this.openLoginUrl("anthropic", url);
    } catch (error: any) {
      this.updateAuthFlow("anthropic", {
        stage: "error",
        message: error?.message || "Failed to start Anthropic login.",
      });
    }
  }

  private async launchOpenAIOAuth(): Promise<void> {
    const flow = this.authFlowState.openai;
    if (flow.stage === "starting" || flow.stage === "waiting") {
      return;
    }

    this.updateAuthFlow("openai", {
      stage: "starting",
      message: "Starting OpenAI login…",
      url: undefined,
    });

    try {
      this.cleanupOpenAICallbackServer();
      const callbackServer = await startCallbackServer();
      this.openAICallbackServer = callbackServer;
      const { url, verifier, state } = await startOpenAIOAuth();

      this.pendingOAuthSetup = { verifier, provider: "openai", state };
      this.updateAuthFlow("openai", {
        stage: "waiting",
        message:
          "Waiting for the browser redirect. You can also paste the code manually.",
        url,
      });
      await this.openLoginUrl("openai", url);
      void this.waitForOpenAICallback(callbackServer, state, verifier);
    } catch (error: any) {
      this.updateAuthFlow("openai", {
        stage: "error",
        message: error?.message || "Failed to start OpenAI login.",
      });
      this.cleanupOpenAICallbackServer();
    }
  }

  private async completeOAuthCodeEntry(
    code: string,
    provider: AuthProvider,
    verifier: string,
    expectedState?: string,
  ): Promise<void> {
    try {
      const result = await handleOAuthCodeInput(
        code,
        verifier,
        this,
        this.config,
        provider,
        expectedState,
        {
          suppressOutput: true,
          onStatus: (message) => this.updateAuthFlow(provider, { message }),
        },
      );

      if (provider === "openai") {
        this.cleanupOpenAICallbackServer();
      }

      if (result.status === "success") {
        this.updateAuthFlow(provider, {
          stage: "success",
          message:
            provider === "anthropic"
              ? "Anthropic account linked successfully!"
              : "OpenAI account linked successfully!",
          url: undefined,
        });
      } else {
        this.updateAuthFlow(provider, {
          stage: "error",
          message: "OAuth code was rejected. Please try again.",
        });
      }
    } catch (error: any) {
      this.updateAuthFlow(provider, {
        stage: "error",
        message: error?.message || "OAuth exchange failed.",
      });
    }
  }

  private async waitForOpenAICallback(
    server: CallbackServer,
    state: string,
    verifier: string,
  ): Promise<void> {
    try {
      const result = await server.waitForCallback(state);
      if (!result) {
        throw new Error("Authorization timed out.");
      }
      this.pendingOAuthSetup = undefined;
      const res = await handleOAuthCodeInput(
        `${result.code}#${result.state}`,
        verifier,
        this,
        this.config,
        "openai",
        state,
        {
          suppressOutput: true,
          onStatus: (message) => this.updateAuthFlow("openai", { message }),
        },
      );
      if (res.status === "success") {
        this.updateAuthFlow("openai", {
          stage: "success",
          message: "OpenAI account linked successfully!",
          url: undefined,
        });
      } else {
        this.updateAuthFlow("openai", {
          stage: "error",
          message: "Failed to link OpenAI account. Please try again.",
        });
      }
    } catch (error: any) {
      if (this.authFlowState.openai.stage !== "cancelled") {
        this.updateAuthFlow("openai", {
          stage: "error",
          message: error?.message || "OpenAI login failed.",
        });
      }
    } finally {
      server.close();
      if (this.openAICallbackServer === server) {
        this.openAICallbackServer = null;
      }
    }
  }

  private cancelAuthFlow(provider: AuthProvider): void {
    if (provider === "openai") {
      this.cleanupOpenAICallbackServer();
    }
    if (this.pendingOAuthSetup?.provider === provider) {
      this.pendingOAuthSetup = undefined;
    }
    this.updateAuthFlow(provider, {
      stage: "cancelled",
      message: "Login cancelled.",
      url: undefined,
    });
  }

  private updateAuthFlow(
    provider: AuthProvider,
    updates: Partial<AuthFlowState>,
  ): void {
    this.authFlowState[provider] = {
      ...this.authFlowState[provider],
      ...updates,
    };
    if (this.authPaletteProvider === provider) {
      this.applyPaletteEntries(this.buildOAuthEntries(provider));
    }
    this.refreshActionPaletteEntries();
  }

  private refreshActionPaletteEntries(): void {
    if (this.getCommandPaletteMode?.() === "actions") {
      this.applyPaletteEntries(this.buildRootPaletteEntries());
    }
  }

  private async openLoginUrl(
    provider: AuthProvider,
    url: string,
  ): Promise<void> {
    try {
      const platform = process.platform;
      const command =
        platform === "darwin"
          ? "open"
          : platform === "win32"
            ? "start"
            : "xdg-open";
      await Bun.spawn([command, url], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
    } catch (error: any) {
      logger.warn("Failed to open browser automatically", {
        provider,
        error: error?.message,
      });
      this.updateAuthFlow(provider, {
        message: `Unable to open browser automatically. Open this link manually:\n${url}`,
        url,
      });
    }
  }

  private describeAuthFlow(provider: AuthProvider): string {
    const flow = this.authFlowState[provider];
    switch (flow.stage) {
      case "starting":
        return "Launching OAuth flow…";
      case "waiting":
        return "Waiting for authorization…";
      case "success":
        return "Linked ✓";
      case "error":
        return flow.message ? `Error: ${flow.message}` : "Login failed.";
      case "cancelled":
        return "Login cancelled.";
      default:
        return provider === "anthropic"
          ? "Link your Claude Pro/Max account"
          : "Link your ChatGPT Pro / Codex account";
    }
  }

  private cleanupOpenAICallbackServer(): void {
    if (this.openAICallbackServer) {
      this.openAICallbackServer.close();
      this.openAICallbackServer = null;
    }
  }

  private async handlePaletteEntry(
    entry?: CommandPaletteEntry,
  ): Promise<void> {
    if (!entry?.run) {
      return;
    }
    await entry.run();
  }

  private openSessionsPalette(): void {
    this.setCommandPaletteMode?.("sessions");
    this.setCommandPaletteTitle?.("Resume Session · ⏎ to load · Esc to close");
    this.setCommandPaletteQuery?.("");
    this.applyPaletteEntries([
      this.createBackEntry(),
      this.createInfoEntry("sessions-loading", "Loading sessions..."),
    ]);
    setTimeout(() => this.populateSessionPaletteEntries(), 0);
  }

  private populateSessionPaletteEntries(): void {
    try {
      const sessions = listSessions();
      if (sessions.length === 0) {
        this.applyPaletteEntries([
          this.createBackEntry(),
          this.createInfoEntry(
            "sessions-empty",
            "No saved sessions found",
            "Start chatting to create a session.",
          ),
        ]);
        return;
      }

      const limited = sessions.slice(0, 50);
      const entries: CommandPaletteEntry[] = [
        this.createBackEntry(),
        ...limited.map((session) => {
          const preview = this.getSessionPreview(session.id);
          return {
            id: session.id,
            label: session.name
              ? `${session.name} · ${session.id}`
              : session.id,
            description: `${session.model} • ${session.totalMessages} messages • ${this.getTimeAgo(new Date(session.updated))}`,
            detailLines: preview ? [preview] : undefined,
            keywords: [
              session.id,
              session.name ?? "",
              session.model,
              preview,
            ],
            run: () => this.loadSessionFromPalette(session.id),
          };
        }),
      ];

      this.applyPaletteEntries(entries);
    } catch (error: any) {
      this.applyPaletteEntries([
        this.createBackEntry(),
        this.createInfoEntry(
          "sessions-error",
          "Failed to load sessions",
          error?.message || "Unknown error",
        ),
      ]);
    }
  }

  private getSessionPreview(sessionId: string): string {
    const session = loadSession(sessionId);
    if (!session) {
      return "";
    }
    const firstUser = session.conversationHistory.find(
      (message) => message.role === "user",
    );
    if (!firstUser) {
      return "";
    }
    const text = this.extractTextContent(firstUser.content);
    if (!text) {
      return "";
    }
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }

  private async loadSessionFromPalette(sessionId: string): Promise<void> {
    try {
      const session = loadSession(sessionId);
      if (!session) {
        this.applyPaletteEntries([
          this.createBackEntry(),
          this.createInfoEntry(
            "session-missing",
            "Session not found",
            "It may have been removed.",
          ),
        ]);
        return;
      }
      this.hideCommandPalette();
      this.applySessionToUI(session);
    } catch (error: any) {
      this.applyPaletteEntries([
        this.createBackEntry(),
        this.createInfoEntry(
          "session-error",
          "Failed to load session",
          error?.message || "Unknown error",
        ),
      ]);
    }
  }

  private applySessionToUI(session: Session): void {
    this.currentSessionId = session.id;
    this.conversationHistory = session.conversationHistory;
    this.currentTokens = session.currentTokens;

    this.clearOutput();

    for (let i = 0; i < session.conversationHistory.length; i++) {
      const message = session.conversationHistory[i];
      if (message.role === "user") {
        const formatted = this.formatUserMessage(message.content);
        this.appendOutput(`[you] ${formatted}\n`);
      } else {
        const formatted = this.formatAssistantMessage(message.content);
        this.appendOutput(`[yeet] ${formatted}\n`);
      }

      if (i < session.conversationHistory.length - 1) {
        this.appendOutput("\n");
      }
    }

    this.updateTokenCount();
  }

  private extractTextContent(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content as any[];
      return parts
        .filter((part: any) => part.type === "text")
        .map((part: any) => part.text || "")
        .join("");
    }
    return "";
  }

  private formatUserMessage(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const text = this.extractTextContent(content);
      const parts = content as any[];
      const imageCount = parts.filter((part: any) => part.type === "image")
        .length;
      const suffix =
        imageCount > 0 ? ` [${imageCount} image${imageCount > 1 ? "s" : ""}]` : "";
      return `${text}${suffix}`;
    }
    return "";
  }

  private formatAssistantMessage(content: MessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content as any[];
      return parts
        .map((part: any) => {
          if (part.type === "text") {
            return part.text || "";
          }
          if (part.type === "tool_use" || part.type === "tool_result") {
            return `[tool ${part.name || "call"}]`;
          }
          return "";
        })
        .join("");
    }
    return "";
  }

  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
  }

  private openModelPalette(): void {
    this.setCommandPaletteMode?.("models");
    this.setCommandPaletteTitle?.("Switch Model · ⏎ to activate");
    this.setCommandPaletteQuery?.("");

    const entries: CommandPaletteEntry[] = [this.createBackEntry()];
    let hasOptions = false;

    const providers: Array<"anthropic" | "openai" | "maple" | "opencode"> = [
      "anthropic",
      "openai",
      "maple",
      "opencode",
    ];

    for (const provider of providers) {
      const providerConfigured = this.isProviderConfigured(provider);

      const providerModels = MODELS.filter((model) => model.provider === provider);
      if (providerModels.length === 0) {
        continue;
      }

      hasOptions = true;
      entries.push(
        this.createInfoEntry(
          `header-${provider}`,
          `━━━ ${this.getProviderLabel(provider)}${providerConfigured ? "" : " (link account)" } ━━━`,
        ),
      );

      for (const model of providerModels) {
        const isCurrent = this.isCurrentModel(model.id);
        const detailLines =
          isCurrent || !providerConfigured
            ? [
                ...(isCurrent ? ["(current model)"] : []),
                ...(!providerConfigured
                  ? ["Link account to activate this provider"]
                  : []),
              ]
            : undefined;

        entries.push({
          id: model.id,
          label: `${isCurrent ? "★ " : ""}${model.name}`,
          description: `${model.id} • ${model.pricing} • ${model.contextWindow.toLocaleString()} tokens`,
          keywords: [model.id, model.name, provider, model.pricing],
          run: () => this.switchModelFromPalette(model.id),
          detailLines,
        });
      }
    }

    if (!hasOptions) {
      entries.push(
        this.createInfoEntry(
          "no-models",
          "No configured providers",
          "Run /auth login or set API keys in config.json.",
        ),
      );
    }

    this.applyPaletteEntries(entries);
  }

  private isProviderConfigured(
    provider: "anthropic" | "openai" | "maple" | "opencode",
  ): boolean {
    if (provider === "anthropic") {
      return Boolean(
        this.config.anthropic?.apiKey || this.config.anthropic?.refresh,
      );
    }
    if (provider === "openai") {
      return Boolean(this.config.openai?.access && this.config.openai?.refresh);
    }
    if (provider === "maple") {
      return Boolean(this.config.maple?.apiKey);
    }
    return Boolean(this.config.opencode.apiKey);
  }

  private getProviderLabel(
    provider: "anthropic" | "openai" | "maple" | "opencode",
  ): string {
    switch (provider) {
      case "anthropic":
        return "Anthropic";
      case "openai":
        return "OpenAI (Codex)";
      case "maple":
        return "Maple AI";
      default:
        return "OpenCode";
    }
  }

  private isCurrentModel(modelId: string): boolean {
    const currentModelId =
      this.config.activeProvider === "anthropic"
        ? this.config.anthropic?.model
        : this.config.activeProvider === "openai"
          ? this.config.openai?.model
          : this.config.activeProvider === "maple"
            ? this.config.maple?.model
            : this.config.opencode.model;
    return currentModelId === modelId;
  }

  private async switchModelFromPalette(modelId: string): Promise<void> {
    const modelInfo = getModelInfo(modelId);
    if (!modelInfo) {
      this.applyPaletteEntries([
        this.createBackEntry("← Back to models", () => this.openModelPalette()),
        this.createInfoEntry("unknown-model", "Unknown model", modelId),
      ]);
      return;
    }

    if (modelInfo.provider === "openai") {
      if (!this.config.openai?.access || !this.config.openai?.refresh) {
        this.applyPaletteEntries([
          this.createBackEntry("← Back to models", () =>
            this.openModelPalette(),
          ),
          this.createInfoEntry(
            "openai-missing",
            "OpenAI not linked",
            "Run /login-openai (or Command Palette → Link OpenAI Account).",
          ),
        ]);
        return;
      }
    }

    if (modelInfo.provider === "maple" && !this.config.maple?.apiKey) {
      this.pendingMapleSetup = { modelId };
      this.setStatus(`Waiting for Maple API key for ${modelInfo.name}...`);
      this.applyPaletteEntries([
        this.createBackEntry("← Back to models", () => this.openModelPalette()),
        this.createInfoEntry(
          "maple-setup",
          `Enter your Maple API key for ${modelInfo.name}`,
          "Close the palette and paste the key into the input box.",
        ),
      ]);
      return;
    }

    if (
      modelInfo.provider === "anthropic" &&
      !this.config.anthropic?.apiKey &&
      !this.config.anthropic?.refresh
    ) {
      this.applyPaletteEntries([
        this.createBackEntry("← Back to models", () => this.openModelPalette()),
        this.createInfoEntry(
          "anthropic-missing",
          "Anthropic not configured",
          "Run /auth login to link your account.",
        ),
      ]);
      return;
    }

    if (modelInfo.provider === "opencode" && !this.config.opencode.apiKey) {
      this.applyPaletteEntries([
        this.createBackEntry("← Back to models", () => this.openModelPalette()),
        this.createInfoEntry(
          "opencode-missing",
          "OpenCode API key missing",
          "Update config.json with your key.",
        ),
      ]);
      return;
    }

    this.config.activeProvider = modelInfo.provider;
    if (modelInfo.provider === "anthropic") {
      if (!this.config.anthropic) {
        this.config.anthropic = { type: "api", apiKey: "", model: modelId };
      } else {
        this.config.anthropic.model = modelId;
      }
    } else if (modelInfo.provider === "openai") {
      if (this.config.openai) {
        this.config.openai.model = modelId;
      }
    } else if (modelInfo.provider === "maple") {
      if (this.config.maple) {
        this.config.maple.model = modelId;
      }
    } else {
      this.config.opencode.model = modelId;
    }

    await saveConfig(this.config);
    this.setStatus(`Ready • ${modelInfo.name} • Press Enter to send`);
    this.hideCommandPalette();
  }

  private openHelpPalette(): void {
    this.setCommandPaletteMode?.("help");
    this.setCommandPaletteTitle?.("Help · Palette reference");
    this.setCommandPaletteQuery?.("");
    this.applyPaletteEntries([
      this.createBackEntry(),
      ...this.getHelpEntries(),
    ]);
  }

  private getHelpEntries(): CommandPaletteEntry[] {
    return [
      this.createInfoEntry(
        "help-palette",
        "Cmd+O / Ctrl+O",
        "Open the command palette from anywhere",
      ),
      this.createInfoEntry(
        "help-sessions",
        "Resume Session",
        "Browse and load saved conversations",
      ),
      this.createInfoEntry(
        "help-models",
        "Switch Model",
        "Pick an Anthropic / OpenAI / Maple / OpenCode model",
      ),
      this.createInfoEntry(
        "help-theme",
        "Choose Theme",
        "Apply one of the built-in color palettes",
      ),
      this.createInfoEntry(
        "help-auth",
        "Link Anthropic Account",
        "Start the OAuth flow for Claude Pro/Max",
      ),
      this.createInfoEntry(
        "help-openai",
        "Link OpenAI Account",
        "Connect ChatGPT Pro / Codex via OAuth",
      ),
      this.createInfoEntry(
        "help-cancel",
        "Esc",
        "Cancel generation or close the active modal",
      ),
      this.createInfoEntry(
        "help-messages",
        "Enter",
        "Send the current message (Shift+Enter for newlines)",
      ),
    ];
  }

  private openThemePalette(): void {
    this.setCommandPaletteMode?.("themes");
    this.setCommandPaletteTitle?.("Choose Theme · ⏎ to activate");
    this.setCommandPaletteQuery?.("");

    const currentThemeName = this.config.theme || "tokyonight";
    const entries: CommandPaletteEntry[] = [
      this.createBackEntry(),
      ...Object.keys(themes).map((themeName) => {
        const theme = themes[themeName];
        const isCurrent = themeName === currentThemeName;
        return {
          id: `theme-${themeName}`,
          label: `${isCurrent ? "★ " : ""}${theme.name}`,
          description: themeName,
          keywords: [themeName, theme.name, "theme", "color"],
          run: () => this.setThemeFromPalette(themeName),
          detailLines: isCurrent ? ["(current theme)"] : undefined,
        };
      }),
    ];

    this.applyPaletteEntries(entries);
  }

  private async setThemeFromPalette(themeName: string): Promise<void> {
    const newTheme = setTheme(themeName);
    if (this.renderer) {
      this.renderer.setBackgroundColor(newTheme.background);
    }
    this.config.theme = themeName;
    await saveConfig(this.config);
    this.hideCommandPalette();
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
    if (this.getCommandPaletteOpen?.()) {
      return;
    }

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
