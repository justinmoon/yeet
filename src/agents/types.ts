import type { AgentCapability, PermissionPreset } from "../config";
import type { WorkspaceBinding } from "../workspace/binding";

export type AgentSessionStatus =
  | "pending"
  | "running"
  | "waiting"
  | "complete"
  | "error";

export interface SessionTrigger {
  type: "tool" | "slash" | "hotkey" | "system";
  value: string;
  metadata?: Record<string, any>;
}

export interface SessionBreadcrumb {
  id?: string;
  type: "subtask" | "watcher" | "notification";
  summary: string;
  createdAt?: string;
  childSessionId?: string;
  metadata?: Record<string, any>;
}

export interface AgentSessionContext {
  sessionId: string;
  agentId: string;
  capability: AgentCapability;
  parentSessionId?: string;
  trigger?: SessionTrigger;
  workspace: WorkspaceBinding;
  permissions?: PermissionPreset;
  status: AgentSessionStatus;
  startedAt: string;
  updatedAt: string;
}
