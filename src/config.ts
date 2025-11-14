import os from "os";
import path from "path";
import { chmod, mkdir, readdir, readFile } from "fs/promises";

// Centralized config directory - follows XDG Base Directory spec
export const YEET_CONFIG_DIR = path.join(os.homedir(), ".config", "yeet");
export const AGENT_CONFIG_DIR = path.join(YEET_CONFIG_DIR, "agents");

async function ensureConfigDir(): Promise<void> {
  await mkdir(YEET_CONFIG_DIR, { recursive: true });
}

export type AgentCapability = "primary" | "subtask" | "watcher";

export type ToolName =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "complete"
  | "clarify"
  | "pause"
  | "delegate_to_worker"
  | "transition_stage"
  | "report_results"
  | "complete_workflow";

export interface ToolPermission {
  enabled: boolean;
  mode?: "read" | "write" | "execute";
  notes?: string;
}

export interface WorkspacePolicy {
  mode: "inherit" | "sandbox" | "custom";
  customPath?: string;
  allowWrites?: boolean;
}

export interface PermissionPreset {
  allowWrites?: boolean;
  allowShell?: boolean;
  allowNetwork?: boolean;
  notes?: string;
}

export interface AgentProfileConfig {
  id: string;
  description?: string;
  model: string;
  promptPath?: string;
  temperature?: number;
  tools?: Partial<Record<ToolName, ToolPermission>>;
  capabilities: AgentCapability[];
  defaultWorkspace?: WorkspacePolicy;
  permissionOverrides?: PermissionPreset;
}

export type AgentProfileMap = Record<string, AgentProfileConfig>;

export interface Config {
  activeProvider: "opencode" | "maple" | "anthropic" | "openai";
  opencode: {
    apiKey: string;
    baseURL: string;
    model: string;
  };
  maxSteps?: number;
  temperature?: number;
  theme?: string; // Color theme: tokyonight, nord, catppuccin, everforest
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
  // OpenAI ChatGPT Pro OAuth
  openai?: {
    type: "oauth";
    refresh: string;
    access: string;
    expires: number;
    accountId?: string;
    model?: string;
  };
  agents?: AgentProfileMap;
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
        `   Run: yeet /login-anthropic\n\n` +
        `2. ChatGPT Pro/Codex OAuth:\n` +
        `   Run: yeet /login-openai\n\n` +
        `3. Anthropic API Key:\n` +
        `   Create ${configPath} with:\n` +
        `   {\n` +
        `     "activeProvider": "anthropic",\n` +
        `     "anthropic": {\n` +
        `       "type": "api",\n` +
        `       "apiKey": "sk-ant-...",\n` +
        `       "model": "claude-sonnet-4-5-20250929"\n` +
        `     }\n` +
        `   }\n\n` +
        `4. OpenCode Zen API:\n` +
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

  config.agents = await loadAgentProfiles();
  await validateAgentProfiles(config.agents);
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

  const resolved: Config = {
    ...config,
    maxSteps: config.maxSteps || 20,
    temperature: config.temperature || 0.5,
  };

  resolved.agents = await loadAgentProfiles(config.agents);
  await validateAgentProfiles(resolved.agents);

  return resolved;
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  const configPath = path.join(YEET_CONFIG_DIR, "config.json");
  await Bun.write(configPath, JSON.stringify(config, null, 2));
  await chmod(configPath, 0o600);
}

const KNOWN_TOOL_NAMES: ToolName[] = [
  "bash",
  "read",
  "write",
  "edit",
  "search",
  "complete",
  "clarify",
  "pause",
  "delegate_to_worker",
  "transition_stage",
  "report_results",
  "complete_workflow",
];

function isToolName(value: string): value is ToolName {
  return KNOWN_TOOL_NAMES.includes(value as ToolName);
}

function normalizeToolPermissions(
  tools: any,
): Partial<Record<ToolName, ToolPermission>> {
  if (!tools || typeof tools !== "object") {
    return {};
  }

  const normalized: Partial<Record<ToolName, ToolPermission>> = {};

  for (const [key, value] of Object.entries(tools)) {
    if (!isToolName(key)) continue;

    if (typeof value === "boolean") {
      normalized[key] = { enabled: value };
      continue;
    }

    if (typeof value === "object" && value !== null) {
      normalized[key] = {
        enabled: Boolean((value as any).enabled),
        mode:
          (value as any).mode === "read" ||
          (value as any).mode === "write" ||
          (value as any).mode === "execute"
            ? (value as any).mode
            : undefined,
        notes:
          typeof (value as any).notes === "string"
            ? (value as any).notes
            : undefined,
      };
    }
  }

  return normalized;
}

function normalizeWorkspacePolicy(
  policy?: WorkspacePolicy,
): WorkspacePolicy | undefined {
  if (!policy) return undefined;
  const mode =
    policy.mode === "sandbox"
      ? "sandbox"
      : policy.mode === "custom"
        ? "custom"
        : "inherit";

  return {
    mode,
    customPath:
      typeof policy.customPath === "string" ? policy.customPath : undefined,
    allowWrites:
      typeof policy.allowWrites === "boolean" ? policy.allowWrites : undefined,
  };
}

