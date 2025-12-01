import { exchangeOAuthCode, startAnthropicOAuth } from "../auth";
import type {
  AgentCapability,
  AgentReturnMode,
  Config,
} from "../config";
import { saveConfig } from "../config";
import {
  formatMessageLine,
  formatHistorySpacer,
  type AttachmentRef,
} from "../ui/history-renderer";
import { getHistoryConfig } from "../ui/backend";
import {
  createStubExplainResult,
  getGitDiff,
  normalizeRequest,
  planSections,
  resolveDefaultBaseRef,
} from "../explain";
import type { ExplainResult } from "../explain";
import { MODELS, getModelInfo, getModelsByProvider } from "../models/registry";
import type { UIAdapter } from "../ui/interface";
import {
  getActiveWorkspaceBinding,
  setActiveWorkspaceBinding,
} from "../workspace/state";
import { getAgentSpawner, getAgentInbox } from "../agents/service";
import type { SessionTrigger } from "../agents/types";
import {
  findAgentSlashCommandTrigger,
  getAgentHotkeyTriggers,
  getAgentSlashCommandTriggers,
} from "../agents/triggers";

export interface ParsedCommand {
  isCommand: boolean;
  command?: string;
  args: string[];
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { isCommand: false, args: [] };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);

  return {
    isCommand: true,
    command,
    args,
  };
}

export async function executeCommand(
  command: string,
  args: string[],
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  switch (command) {
    case "auth":
      await handleAuthCommand(args, ui, config);
      break;
    case "models":
      await handleModelsCommand(args, ui, config);
      break;
    case "sessions":
      await handleSessionsCommand(ui);
      break;
    case "load":
      await handleLoadCommand(args, ui, config);
      break;
    case "save":
      await handleSaveCommand(args, ui);
      break;
    case "clear":
      await handleClearCommand(ui);
      break;
    case "toggle":
      await handleToggleCommand(args, ui, config);
      break;
    case "workspace":
      await handleWorkspaceCommand(args, ui);
      break;
    case "spawnagent":
      await handleSpawnAgentCommand(args, ui);
      break;
    case "inbox":
      await handleInboxCommand(ui);
      break;
    case "help":
      await handleHelpCommand(ui, config);
      break;
    case "explain":
      await handleExplainCommand(args, ui);
      break;
    default:
      if (
        await tryHandleAgentSlashCommand(command, args, ui, config)
      ) {
        break;
      }
      ui.appendOutput(`❌ Unknown command: /${command}\n`);
      ui.appendOutput(`Type /help for available commands\n`);
  }
}

async function handleToggleCommand(
  args: string[],
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  const option = args[0]?.toLowerCase();

  switch (option) {
    case "metadata": {
      // Toggle metadata display
      if (!config.ui) config.ui = {};
      if (!config.ui.history) config.ui.history = {};
      const newValue = !config.ui.history.showMetadata;
      config.ui.history.showMetadata = newValue;
      await saveConfig(config);

      // Update TUIAdapter config if available
      if (ui.updateHistoryConfig) {
        ui.updateHistoryConfig({ showMetadata: newValue });
      }

      ui.appendOutput(
        newValue
          ? "✓ Metadata display enabled (timestamps and token counts)\n"
          : "✓ Metadata display disabled\n",
      );
      break;
    }

    case "diffs": {
      // Toggle inline diffs for edit tool
      if (!config.ui) config.ui = {};
      if (!config.ui.history) config.ui.history = {};
      const newValue = !config.ui.history.inlineDiffs;
      config.ui.history.inlineDiffs = newValue;
      await saveConfig(config);

      // Update TUIAdapter config if available
      if (ui.updateHistoryConfig) {
        ui.updateHistoryConfig({ inlineDiffs: newValue });
      }

      ui.appendOutput(
        newValue
          ? "✓ Inline diffs enabled (edit tool will show diffs)\n"
          : "✓ Inline diffs disabled (edit tool shows summary only)\n",
      );
      break;
    }

    case "verbose": {
      // Toggle verbose tool output
      if (!config.ui) config.ui = {};
      if (!config.ui.history) config.ui.history = {};
      const newValue = !config.ui.history.verboseTools;
      config.ui.history.verboseTools = newValue;
      await saveConfig(config);

      // Update TUIAdapter config if available
      if (ui.updateHistoryConfig) {
        ui.updateHistoryConfig({ verboseTools: newValue });
      }

      ui.appendOutput(
        newValue
          ? "✓ Verbose tool output enabled (show full details)\n"
          : "✓ Verbose tool output disabled (show summaries only)\n",
      );
      break;
    }

    case "theme":
    case undefined: {
      // Default behavior: toggle theme
      const { cycleTheme } = await import("../ui/colors");
      const newTheme = cycleTheme();

      // Update background color if UI supports it
      if (ui.setBackgroundColor) {
        ui.setBackgroundColor(newTheme.background);
      }

      // Save theme to config
      const { themes } = await import("../ui/colors");
      const themeName = Object.keys(themes).find((k) => themes[k] === newTheme);
      if (themeName) {
        config.theme = themeName;
        await saveConfig(config);
      }

      ui.appendOutput(`🎨 Switched to ${newTheme.name} theme\n`);
      break;
    }

    default:
      ui.appendOutput(`❌ Unknown toggle option: ${option}\n`);
      ui.appendOutput("Available options:\n");
      ui.appendOutput("  /toggle theme      - Cycle color theme\n");
      ui.appendOutput("  /toggle metadata   - Toggle timestamps and token counts\n");
      ui.appendOutput("  /toggle diffs      - Toggle inline diffs for edit tool\n");
      ui.appendOutput("  /toggle verbose    - Toggle verbose tool output\n");
  }
}

