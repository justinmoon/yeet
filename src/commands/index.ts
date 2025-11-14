import { exchangeOAuthCode, startAnthropicOAuth } from "../auth";
import {
  exchangeAuthorizationCode,
  parseAuthorizationInput,
  startOpenAIOAuth,
} from "../openai-auth";
import type { Config } from "../config";
import { saveConfig } from "../config";
import { getModelInfo } from "../models/registry";
import type { UIAdapter } from "../ui/interface";

export async function handleMapleSetup(
  apiKey: string,
  modelId: string,
  ui: UIAdapter,
  config: Config,
): Promise<void> {
  const modelInfo = getModelInfo(modelId);
  if (!modelInfo || modelInfo.provider !== "maple") {
    ui.appendOutput(`\n❌ Invalid Maple model: ${modelId}\n`);
    return;
  }

  config.maple = {
    apiKey: apiKey.trim(),
    apiUrl: "https://enclave.trymaple.ai",
    model: modelId,
    pcr0Values: [
      "79e7bd1e7df09fdb5b7098956a2268c278cc88be323c11975e2a2d080d65f30f8e0efe690edd450493c833b46f40ae1a",
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