function normalizePermissionPreset(
  preset?: PermissionPreset,
): PermissionPreset | undefined {
  if (!preset) return undefined;
  return {
    allowWrites:
      typeof preset.allowWrites === "boolean" ? preset.allowWrites : undefined,
    allowShell:
      typeof preset.allowShell === "boolean" ? preset.allowShell : undefined,
    allowNetwork:
      typeof preset.allowNetwork === "boolean" ? preset.allowNetwork : undefined,
    notes: typeof preset.notes === "string" ? preset.notes : undefined,
  };
}

function assertWatcherConstraints(
  id: string,
  profile: AgentProfileConfig,
): void {
  const allowWritesFlag =
    profile.permissionOverrides?.allowWrites === true ||
    profile.defaultWorkspace?.allowWrites === true;

  if (allowWritesFlag) {
    throw new Error(
      `[config] Watcher agent "${id}" cannot allow writes in permissionOverrides/defaultWorkspace`,
    );
  }

  const disallowedTools: ToolName[] = ["write", "edit"];
  for (const tool of disallowedTools) {
    if (profile.tools?.[tool]?.enabled) {
      throw new Error(
        `[config] Watcher agent "${id}" cannot enable "${tool}" tool`,
      );
    }
  }

  const bashPermission = profile.tools?.bash;
  if (bashPermission?.enabled) {
    if (bashPermission.mode !== "read") {
      throw new Error(
        `[config] Watcher agent "${id}" can only enable bash in read mode`,
      );
    }
  }
}

function normalizeAgentProfile(
  id: string,
  profile: any,
  base?: AgentProfileConfig,
): AgentProfileConfig | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const model =
    typeof profile.model === "string"
      ? profile.model
      : base?.model
        ? base.model
        : null;
  if (!model) {
    console.warn(
      `[config] Skipping agent "${id}" because model is missing or invalid`,
    );
    return null;
  }

  const capabilities = Array.isArray(profile.capabilities)
    ? profile.capabilities.filter((cap: any) =>
        ["primary", "subtask", "watcher"].includes(cap),
      )
    : base?.capabilities ?? [];

  if (capabilities.length === 0) {
    capabilities.push("subtask");
  }

  const description =
    typeof profile.description === "string"
      ? profile.description
      : base?.description;
  const promptPath =
    typeof profile.promptPath === "string"
      ? profile.promptPath
      : base?.promptPath;
  const temperature =
    typeof profile.temperature === "number"
      ? profile.temperature
      : base?.temperature;

  const tools = {
    ...(base?.tools || {}),
    ...normalizeToolPermissions(profile.tools),
  };

  const normalized: AgentProfileConfig = {
    id,
    description,
    model,
    promptPath,
    temperature,
    tools,
    capabilities: capabilities as AgentCapability[],
    defaultWorkspace:
      normalizeWorkspacePolicy(profile.defaultWorkspace) ??
      base?.defaultWorkspace,
    permissionOverrides:
      normalizePermissionPreset(profile.permissionOverrides) ??
      base?.permissionOverrides,
  };

  if (normalized.capabilities.includes("watcher")) {
    assertWatcherConstraints(id, normalized);
    normalized.defaultWorkspace = {
      mode: normalized.defaultWorkspace?.mode || "inherit",
      customPath: normalized.defaultWorkspace?.customPath,
      allowWrites: false,
    };
  }

  return normalized;
}

async function loadAgentProfiles(
  inlineProfiles?: AgentProfileMap,
): Promise<AgentProfileMap> {
  const merged: AgentProfileMap = {};

  if (inlineProfiles) {
    for (const [id, profile] of Object.entries(inlineProfiles)) {
      const normalized = normalizeAgentProfile(id, profile, merged[id] || undefined);
      if (normalized) {
        merged[id] = normalized;
      }
    }
  }

  await mkdir(AGENT_CONFIG_DIR, { recursive: true });
  const files = await readdir(AGENT_CONFIG_DIR, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const filePath = path.join(AGENT_CONFIG_DIR, file.name);
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const derivedId =
      typeof parsed.id === "string" && parsed.id.trim().length > 0
        ? parsed.id.trim()
        : file.name.replace(/\.json$/i, "");
    const normalized = normalizeAgentProfile(
      derivedId,
      parsed,
      merged[derivedId] || undefined,
    );
    if (normalized) {
      merged[derivedId] = normalized;
    }
  }

  return merged;
}

async function validateAgentProfiles(
  agents?: AgentProfileMap,
): Promise<void> {
  if (!agents) return;
  const { AgentRegistry } = await import("./agents/registry");
  // Instantiate to trigger validation logic
  new AgentRegistry(agents);
}
