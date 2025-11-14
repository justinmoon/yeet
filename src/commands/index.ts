import { exchangeOAuthCode, startAnthropicOAuth } from "../auth";
import {
  exchangeAuthorizationCode,
  parseAuthorizationInput,
  startOpenAIOAuth,
} from "../openai-auth";
import type { Config } from "../config";
import { saveConfig } from "../config";
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
import { setActiveWorkspaceBinding } from "../workspace/state";
import { getAgentSpawner, getAgentInbox } from "../agents/service";

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
      await handleLoadCommand(args, ui);
      break;
    case "save":
      await handleSaveCommand(args, ui);
      break;
    case "clear":
      await handleClearCommand(ui);
      break;
    case "toggle":
      await handleToggleCommand(ui, config);
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
      await handleHelpCommand(ui);
      break;
    case "explain":
      await handleExplainCommand(args, ui);
      break;
    default:
      ui.appendOutput(`❌ Unknown command: /${command}\n`);
      ui.appendOutput(`Type /help for available commands\n`);
  }
}

async function handleToggleCommand(
  ui: UIAdapter,
  config: Config,
): Promise<void> {
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
}

async function handleHelpCommand(ui: UIAdapter): Promise<void> {
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
  ui.appendOutput("  /toggle             - Cycle through color themes\n");
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

  const cwd = process.cwd();
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

async function handleLoadCommand(args: string[], ui: UIAdapter): Promise<void> {
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
    process.cwd(),
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
        ui.appendOutput(`You: ${text} [${imageCount} image(s)]\n\n`);
      } else {
        ui.appendOutput(`You: ${message.content}\n\n`);
      }
    } else {
      ui.appendOutput(`Assistant: ${message.content}\n\n`);
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

export async function startAnthropicOAuthFlow(
  ui: UIAdapter,
  _config: Config,
): Promise<void> {
  ui.appendOutput("🔐 Starting Anthropic OAuth (Claude Pro/Max)...\n\n");

  try {
    const { url, verifier } = await startAnthropicOAuth();
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
    } catch {
      ui.appendOutput("⚠️  Could not open browser automatically.\n");
      ui.appendOutput("Please open this URL manually:\n");
      ui.appendOutput(`   ${url}\n\n`);
    }

    ui.appendOutput("After authorizing:\n");
    ui.appendOutput("1. Copy the authorization code\n");
    ui.appendOutput("2. Paste it back into Yeet\n");

    ui.pendingOAuthSetup = { verifier, provider: "anthropic" };
    ui.setStatus("Waiting for Anthropic OAuth code...");
  } catch (error: any) {
    ui.appendOutput(`\n❌ Failed to start OAuth: ${error.message}\n`);
  }
}