async function handleHelpCommand(
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  ui.appendOutput("Available commands:\n");
  ui.appendOutput("  /auth login         - Login with Anthropic OAuth\n");
  ui.appendOutput("  /auth status        - Show current authentication\n");
  ui.appendOutput("  /models [model-id]  - List or switch models\n");
  ui.appendOutput(
    "  /sessions           - Interactive session picker (or list)\n",
  );
  ui.appendOutput("  /load <id|number>   - Load a session by ID or number\n");
  ui.appendOutput("  /save <name>        - Name current session\n");
  ui.appendOutput("  /clear              - Clear current session\n");
  ui.appendOutput("  /toggle [option]    - Toggle theme, metadata, diffs, or verbose output\n");
  ui.appendOutput("  /workspace <mode>   - Set workspace to readonly or writable\n");
  ui.appendOutput("  /spawnagent <id>    - Launch a configured subagent with prompt\n");
  ui.appendOutput("  /inbox              - Show pending subagent status updates\n");
  ui.appendOutput(
    "  /explain [prompt]   - Generate tutorial for current diff\n",
  );
  ui.appendOutput("  /help               - Show this help\n");
  ui.appendOutput("\nSession Management:\n");
  ui.appendOutput(
    "  • /sessions opens an interactive modal (↑↓ to navigate, Enter to select)\n",
  );
  ui.appendOutput("  • /load 1 loads the first session from /sessions list\n");
  ui.appendOutput("  • All sessions auto-save to ~/.config/yeet/sessions/\n");
  ui.appendOutput("\nMaple AI models with tool calling support:\n");
  ui.appendOutput("  ✓ deepseek-r1-0528, deepseek-v31-terminus\n");
  ui.appendOutput("  ✓ qwen3-coder-480b, qwen3-coder-30b-a3b, qwen2-5-72b\n");
  ui.appendOutput("  ✓ gpt-oss-120b\n");
  ui.appendOutput(
    "  ✗ mistral-small-3-1-24b, llama-3.3-70b (no tool calling)\n",
  );

  const agentCommands = getAgentSlashCommandTriggers(config);
  if (agentCommands.length > 0) {
    ui.appendOutput("\nAgent Commands:\n");
    for (const entry of agentCommands) {
      const note = entry.description ? ` - ${entry.description}` : "";
      ui.appendOutput(
        `  /${entry.command} (${entry.agentId})${note}\n`,
      );
    }
  }

  const agentHotkeys = getAgentHotkeyTriggers(config);
  if (agentHotkeys.length > 0) {
    ui.appendOutput("\nAgent Hotkeys:\n");
    for (const hotkey of agentHotkeys) {
      ui.appendOutput(
        `  ${hotkey.combo} → /${hotkey.command} (${hotkey.agentId})\n`,
      );
    }
  }
}

