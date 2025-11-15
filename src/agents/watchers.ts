import type { MessageContent } from "../agent";
import type { AgentCapability, AgentProfileConfig } from "../config";
import { logger } from "../logger";

export type WatcherEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call";

export interface WatcherEvent {
  type: WatcherEventType;
  sessionId?: string | null;
  origin?: {
    agentId?: string;
    capability?: AgentCapability;
  };
  content?: MessageContent;
  text?: string;
  toolName?: string;
  toolArgs?: any;
  timestamp: string;
  metadata?: Record<string, any>;
}

export type WatcherListener = (event: WatcherEvent) => void | Promise<void>;

interface WatcherRecord {
  id: string;
  agentId: string;
  capability: AgentCapability;
  listener: WatcherListener;
}

export class WatcherBridge {
  private readonly watchers = new Map<string, WatcherRecord>();

  constructor(
    private readonly profileResolver: (
      agentId: string,
    ) => Promise<AgentProfileConfig | undefined>,
  ) {}

  async register(options: {
    agentId: string;
    listener: WatcherListener;
  }): Promise<{ id: string; unsubscribe: () => void }> {
    const profile = await this.profileResolver(options.agentId);
    if (!profile) {
      throw new Error(`Unknown agent profile "${options.agentId}"`);
    }

    if (!profile.capabilities.includes("watcher")) {
      throw new Error(
        `Agent "${options.agentId}" is not configured with watcher capability`,
      );
    }

    const id = `${profile.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
    this.watchers.set(id, {
      id,
      agentId: profile.id,
      capability: "watcher",
      listener: options.listener,
    });

    return {
      id,
      unsubscribe: () => this.unregister(id),
    };
  }

  unregister(id: string): void {
    this.watchers.delete(id);
  }

  emit(event: WatcherEvent): void {
    if (this.watchers.size === 0) {
      return;
    }

    for (const record of this.watchers.values()) {
      Promise.resolve()
        .then(() => record.listener(event))
        .catch((error) => {
          logger.warn("Watcher listener failed", {
            agentId: record.agentId,
            error: error?.message || error,
          });
        });
    }
  }

  listActive(): Array<{ id: string; agentId: string }> {
    return Array.from(this.watchers.values()).map((record) => ({
      id: record.id,
      agentId: record.agentId,
    }));
  }

  clear(): void {
    this.watchers.clear();
  }
}
