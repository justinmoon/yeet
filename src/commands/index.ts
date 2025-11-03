import { exchangeOAuthCode, startAnthropicOAuth } from "../auth";
import type { Config } from "../config";
import { saveConfig } from "../config";
import { MODELS, getModelInfo, getModelsByProvider } from "../models/registry";
import type { UIAdapter } from "../ui/interface";

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
    case "help":
      await handleHelpCommand(ui);
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
  ui.appendOutput(`  ${session.model} • ${session.totalMessages} messages\n\n`);

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