async function handleExplainCommand(
  args: string[],
  ui: UIAdapter,
): Promise<void> {
  const useStub =
    process.env.YEET_EXPLAIN_STUB === "1" || args.includes("--stub");
  const filteredArgs = args.filter((arg) => arg !== "--stub");
  const prompt = filteredArgs.length
    ? filteredArgs.join(" ")
    : "Explain the current branch changes";

  const cwd = getActiveWorkspaceBinding().cwd;
  ui.appendOutput(`\n🔍 Running /explain in ${cwd}\n`);

  try {
    const base = await resolveDefaultBaseRef(cwd);
    const head = "HEAD";
    ui.appendOutput(`  • Comparing ${base}..${head}\n`);

    const intent = normalizeRequest({
      prompt,
      cwd,
      base,
      head,
    });

    let result: ExplainResult;

    if (useStub) {
      result = createStubExplainResult(intent);
      ui.appendOutput(
        `  • Using stub tutorial with ${result.sections.length} section(s)\n`,
      );
    } else {
      ui.appendOutput("  • Loading diff...\n");
      const diffs = await getGitDiff({
        cwd: intent.cwd,
        base: intent.base,
        head: intent.head,
        includePath: intent.includePath,
      });
      ui.appendOutput(`  • Loaded ${diffs.length} diff hunks\n`);

      if (diffs.length === 0) {
        ui.appendOutput("⚠️ No diff content detected for this range.\n");
        return;
      }

      ui.appendOutput("  • Planning tutorial...\n");
      const sections = await planSections(intent, diffs);
      ui.appendOutput(`  • Generated ${sections.length} section(s)\n`);

      if (sections.length === 0) {
        ui.appendOutput("⚠️ No tutorial sections generated.\n");
        return;
      }

      result = {
        intent,
        diffs,
        sections,
      };
    }

    ui.appendOutput(
      `✓ Generated ${result.sections.length} tutorial section(s). Press Esc to close the viewer.\n`,
    );

    if (ui.showExplainReview) {
      ui.showExplainReview(result);
    } else {
      for (const section of result.sections) {
        ui.appendOutput(`\n== ${section.title} ==\n`);
        ui.appendOutput(`${section.explanation}\n`);
      }
    }
  } catch (error: any) {
    ui.appendOutput(`❌ /explain failed: ${error?.message || String(error)}\n`);
  }
}

async function handleSessionsCommand(ui: UIAdapter): Promise<void> {
  // If UI supports interactive modal, use that
  if (ui.showSessionSelector) {
    ui.showSessionSelector();
    return;
  }

  // Fallback: text-based list with numbers
  const { listSessions, loadSession } = require("../sessions");
  const sessions = listSessions();

  if (sessions.length === 0) {
    ui.appendOutput("No saved sessions found.\n");
    return;
  }

  ui.appendOutput(`Found ${sessions.length} session(s):\n\n`);

  for (let i = 0; i < Math.min(sessions.length, 20); i++) {
    const session = sessions[i];
    const updated = new Date(session.updated);
    const timeAgo = getTimeAgo(updated);
    const name = session.name ? ` "${session.name}"` : "";

    // Show number for quick access
    ui.appendOutput(`  ${i + 1}. ${session.id}${name}\n`);
    ui.appendOutput(
      `     ${session.model} • ${session.totalMessages} messages • ${timeAgo}\n`,
    );

    // Try to load preview
    const fullSession = loadSession(session.id);
    if (fullSession && fullSession.conversationHistory.length > 0) {
      const firstUserMsg = fullSession.conversationHistory.find(
        (m: any) => m.role === "user",
      );
      if (firstUserMsg) {
        const preview =
          typeof firstUserMsg.content === "string"
            ? firstUserMsg.content
            : "[message with images]";
        const shortPreview =
          preview.length > 80 ? preview.substring(0, 77) + "..." : preview;
        ui.appendOutput(`     Preview: ${shortPreview}\n`);
      }
    }
    ui.appendOutput("\n");
  }

  if (sessions.length > 20) {
    ui.appendOutput(`  ... and ${sessions.length - 20} more\n\n`);
  }

  ui.appendOutput("Usage: /load <id|number> to resume a session\n");
}

