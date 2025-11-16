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
import { getAgentHotkeyTriggers } from "../agents/triggers";
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
import {
  matchHotkeyEvent,
  parseHotkeyCombo,
  type HotkeyDescriptor,
} from "../utils/hotkeys";

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
  private agentHotkeys: Array<{
    descriptor: HotkeyDescriptor;
    command: string;
  }> = [];
  private commandPaletteHotkey?: HotkeyDescriptor;
  private commandPaletteActive = false;
  private setCommandPaletteActive?: (active: boolean) => void;
  private getCommandPaletteActive?: () => boolean;
  private commandPaletteEntries: Array<{
    id: string;
    command: string;
    description: string;
    autoRun?: boolean;
  }> = [];
  private selectedCommandIndex = 0;

  constructor(config: Config) {
    this.config = config;
    this.agentHotkeys = getAgentHotkeyTriggers(config)
      .map((binding) => {
        const descriptor = parseHotkeyCombo(binding.combo);
        if (!descriptor) {
          return null;
        }
        return { descriptor, command: binding.command };
      })
      .filter(
        (
          entry,
        ): entry is { descriptor: HotkeyDescriptor; command: string } =>
          entry !== null,
      );

    // Initialize command palette hotkey
    this.commandPaletteHotkey = parseHotkeyCombo("cmdorctrl+o") ?? undefined;
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
        const [commandPaletteActive, setCommandPaletteActive] =
          createSignal(false);
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
        this.setCommandPaletteActive = setCommandPaletteActive;

        this.getStatusText = statusText;
        this.getOutputContent = outputContent;
        this.getMessageParts = messageParts;
        this.getInputValue = inputValue;
        this.getInputPlaceholder = inputPlaceholder;
        this.getImageCount = imageCount;
        this.getCommandPaletteActive = commandPaletteActive;

        onMount(() => {
          // Store renderer reference
          this.renderer = renderer;

          const handleGlobalKeys = (key: KeyEvent) => {
            // Check for command palette hotkey (Cmd-O / Ctrl-O)
            if (
              this.commandPaletteHotkey &&
              matchHotkeyEvent(this.commandPaletteHotkey, key)
            ) {
              key.preventDefault?.();
              this.showCommandPalette();
              return;
            }

            // Handle explain keys
            this.processExplainKeyEvent(key);
          };

          this.renderer.keyInput?.on?.("keypress", handleGlobalKeys);
          this.renderer.keyInput?.on?.("keyrepeat", handleGlobalKeys);
          this.renderer.keyInput?.on?.("keyrelease", handleGlobalKeys);

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
                  // Handle command palette navigation if active
                  if (commandPaletteActive()) {
                    if (e.name === "escape") {
                      e.preventDefault();
                      this.hideCommandPalette();
                      return;
                    }
                    if (e.name === "up") {
                      e.preventDefault();
                      this.movePaletteSelection(-1);
                      return;
                    }
                    if (e.name === "down") {
                      e.preventDefault();
                      this.movePaletteSelection(1);
                      return;
                    }
                    if (e.name === "return") {
                      e.preventDefault();
                      await this.executeSelectedCommand();
                      return;
                    }
                    // Block other keys when palette is active
                    return;
                  }

                  // Check for command palette hotkey
                  if (
                    this.commandPaletteHotkey &&
                    matchHotkeyEvent(this.commandPaletteHotkey, e)
                  ) {
                    e.preventDefault();
                    this.showCommandPalette();
                    return;
                  }

                  const hotkey = this.agentHotkeys.find(({ descriptor }) =>
                    matchHotkeyEvent(descriptor, e),
                  );
                  if (hotkey) {
                    e.preventDefault();
                    this.applyAgentCommandShortcut(hotkey.command);
                    return;
                  }

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

            {/* Command Palette Modal */}
            <Show when={commandPaletteActive()}>
              <box
                style={{
                  position: "absolute",
                  top: 3,
                  left: 5,
                  right: 5,
                  bottom: 5,
                  backgroundColor: theme.background,
                  border: true,
                  borderStyle: "double",
                  borderColor: "#7aa2f7",
                  zIndex: 1000,
                  padding: 1,
                  flexDirection: "column",
                }}
              >
                <text style={{ fg: "#7aa2f7", marginBottom: 1 }}>
                  Command Palette (↑/↓ to navigate, Enter to select, Esc to
                  close)
                </text>
                <box style={{ flexGrow: 1, overflow: "hidden" }}>
                  <For each={this.commandPaletteEntries}>
                    {(entry, index) => {
                      const isSelected = index() === this.selectedCommandIndex;
                      return (
                        <text
                          style={{
                            fg: isSelected ? "#7aa2f7" : theme.foreground,
                            bg: isSelected ? "#2d3f5f" : "transparent",
                          }}
                        >
                          {isSelected ? "→ " : "  "}
                          {entry.command} - {entry.description}
                          {"\n"}
                        </text>
                      );
                    }}
                  </For>
                </box>
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

  private applyAgentCommandShortcut(command: string): void {
    const text = `/${command} `;
    this.inputText = text;
    this.setInputValue(text);
    if (this.inputEl?.editBuffer) {
      this.inputEl.editBuffer.setText(text, { history: false });
    }
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

  private buildCommandPaletteEntries(): void {
    const { getAgentSlashCommandTriggers } = require("../agents/triggers");

    this.commandPaletteEntries = [
      {
        id: "builtin-clear",
        command: "/clear",
        description: "Reset conversation",
        autoRun: true,
      },
      {
        id: "builtin-sessions",
        command: "/sessions",
        description: "List saved sessions",
        autoRun: true,
      },
      {
        id: "builtin-models",
        command: "/models",
        description: "Switch active model",
        autoRun: true,
      },
      {
        id: "builtin-toggle",
        command: "/toggle",
        description: "Cycle color theme",
        autoRun: false,
      },
      {
        id: "builtin-toggle-metadata",
        command: "/toggle metadata",
        description: "Toggle timestamps and token counts",
        autoRun: true,
      },
      {
        id: "builtin-toggle-diffs",
        command: "/toggle diffs",
        description: "Toggle inline diffs for edit tool",
        autoRun: true,
      },
      {
        id: "builtin-toggle-verbose",
        command: "/toggle verbose",
        description: "Toggle verbose tool output",
        autoRun: true,
      },
    ];

    // Add agent slash commands
    const agentCommands = getAgentSlashCommandTriggers(this.config);
    for (const trigger of agentCommands) {
      this.commandPaletteEntries.push({
        id: `agent-${trigger.agentId}-${trigger.command}`,
        command: `/${trigger.command}`,
        description: trigger.description || `Agent: ${trigger.agentId}`,
        autoRun: false,
      });
    }

    this.selectedCommandIndex = 0;
  }

  private showCommandPalette(): void {
    if (this.getCommandPaletteActive?.()) return;

    this.buildCommandPaletteEntries();
    this.setCommandPaletteActive?.(true);
  }

  private hideCommandPalette(): void {
    this.setCommandPaletteActive?.(false);
    this.selectedCommandIndex = 0;

    // Refocus textarea
    if (this.inputEl) {
      setTimeout(() => {
        this.inputEl.focus();
      }, 0);
    }
  }

  private movePaletteSelection(delta: number): void {
    const newIndex = this.selectedCommandIndex + delta;
    if (newIndex >= 0 && newIndex < this.commandPaletteEntries.length) {
      this.selectedCommandIndex = newIndex;
      // Trigger re-render by updating the signal
      this.setCommandPaletteActive?.(true);
    }
  }

  private async executeSelectedCommand(): Promise<void> {
    const entry = this.commandPaletteEntries[this.selectedCommandIndex];
    if (!entry) return;

    this.hideCommandPalette();

    if (entry.autoRun) {
      // Execute the command directly
      const commandText = entry.command.startsWith("/")
        ? entry.command.slice(1)
        : entry.command;
      const parts = commandText.split(" ");
      const command = parts[0];
      const args = parts.slice(1);

      await executeCommand(command, args, this, this.config);
    } else {
      // Insert command into input for user to complete
      const commandText = entry.command;
      this.inputEl.plainText = commandText;
      this.inputText = commandText;
      this.setInputValue(commandText);

      if (this.inputEl) {
        this.inputEl.focus();
      }
    }
  }
}

export async function createTUISolidAdapter(
  config: Config,
): Promise<UIAdapter> {
  const adapter = new TUISolidAdapter(config);
  await adapter.start();
  return adapter;
}
