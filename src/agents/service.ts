import { loadConfig } from "../config";
import type { Config } from "../config";
import { AgentInbox } from "./inbox";
import { AgentRegistry } from "./registry";
import { AgentSpawner } from "./spawner";

const inbox = new AgentInbox();
let registryPromise: Promise<AgentRegistry> | null = null;
let spawnerPromise: Promise<AgentSpawner> | null = null;

async function ensureRegistry(): Promise<AgentRegistry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const config = await loadConfig();
      return new AgentRegistry(config.agents ?? {});
    })();
  }
  return registryPromise;
}

async function getConfigSnapshot(): Promise<Config> {
  return loadConfig();
}

export async function getAgentSpawner(): Promise<AgentSpawner> {
  if (!spawnerPromise) {
    spawnerPromise = (async () => {
      const registry = await ensureRegistry();
      return new AgentSpawner(registry, inbox, getConfigSnapshot);
    })();
  }
  return spawnerPromise;
}

export function getAgentInbox(): AgentInbox {
  return inbox;
}

export function resetAgentServicesForTesting(): void {
  registryPromise = null;
  spawnerPromise = null;
}
