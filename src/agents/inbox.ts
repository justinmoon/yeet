import type { AgentSessionStatus } from "./types";

export interface InboxUpdate {
  sessionId: string;
  agentId: string;
  capability: string;
  status: AgentSessionStatus;
  summary?: string;
  error?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

type Listener = (update: InboxUpdate) => void;

export class AgentInbox {
  private queue: InboxUpdate[] = [];
  private listeners = new Set<Listener>();

  push(update: InboxUpdate): void {
    this.queue.push(update);
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch {
        // Ignore listener errors
      }
    }
  }

  poll(): InboxUpdate[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