async function handleLoadCommand(args: string[], ui: UIAdapter, config: Config): Promise<void> {
  if (args.length === 0) {
    ui.appendOutput("❌ Usage: /load <session-id|number>\n");
    return;
  }

  const { loadSession, listSessions } = require("../sessions");
  const searchId = args[0];

  // Try numeric index first (1-based)
  const numIndex = Number.parseInt(searchId, 10);
  if (!Number.isNaN(numIndex) && numIndex > 0) {
    const sessions = listSessions();
    if (numIndex <= sessions.length) {
      const session = loadSession(sessions[numIndex - 1].id);
      if (session) {
        await loadSessionIntoUI(session, ui);
        return;
      }
    } else {
      ui.appendOutput(
        `❌ Invalid session number: ${numIndex}. Only ${sessions.length} sessions available.\n`,
      );
      return;
    }
  }

  // Try exact match
  let session = loadSession(searchId);

  // If not found, try partial match
  if (!session) {
    const sessions = listSessions();
    const matches = sessions.filter((s: any) => s.id.startsWith(searchId));

    if (matches.length === 0) {
      ui.appendOutput(`❌ Session not found: ${searchId}\n`);
      return;
    }

    if (matches.length > 1) {
      ui.appendOutput(`❌ Multiple sessions match "${searchId}":\n`);
      for (const match of matches) {
        ui.appendOutput(`  ${match.id}\n`);
      }
      return;
    }

    session = loadSession(matches[0].id);
  }

  if (!session) {
    ui.appendOutput(`❌ Failed to load session: ${searchId}\n`);
    return;
  }

  await loadSessionIntoUI(session, ui);
}

function loadSessionIntoUI(session: any, ui: UIAdapter): void {
  const { ensureSessionWorkspace } = require("../sessions");
  const binding = ensureSessionWorkspace(
    session,
    getActiveWorkspaceBinding().cwd,
    session.workspace?.allowWrites ?? true,
  );
  setActiveWorkspaceBinding(binding);

  // Load session into UI
  ui.currentSessionId = session.id;
  ui.conversationHistory = session.conversationHistory;
  ui.currentTokens = session.currentTokens;

  // Display conversation history
  ui.clearOutput();
  ui.appendOutput(`✓ Loaded session ${session.id}\n`);
  if (session.name) {
    ui.appendOutput(`  Name: ${session.name}\n`);
  }
  ui.appendOutput(
    `  ${session.model} • ${session.totalMessages} messages • Workspace: ${binding.allowWrites ? "writable" : "read-only"}\n\n`,
  );

  // Replay conversation using shared formatter
  const historyConfig = getHistoryConfig(config);
  for (let i = 0; i < session.conversationHistory.length; i++) {
    const message = session.conversationHistory[i];

    // Add spacer between messages (except before first)
    if (i > 0) {
      ui.appendOutput(formatHistorySpacer());
    }

    if (message.role === "user") {
      const hasImages =
        Array.isArray(message.content) &&
        message.content.some((p: any) => p.type === "image");

      let text = "";
      let attachments: AttachmentRef[] = [];

      if (hasImages) {
        const imageCount = (message.content as any[]).filter(
          (p) => p.type === "image",
        ).length;
        text = (message.content as any[])
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("");
        attachments = Array.from({ length: imageCount }, (_, idx) => ({
          type: "image" as const,
          index: idx + 1,
        }));
      } else {
        text = message.content as string;
      }

      ui.appendOutput(
        formatMessageLine("user", text, undefined, attachments, historyConfig.showMetadata),
      );
    } else {
      ui.appendOutput(
        formatMessageLine("assistant", message.content as string, undefined, undefined, historyConfig.showMetadata),
      );
    }
  }

  ui.updateTokenCount();
}

async function handleSaveCommand(args: string[], ui: UIAdapter): Promise<void> {
  if (args.length === 0) {
    ui.appendOutput("❌ Usage: /save <name>\n");
    return;
  }

  if (!ui.currentSessionId) {
    ui.appendOutput("❌ No active session to name\n");
    return;
  }

  const name = args.join(" ");
  const { updateSessionName } = require("../sessions");

  if (updateSessionName(ui.currentSessionId, name)) {
    ui.appendOutput(`✓ Session named: ${name}\n`);
  } else {
    ui.appendOutput(`❌ Failed to save session name\n`);
  }
}