export async function startOpenAIOAuthFlow(
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  ui.appendOutput("🔐 Starting OpenAI OAuth (ChatGPT Pro)...\n\n");

  try {
    const { startCallbackServer } = await import("../openai-callback-server");

    ui.appendOutput("Starting local callback server on port 1455...\n");
    const callbackServer = await startCallbackServer();

    try {
      const { url, verifier, state } = await startOpenAIOAuth();

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
      } catch {
        ui.appendOutput("⚠️  Could not open browser automatically.\n");
        ui.appendOutput("Please open this URL manually:\n");
        ui.appendOutput(`   ${url}\n\n`);
      }

      ui.appendOutput("Waiting for authorization...\n");
      ui.appendOutput("(The browser will redirect automatically)\n\n");

      ui.pendingOAuthSetup = { verifier, provider: "openai", state };
      ui.setStatus("Waiting for OpenAI OAuth callback...");

      const result = await callbackServer.waitForCallback(state);

      if (result) {
        ui.appendOutput("✓ Received authorization callback\n");
        ui.pendingOAuthSetup = undefined;
        await handleOAuthCodeInput(
          `${result.code}#${result.state}`,
          verifier,
          ui,
          config,
          "openai",
          state,
        );
      } else {
        ui.pendingOAuthSetup = undefined;
        ui.appendOutput("\n❌ Authorization callback timed out.\n");
        ui.appendOutput("Please restart the OpenAI login flow.\n");
      }
    } finally {
      callbackServer.close();
    }
  } catch (error: any) {
    ui.appendOutput(`\n❌ Failed to start OpenAI OAuth: ${error.message}\n`);
  }
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
    process.cwd(),
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
    const spawner = await getAgentSpawner();
    const handle = await spawner.spawn({
      agentId,
      capability: "subtask",
      prompt,
      parentSessionId: ui.currentSessionId,
      trigger: { type: "slash", value: "spawnagent" },
    });

    ui.appendOutput(
      `🚀 Spawned ${agentId} in session ${handle.sessionId}. Use /inbox to monitor progress.\n`,
    );

    const unsubscribe = handle.onStatusChange((status) => {
      ui.appendOutput(`  ↳ ${agentId} status: ${status}\n`);
    });

    handle
      .awaitResult()
      .then((result) => {
        if (result.status === "complete") {
          ui.appendOutput(`✅ ${agentId} finished: ${result.summary}\n`);
        } else if (result.error) {
          ui.appendOutput(`❌ ${agentId} failed: ${result.error}\n`);
        } else {
          ui.appendOutput(`⚠️ ${agentId} status: ${result.status}\n`);
        }
      })
      .catch((error: any) => {
        ui.appendOutput(
          `❌ ${agentId} encountered an error: ${error?.message || error}\n`,
        );
      })
      .finally(() => {
        unsubscribe();
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
  provider: "anthropic" | "openai" = "anthropic",
  expectedState?: string,
  options?: {
    suppressOutput?: boolean;
    onStatus?: (message: string) => void;
  },
): Promise<{ status: "success" | "failed"; provider: "anthropic" | "openai" }> {
  const write = (message: string): void => {
    if (options?.suppressOutput) {
      options.onStatus?.(message);
    } else {
      ui.appendOutput(message);
    }
  };

  write("\n\n🔄 Exchanging code for tokens...\n");

  try {
    if (provider === "openai") {
      const parsed = parseAuthorizationInput(code.trim());
      const authCode = parsed.code || code.trim();
      const receivedState = parsed.state;

      if (expectedState) {
        if (!receivedState) {
          write("❌ Missing OAuth state parameter.\n");
          write("Please restart the OpenAI login flow.\n");
          return { status: "failed", provider };
        }
        if (receivedState !== expectedState) {
          write("❌ Invalid OAuth state parameter.\n");
          write("Please restart the OpenAI login flow.\n");
          return { status: "failed", provider };
        }
      }

      const result = await exchangeAuthorizationCode(authCode, verifier);

      if (result.type === "failed") {
        write("❌ Failed to exchange OpenAI OAuth code\n");
        write("Please restart the OpenAI login flow.\n");
        return { status: "failed", provider };
      }

      config.openai = {
        type: "oauth",
        refresh: result.refresh!,
        access: result.access!,
        expires: result.expires!,
        model: "gpt-5-codex",
      };
      config.activeProvider = "openai";

      await saveConfig(config);

      write("✓ Successfully authenticated with OpenAI!\n");
      write("✓ Using ChatGPT Pro subscription\n");
      write(`✓ Active model: ${config.openai.model}\n\n`);
      ui.setStatus(`Ready • ${config.openai.model} • Press Enter to send`);
      return { status: "success", provider };
    }

    const result = await exchangeOAuthCode(code.trim(), verifier);

    if (result.type === "failed") {
      write("❌ Failed to exchange Anthropic OAuth code\n");
      write("Please restart the Anthropic login flow.\n");
      return { status: "failed", provider };
    }

    config.anthropic = {
      type: "oauth",
      refresh: result.refresh!,
      access: result.access!,
      expires: result.expires!,
      model: "claude-sonnet-4-5-20250929",
    };
    config.activeProvider = "anthropic";

    await saveConfig(config);

    write("✓ Successfully authenticated with Anthropic!\n");
    write("✓ Using Claude Pro/Max subscription\n");
    write(`✓ Active model: ${config.anthropic.model}\n\n`);
    ui.setStatus(`Ready • ${config.anthropic.model} • Press Enter to send`);
    return { status: "success", provider };
  } catch (error: any) {
    write(`❌ Error: ${error.message}\n`);
    return { status: "failed", provider };
  }
}
