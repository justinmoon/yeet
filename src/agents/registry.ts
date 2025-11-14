import type {
  AgentCapability,
  AgentProfileConfig,
  AgentProfileMap,
  Config,
  ToolName,
} from "../config";

/**
 * In-memory registry for agent profiles loaded from config + overrides.
 * Provides capability-based lookup and lightweight validation.
 */
export class AgentRegistry {
  private profiles: AgentProfileMap;

  constructor(profiles: AgentProfileMap = {}) {
    this.profiles = { ...profiles };
    this.validateProfiles();
  }

  list(): AgentProfileConfig[] {
    return Object.values(this.profiles);
  }

  get(id: string): AgentProfileConfig | undefined {
    return this.profiles[id];
  }

  profilesByCapability(capability: AgentCapability): AgentProfileConfig[] {
    return this.list().filter((profile) =>
      profile.capabilities.includes(capability),
    );
  }

  hasCapability(id: string, capability: AgentCapability): boolean {
    const profile = this.get(id);
    if (!profile) return false;
    return profile.capabilities.includes(capability);
  }

  private validateProfiles(): void {
    for (const profile of this.list()) {
      this.validateCapabilities(profile);
      this.validateWatcherPermissions(profile);
    }
  }

  private validateCapabilities(profile: AgentProfileConfig): void {
    if (!profile.capabilities || profile.capabilities.length === 0) {
      throw new Error(
        `Agent "${profile.id}" must declare at least one capability`,
      );
    }
  }

  private validateWatcherPermissions(profile: AgentProfileConfig): void {
    if (!profile.capabilities.includes("watcher")) {
      return;
    }

    const allowWrites =
      profile.permissionOverrides?.allowWrites ??
      profile.defaultWorkspace?.allowWrites ??
      false;

    if (allowWrites) {
      throw new Error(
        `Watcher agent "${profile.id}" cannot allow writes via permissionOverrides/defaultWorkspace`,
      );
    }

    const disallowedTools: ToolName[] = ["write", "edit"];
    for (const tool of disallowedTools) {
      const permission = profile.tools?.[tool];
      if (permission?.enabled) {
        throw new Error(
          `Watcher agent "${profile.id}" cannot enable "${tool}" tool`,
        );
      }
    }

    const bashPermission = profile.tools?.bash;
    if (bashPermission?.enabled && bashPermission.mode !== "read") {
      throw new Error(
        `Watcher agent "${profile.id}" cannot enable "bash" tool with non-read mode`,
      );
    }
  }
}

export function createAgentRegistry(config: Config): AgentRegistry {
  return new AgentRegistry(config.agents ?? {});
}