async function handleClearCommand(ui: UIAdapter): Promise<void> {
  ui.conversationHistory = [];
  ui.currentTokens = 0;
  ui.currentSessionId = null;
  ui.clearOutput();
  ui.appendOutput("✓ Session cleared. Starting fresh.\n\n");
  ui.updateTokenCount();
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}

async function handleModelsCommand(
  args: string[],
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  // Direct switch: /models <model-id>
  if (args.length > 0) {
    const modelId = args[0];
    const modelInfo = getModelInfo(modelId);

    if (!modelInfo) {
      ui.appendOutput(`❌ Unknown model: ${modelId}\n`);
      ui.appendOutput(`Type /models to see available models\n`);
      return;
    }

    // Check if provider is configured
    if (modelInfo.provider === "maple" && !config.maple?.apiKey) {
      ui.pendingMapleSetup = { modelId };
      ui.appendOutput(`🔐 Setting up Maple AI for ${modelInfo.name}\n`);
      ui.appendOutput(`Enter your Maple API key: `);
      ui.setStatus("Waiting for Maple API key...");
      return;
    }

    if (
      modelInfo.provider === "anthropic" &&
      !config.anthropic?.apiKey &&
      !config.anthropic?.refresh
    ) {
      ui.appendOutput(`❌ Anthropic not configured\n`);
      ui.appendOutput(`Run /auth login to set up Anthropic OAuth\n`);
      return;
    }

    if (modelInfo.provider === "opencode" && !config.opencode.apiKey) {
      ui.appendOutput(`❌ OpenCode not configured\n`);
      return;
    }

    // Switch model
    config.activeProvider = modelInfo.provider;
    if (modelInfo.provider === "anthropic") {
      if (!config.anthropic) {
        config.anthropic = { type: "api", apiKey: "" };
      }
      config.anthropic.model = modelId;
    } else if (modelInfo.provider === "opencode") {
      config.opencode.model = modelId;
    } else if (modelInfo.provider === "maple") {
      config.maple!.model = modelId;
    }

    await saveConfig(config);
    ui.appendOutput(
      `✓ Switched to ${modelInfo.name} (${modelInfo.provider})\n`,
    );
    ui.setStatus(`Ready • ${modelInfo.name} • Press Enter to send`);
    return;
  }

  // Show modal if UI supports it
  if (ui.showModelSelector) {
    ui.showModelSelector();
    return;
  }

  // Fallback: text-based list
  ui.appendOutput("Available Models:\n\n");

  const anthropicModels = getModelsByProvider("anthropic");
  const openCodeModels = getModelsByProvider("opencode");
  const mapleModels = getModelsByProvider("maple");

  const currentModel =
    config.activeProvider === "anthropic"
      ? config.anthropic?.model
      : config.activeProvider === "opencode"
        ? config.opencode.model
        : config.maple?.model;

  // Show Anthropic models if configured
  if (config.anthropic?.apiKey || config.anthropic?.refresh) {
    ui.appendOutput("Anthropic:\n");
    for (const model of anthropicModels) {
      const current =
        model.id === currentModel && config.activeProvider === "anthropic"
          ? " (current)"
          : "";
      ui.appendOutput(
        `  ${model.id.padEnd(40)} ${model.name.padEnd(25)} ${model.pricing}${current}\n`,
      );
    }
    ui.appendOutput("\n");
  }

  // Show OpenCode models if configured
  if (config.opencode.apiKey) {
    ui.appendOutput("OpenCode:\n");
    for (const model of openCodeModels) {
      const current =
        model.id === currentModel && config.activeProvider === "opencode"
          ? " (current)"
          : "";
      ui.appendOutput(
        `  ${model.id.padEnd(40)} ${model.name.padEnd(25)} ${model.pricing}${current}\n`,
      );
    }
    ui.appendOutput("\n");
  }

  // Show Maple models if configured
  if (config.maple?.apiKey) {
    ui.appendOutput("Maple AI:\n");
    for (const model of mapleModels) {
      const current =
        model.id === currentModel && config.activeProvider === "maple"
          ? " (current)"
          : "";
      ui.appendOutput(
        `  ${model.id.padEnd(40)} ${model.name.padEnd(25)} ${model.pricing}${current}\n`,
      );
    }
    ui.appendOutput("\n");
  }

  ui.appendOutput("Usage: /models <model-id> to switch\n");
}

