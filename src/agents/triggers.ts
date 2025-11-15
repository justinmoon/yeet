import type {
  AgentCapability,
  AgentHotkeyTriggerConfig,
  AgentReturnMode,
  AgentSlashTriggerConfig,
  Config,
} from "../config";

export interface AgentSlashCommandTrigger {
  agentId: string;
  command: string;
  description?: string;
  capability: AgentCapability;
  returnMode: AgentReturnMode;
}

export interface AgentHotkeyTrigger {
  agentId: string;
  combo: string;
  command: string;
  description?: string;
  capability: AgentCapability;
  returnMode: AgentReturnMode;
}

function normalizeCommandName(value: string): string {
  const trimmed = value.startsWith("/") ? value.slice(1) : value;
  return trimmed.toLowerCase();
}

function deriveSlashTriggers(
  agentId: string,
  profileDescription: string | undefined,
  entries?: AgentSlashTriggerConfig[],
): AgentSlashCommandTrigger[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  return entries.map((entry) => ({
    agentId,
    command: entry.command,
    description: entry.description || profileDescription,
    capability: entry.capability,
    returnMode: entry.returnMode,
  }));
}

function deriveHotkeyTriggers(
  agentId: string,
  profileDescription: string | undefined,
  entries?: AgentHotkeyTriggerConfig[],
): AgentHotkeyTrigger[] {
  if (!entries || entries.length === 0) {
    return [];
  }

  return entries
    .filter((entry) => entry.command && entry.combo)
    .map((entry) => ({
      agentId,
      combo: entry.combo,
      command: entry.command,
      description: entry.description || profileDescription,
      capability: entry.capability,
      returnMode: entry.returnMode,
    }));
}

export function getAgentSlashCommandTriggers(
  config: Config,
): AgentSlashCommandTrigger[] {
  if (!config.agents) return [];
  const triggers: AgentSlashCommandTrigger[] = [];
  for (const profile of Object.values(config.agents)) {
    triggers.push(
      ...deriveSlashTriggers(
        profile.id,
        profile.description,
        profile.triggers?.slash,
      ),
    );
  }
  return triggers;
}

export function findAgentSlashCommandTrigger(
  config: Config,
  command: string,
): AgentSlashCommandTrigger | undefined {
  const normalized = normalizeCommandName(command);
  return getAgentSlashCommandTriggers(config).find(
    (entry) => entry.command === normalized,
  );
}

export function getAgentHotkeyTriggers(
  config: Config,
): AgentHotkeyTrigger[] {
  if (!config.agents) return [];
  const triggers: AgentHotkeyTrigger[] = [];
  for (const profile of Object.values(config.agents)) {
    triggers.push(
      ...deriveHotkeyTriggers(
        profile.id,
        profile.description,
        profile.triggers?.hotkeys,
      ),
    );
  }
  return triggers;
}
