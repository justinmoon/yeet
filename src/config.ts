import os from "os";
import path from "path";
import { chmod, mkdir } from "fs/promises";

// Centralized config directory - follows XDG Base Directory spec
export const YEET_CONFIG_DIR = path.join(os.homedir(), ".config", "yeet");

async function ensureConfigDir(): Promise<void> {
  await mkdir(YEET_CONFIG_DIR, { recursive: true });
}

export interface Config {
  activeProvider: "opencode" | "maple" | "anthropic";
  opencode: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
  maxSteps?: number;
  temperature?: number;
  // Maple AI configuration (optional)
  maple?: {
    apiUrl: string;
    apiKey: string;
    model: string;
    pcr0Values: string[];
  };
  // Anthropic OAuth or API key
  anthropic?: {
    type: "oauth" | "api";
    // For OAuth
    refresh?: string;
    access?: string;
    expires?: number;
    accountUuid?: string;
    organizationUuid?: string;
    userUuid?: string;
    // For API key
    apiKey?: string;
    model?: string;
  };
}

async function tryLoadOpenCodeCredentials(): Promise<{
  opencodeKey: string | null;
  anthropicOAuth: any | null;
}> {
  let opencodeKey = null;
  let anthropicOAuth = null;

  try {
    // Try to load from OpenCode's auth.json
    const opencodeAuthPath = path.join(
      os.homedir(),
      ".local",
      "share",
      "opencode",
      "auth.json",
    );
    const authFile = Bun.file(opencodeAuthPath);

    if (await authFile.exists()) {
      const authData = await authFile.json();
      if (authData.opencode?.type === "api" && authData.opencode.key) {
        opencodeKey = authData.opencode.key;
      }
      // Also check for Anthropic OAuth
      if (authData.anthropic?.type === "oauth") {
        anthropicOAuth = {
          type: "oauth" as const,
          refresh: authData.anthropic.refresh,
          access: authData.anthropic.access,
          expires: authData.anthropic.expires,
        };
      }
    }
  } catch (error) {
    // Ignore errors, will fall through to return null
  }
  return { opencodeKey, anthropicOAuth };
}

async function createDefaultConfig(configPath: string): Promise<Config> {
  const { opencodeKey, anthropicOAuth } = await tryLoadOpenCodeCredentials();

  if (!opencodeKey && !anthropicOAuth) {
    throw new Error(
      `No authentication configured.\n\n` +
        `Choose one of:\n\n` +
        `1. Anthropic Claude Pro/Max OAuth:\n` +
        `   Run: yeet auth login\n` +
        `   Then select Anthropic and follow prompts\n\n` +
        `2. Anthropic API Key:\n` +
        `   Create ${configPath} with:\n` +
        `   {\n` +
        `     "activeProvider": "anthropic",\n` +
        `     "anthropic": {\n` +
        `       "type": "api",\n` +
        `       "apiKey": "sk-ant-...",\n` +
        `       "model": "claude-sonnet-4-5-20250929"\n` +
        `     }\n` +
        `   }\n\n` +
        `3. OpenCode Zen API:\n` +
        `   Create ${configPath} with:\n` +
        `   {\n` +
        `     "activeProvider": "opencode",\n` +
        `     "opencode": {\n` +
        `       "apiKey": "your-opencode-zen-api-key",\n` +
        `       "baseURL": "https://opencode.ai/zen/v1",\n` +
        `       "model": "grok-code"\n` +
        `     }\n` +
        `   }`,
    );
  }

  const config: Config = anthropicOAuth
    ? {
        activeProvider: "anthropic",
        opencode: {
          apiKey: "",
          baseURL: "https://opencode.ai/zen/v1",
          model: "grok-code",
        },
        anthropic: anthropicOAuth,
        maxSteps: 20,
        temperature: 0.5,
      }
    : {
        activeProvider: "opencode",
        opencode: {
          apiKey: opencodeKey!,
          baseURL: "https://opencode.ai/zen/v1",
          model: "grok-code",
        },
        maxSteps: 20,
        temperature: 0.5,
      };

  // Create config directory if it doesn't exist
  await mkdir(path.dirname(configPath), { recursive: true });

  // Write config file
  await Bun.write(configPath, JSON.stringify(config, null, 2));

  // Set secure permissions
  await chmod(configPath, 0o600);

  console.log(`✓ Created config at ${configPath}`);
  if (anthropicOAuth) {
    console.log(`✓ Copied Anthropic OAuth credentials from OpenCode`);
  } else {
    console.log(`✓ Copied OpenCode API credentials`);
  }
  console.log();

  return config;
}

export async function loadConfig(): Promise<Config> {
  await ensureConfigDir();
  const configPath = path.join(YEET_CONFIG_DIR, "config.json");
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return await createDefaultConfig(configPath);
  }

  const config = (await file.json()) as any;

  // Migrate old config: set activeProvider based on maple.enabled
  if (!config.activeProvider) {
    config.activeProvider = config.maple?.enabled ? "maple" : "opencode";
  }
  if (config.maple?.enabled !== undefined) {
    delete config.maple.enabled;
  }

  return {
    ...config,
    maxSteps: config.maxSteps || 20,
    temperature: config.temperature || 0.5,
  } as Config;
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  const configPath = path.join(YEET_CONFIG_DIR, "config.json");
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  await chmod(configPath, 0o600);
}