export async function handleMapleSetup(
  apiKey: string,
  modelId: string,
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  const modelInfo = getModelInfo(modelId);
  if (!modelInfo || modelInfo.provider !== "maple") {
    ui.appendOutput(`\n❌ Invalid model: ${modelId}\n`);
    return;
  }

  // Initialize Maple config with current PCR0 values
  config.maple = {
    apiKey: apiKey.trim(),
    apiUrl: "https://enclave.trymaple.ai",
    model: modelId,
    pcr0Values: [
      // Current production PCR0 (as of 2025-10-27)
      "79e7bd1e7df09fdb5b7098956a2268c278cc88be323c11975e2a2d080d65f30f8e0efe690edd450493c833b46f40ae1a",
      // Previous PCR0 values (for rollback support)
      "ed9109c16f30a470cf0ea2251816789b4ffa510c990118323ce94a2364b9bf05bdb8777959cbac86f5cabc4852e0da71",
      "4f2bcdf16c38842e1a45defd944d24ea58bb5bcb76491843223022acfe9eb6f1ff79b2cb9a6b2a9219daf9c7bf40fa37",
      "b8ee4b511ef2c9c6ab3e5c0840c5df2218fbb4d9df88254ece7af9462677e55aa5a03838f3ae432d86ca1cb6f992eee7",
    ],
  };
  config.activeProvider = "maple";

  await saveConfig(config);
  ui.appendOutput(`\n✓ Maple AI configured with ${modelInfo.name}\n`);
  ui.setStatus(`Ready • ${modelInfo.name} • Press Enter to send`);
}

async function handleWorkspaceCommand(
  args: string[],
  ui: UIAdapter,
): Promise<void> {
  const mode = args[0]?.toLowerCase();
  const usage =
    "Usage: /workspace <readonly|writable>\n  readonly   Disable write/edit/bash tools\n  writable   Restore full write access\n";

  if (!mode) {
    ui.appendOutput(usage);
    return;
  }

  let allowWrites: boolean | null = null;
  if (["readonly", "read-only", "ro"].includes(mode)) {
    allowWrites = false;
  } else if (
    ["writable", "readwrite", "rw", "writeable", "write"].includes(mode)
  ) {
    allowWrites = true;
  }

  if (allowWrites === null) {
    ui.appendOutput(usage);
    return;
  }

  if (!ui.currentSessionId) {
    ui.appendOutput("⚠️  No active session to update. Start chatting first.\n");
    return;
  }

  const { loadSession, saveSession, ensureSessionWorkspace } = await import(
    "../sessions"
  );
  const session = loadSession(ui.currentSessionId);
  if (!session) {
    ui.appendOutput("⚠️  Failed to load current session.\n");
    return;
  }

  const binding = ensureSessionWorkspace(
    session,
    getActiveWorkspaceBinding().cwd,
    allowWrites,
  );
  binding.allowWrites = allowWrites;
  saveSession(session, { skipParentUpdate: true });
  setActiveWorkspaceBinding(binding);

  ui.appendOutput(
    allowWrites
      ? "📝 Workspace is now writable.\n"
      : "🔒 Workspace set to read-only. write/edit/bash will be blocked.\n",
  );
}

async function handleSpawnAgentCommand(
  args: string[],
  ui: UIAdapter,
): Promise<void> {
  const [agentId, ...promptParts] = args;
  if (!agentId || promptParts.length === 0) {
    ui.appendOutput("Usage: /spawnagent <agent-id> <prompt>\n");
    return;
  }
  if (!ui.currentSessionId) {
    ui.appendOutput("⚠️  Start a session before spawning subagents.\n");
    return;
  }

  const prompt = promptParts.join(" ");
  try {
    await spawnAgentWithPrompt({
      agentId,
      capability: "subtask",
      prompt,
      ui,
      trigger: { type: "slash", value: "spawnagent" },
      returnMode: "background",
    });
  } catch (error: any) {
    ui.appendOutput(`❌ Failed to spawn agent: ${error.message}\n`);
  }
}

