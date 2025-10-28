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
    case "help":
      await handleHelpCommand(ui);
      break;
    default:
      ui.appendOutput(`❌ Unknown command: /${command}\n`);
      ui.appendOutput(`Type /help for available commands\n`);
  }
}

async function handleHelpCommand(ui: UIAdapter): Promise<void> {
  ui.appendOutput("Available commands:\n");
  ui.appendOutput("  /models [model-id]  - List or switch models\n");
  ui.appendOutput("  /sessions           - List saved sessions\n");
  ui.appendOutput("  /load <id>          - Load a session by ID\n");
  ui.appendOutput("  /save <name>        - Name current session\n");
  ui.appendOutput("  /clear              - Clear current session\n");
  ui.appendOutput("  /help               - Show this help\n");
}

async function handleSessionsCommand(ui: UIAdapter): Promise<void> {
  const { listSessions } = require("../sessions");
  const sessions = listSessions();

  if (sessions.length === 0) {
    ui.appendOutput("No saved sessions found.\n");
    return;
  }

  ui.appendOutput(`Found ${sessions.length} session(s):\n\n`);

  for (const session of sessions.slice(0, 20)) {
    const updated = new Date(session.updated);
    const timeAgo = getTimeAgo(updated);
    const name = session.name ? ` "${session.name}"` : "";
    ui.appendOutput(
      `  ${session.id}${name}\n    ${session.model} • ${session.totalMessages} messages • ${timeAgo}\n\n`,
    );
  }

  if (sessions.length > 20) {
    ui.appendOutput(`  ... and ${sessions.length - 20} more\n\n`);
  }

  ui.appendOutput("Usage: /load <id> to resume a session\n");
}

async function handleLoadCommand(args: string[], ui: UIAdapter): Promise<void> {
  if (args.length === 0) {
    ui.appendOutput("❌ Usage: /load <session-id>\n");
    return;
  }

  const { loadSession, listSessions } = require("../sessions");
  const searchId = args[0];

  // Try exact match first
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

    // Check if Maple is configured if switching to Maple model
    if (modelInfo.provider === "maple" && !config.maple?.apiKey) {
      ui.pendingMapleSetup = { modelId };
      ui.appendOutput(`🔐 Setting up Maple AI for ${modelInfo.name}\n`);
      ui.appendOutput(`Enter your Maple API key: `);
      ui.setStatus("Waiting for Maple API key...");
      return;
    }

    // Switch model
    config.activeProvider = modelInfo.provider;
    if (modelInfo.provider === "opencode") {
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

  // Show model list
  ui.appendOutput("Available Models:\n\n");

  const openCodeModels = getModelsByProvider("opencode");
  const mapleModels = getModelsByProvider("maple");

  const currentModel =
    config.activeProvider === "opencode"
      ? config.opencode.model
      : config.maple?.model;

  ui.appendOutput("OpenCode:\n");
  for (const model of openCodeModels) {
    const current =
      model.id === currentModel && config.activeProvider === "opencode"
        ? " (current)"
        : "";
    ui.appendOutput(
      `  ${model.id.padEnd(20)} ${model.name.padEnd(20)} ${model.pricing}${current}\n`,
    );
  }

  ui.appendOutput("\nMaple AI:\n");
  for (const model of mapleModels) {
    const current =
      model.id === currentModel && config.activeProvider === "maple"
        ? " (current)"
        : "";
    const configured = config.maple?.apiKey ? "" : " (not configured)";
    ui.appendOutput(
      `  ${model.id.padEnd(20)} ${model.name.padEnd(20)} ${model.pricing}${current}${configured}\n`,
    );
  }

  ui.appendOutput("\nUsage: /models <model-id> to switch\n");
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
