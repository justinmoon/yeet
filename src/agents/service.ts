import { loadConfig } from "../config";
import type { Config } from "../config";
import { AgentInbox } from "./inbox";
import { AgentRegistry } from "./registry";
import { AgentSpawner } from "./spawner";
import { WatcherBridge } from "./watchers";

const inbox = new AgentInbox();
let registryPromise: Promise<AgentRegistry> | null = null;
let spawnerPromise: Promise<AgentSpawner> | null = null;
let watcherBridge: WatcherBridge | null = null;

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

export function getWatcherBridge(): WatcherBridge {
  if (!watcherBridge) {
    watcherBridge = new WatcherBridge(async (agentId) => {
      const registry = await ensureRegistry();
      return registry.get(agentId);
    });
  }
  return watcherBridge;
}

export function resetAgentServicesForTesting(): void {
  registryPromise = null;
  spawnerPromise = null;
  watcherBridge?.clear();
  watcherBridge = null;
}