async function handleInboxCommand(ui: UIAdapter): Promise<void> {
  const inbox = getAgentInbox();
  const updates = inbox.poll();
  if (updates.length === 0) {
    ui.appendOutput("📭 Inbox empty.\n");
    return;
  }
  ui.appendOutput("📬 Subagent Updates:\n");
  for (const update of updates) {
    const statusLine = `  • ${update.agentId} (${update.sessionId}) → ${update.status}`;
    ui.appendOutput(`${statusLine}\n`);
    if (update.summary) {
      ui.appendOutput(`     Summary: ${update.summary}\n`);
    }
    if (update.error) {
      ui.appendOutput(`     Error: ${update.error}\n`);
    }
  }
}

interface SpawnAgentOptions {
  agentId: string;
  capability: AgentCapability;
  prompt: string;
  ui: UIAdapter;
  trigger: SessionTrigger;
  returnMode?: AgentReturnMode;
}

async function spawnAgentWithPrompt(
  options: SpawnAgentOptions,
): Promise<void> {
  if (!options.prompt || !options.prompt.trim()) {
    throw new Error("Prompt required");
  }

  if (!options.ui.currentSessionId) {
    options.ui.saveCurrentSession();
  }

  const spawner = await getAgentSpawner();
  const handle = await spawner.spawn({
    agentId: options.agentId,
    capability: options.capability,
    prompt: options.prompt,
    parentSessionId: options.ui.currentSessionId ?? undefined,
    trigger: options.trigger,
  });

  if (options.returnMode === "blocking") {
    options.ui.appendOutput(
      `🚀 Running ${options.agentId} (waiting for summary)...\n`,
    );
    try {
      const result = await handle.awaitResult();
      if (result.status === "complete") {
        options.ui.appendOutput(
          `✅ ${options.agentId} finished: ${result.summary}\n`,
        );
      } else if (result.error) {
        options.ui.appendOutput(
          `❌ ${options.agentId} failed: ${result.error}\n`,
        );
      } else {
        options.ui.appendOutput(
          `⚠️ ${options.agentId} status: ${result.status}\n`,
        );
      }
    } catch (error: any) {
      options.ui.appendOutput(
        `❌ ${options.agentId} encountered an error: ${error?.message || error}\n`,
      );
    }
    return;
  }

  options.ui.appendOutput(
    `🚀 Spawned ${options.agentId} in session ${handle.sessionId}. Use /inbox to monitor progress.\n`,
  );

  const unsubscribe = handle.onStatusChange((status) => {
    options.ui.appendOutput(`  ↳ ${options.agentId} status: ${status}\n`);
  });

  handle
    .awaitResult()
    .then((result) => {
      if (result.status === "complete") {
        options.ui.appendOutput(
          `✅ ${options.agentId} finished: ${result.summary}\n`,
        );
      } else if (result.error) {
        options.ui.appendOutput(
          `❌ ${options.agentId} failed: ${result.error}\n`,
        );
      } else {
        options.ui.appendOutput(
          `⚠️ ${options.agentId} status: ${result.status}\n`,
        );
      }
    })
    .catch((error: any) => {
      options.ui.appendOutput(
        `❌ ${options.agentId} encountered an error: ${error?.message || error}\n`,
      );
    })
    .finally(() => {
      unsubscribe();
    });
}

async function tryHandleAgentSlashCommand(
  command: string,
  args: string[],
  ui: UIAdapter,
  config: Config,
): Promise<boolean> {
  const trigger = findAgentSlashCommandTrigger(config, command);
  if (!trigger) {
    return false;
  }

  const prompt = args.join(" ").trim();
  if (!prompt) {
    ui.appendOutput(`Usage: /${command} <prompt>\n`);
    return true;
  }

  try {
    await spawnAgentWithPrompt({
      agentId: trigger.agentId,
      capability: trigger.capability,
      prompt,
      ui,
      trigger: { type: "slash", value: command },
      returnMode: trigger.returnMode,
    });
  } catch (error: any) {
    ui.appendOutput(
      `❌ Failed to spawn ${trigger.agentId}: ${error?.message || error}\n`,
    );
  }

  return true;
}

async function handleAuthCommand(
  args: string[],
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "status") {
    // Show current auth status
    ui.appendOutput("Authentication Status:\n\n");

    if (config.anthropic?.type === "oauth") {
      const expiresIn = config.anthropic.expires
        ? Math.floor((config.anthropic.expires - Date.now()) / 1000 / 60)
        : 0;
      ui.appendOutput("✓ Anthropic: OAuth (Claude Pro/Max)\n");
      ui.appendOutput(
        `  Token expires in: ${expiresIn > 0 ? `${expiresIn} minutes` : "expired (will auto-refresh)"}\n`,
      );
    } else if (config.anthropic?.type === "api") {
      ui.appendOutput("✓ Anthropic: API Key\n");
    } else if (config.opencode.apiKey) {
      ui.appendOutput("✓ OpenCode Zen API\n");
      ui.appendOutput(`  Model: ${config.opencode.model}\n`);
    } else if (config.maple?.apiKey) {
      ui.appendOutput("✓ Maple AI\n");
      ui.appendOutput(`  Model: ${config.maple.model}\n`);
    } else {
      ui.appendOutput("❌ No authentication configured\n\n");
      ui.appendOutput("Run /auth login to set up Anthropic OAuth\n");
    }
    return;
  }

  if (subcommand === "login") {
    ui.appendOutput("🔐 Starting Anthropic OAuth (Claude Pro/Max)...\n\n");

    try {
      const { url, verifier } = await startAnthropicOAuth();

      // Automatically open browser
      ui.appendOutput("Opening browser for authentication...\n\n");

      try {
        const platform = process.platform;
        const openCmd =
          platform === "darwin"
            ? "open"
            : platform === "win32"
              ? "start"
              : "xdg-open";

        await Bun.spawn([openCmd, url], {
          stdout: "ignore",
          stderr: "ignore",
        }).exited;
      } catch (e) {
        // If auto-open fails, show the URL
        ui.appendOutput("⚠️  Could not open browser automatically.\n");
        ui.appendOutput("Please open this URL manually:\n");
        ui.appendOutput(`   ${url}\n\n`);
      }

      ui.appendOutput("After authorizing:\n");
      ui.appendOutput("1. Copy the authorization code\n");
      ui.appendOutput("2. Paste it here: ");

      // Set up state for receiving the code
      ui.pendingOAuthSetup = { verifier };
      ui.setStatus("Waiting for OAuth code...");
    } catch (error: any) {
      ui.appendOutput(`\n❌ Failed to start OAuth: ${error.message}\n`);
    }
    return;
  }

  ui.appendOutput(`❌ Unknown auth subcommand: ${subcommand}\n`);
  ui.appendOutput("Usage:\n");
  ui.appendOutput("  /auth login  - Login with Anthropic OAuth\n");
  ui.appendOutput("  /auth status - Show current authentication\n");
}

export async function handleOAuthCodeInput(
  code: string,
  verifier: string,
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  ui.appendOutput("\n\n🔄 Exchanging code for tokens...\n");

  try {
    const result = await exchangeOAuthCode(code.trim(), verifier);

    if (result.type === "failed") {
      ui.appendOutput("❌ Failed to exchange OAuth code\n");
      ui.appendOutput("Please try /auth login again\n");
      return;
    }

    // Save OAuth credentials
    config.anthropic = {
      type: "oauth",
      refresh: result.refresh!,
      access: result.access!,
      expires: result.expires!,
      model: "claude-sonnet-4-5-20250929",
    };
    config.activeProvider = "anthropic";

    await saveConfig(config);

    ui.appendOutput("✓ Successfully authenticated with Anthropic!\n");
    ui.appendOutput("✓ Using Claude Pro/Max subscription\n");
    ui.appendOutput(`✓ Active model: ${config.anthropic.model}\n\n`);
    ui.setStatus(`Ready • ${config.anthropic.model} • Press Enter to send`);
  } catch (error: any) {
    ui.appendOutput(`❌ Error: ${error.message}\n`);
  }
}
