import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MessageContent } from "./agent";
import { upsertAgentSessionContext } from "./agents/context-store";
import type {
  AgentSessionContext,
  AgentSessionStatus,
  SessionBreadcrumb,
  SessionTrigger,
} from "./agents/types";
import type { AgentCapability, PermissionPreset } from "./config";
import { YEET_CONFIG_DIR } from "./config";
import { logger } from "./logger";
import {
  type WorkspaceBinding,
  createDefaultWorkspaceBinding,
} from "./workspace/binding";

export interface Session {
  id: string;
  name?: string;
  created: string;
  updated: string;
  model: string;
  provider: string;
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }>;
  totalMessages: number;
  currentTokens: number;
  parentId?: string;
  agentId?: string;
  agentCapability?: AgentCapability;
  trigger?: SessionTrigger;
  workspace?: WorkspaceBinding;
  permissions?: PermissionPreset;
  breadcrumbs: SessionBreadcrumb[];
  breadcrumbId?: string;
}

export interface CreateSessionOptions {
  name?: string;
  parentId?: string;
  agentId?: string;
  agentCapability?: AgentCapability;
  trigger?: SessionTrigger;
  workspace?: WorkspaceBinding;
  permissions?: PermissionPreset;
  breadcrumbs?: SessionBreadcrumb[];
}

export interface SaveSessionOptions {
  skipParentUpdate?: boolean;
}

const SESSIONS_DIR = join(YEET_CONFIG_DIR, "sessions");
const BREADCRUMB_PREFIX = "bc";

function ensureSessionsDir() {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    logger.info("Created sessions directory", { path: SESSIONS_DIR });
  }
}

function generateSessionId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}-${hour}${minute}${second}${ms}`;
}

function generateBreadcrumbId(sessionId: string): string {
  return `${sessionId}-${BREADCRUMB_PREFIX}-${Date.now().toString(36)}`;
}

export function createSession(
  model: string,
  provider: string,
  options: CreateSessionOptions = {},
): Session {
  const session: Session = {
    id: generateSessionId(),
    name: options.name,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    model,
    provider,
    conversationHistory: [],
    totalMessages: 0,
    currentTokens: 0,
    parentId: options.parentId,
    agentId: options.agentId,
    agentCapability: options.agentCapability,
    trigger: options.trigger,
    workspace: options.workspace,
    permissions: options.permissions,
    breadcrumbs: options.breadcrumbs ?? [],
    breadcrumbId: undefined,
  };

  if (!session.workspace) {
    session.workspace = createDefaultWorkspaceBinding(process.cwd());
  }

  if (
    session.agentCapability === "watcher" &&
    session.workspace &&
    session.workspace.allowWrites !== false
  ) {
    session.workspace.allowWrites = false;
  }

  if (session.parentId) {
    const breadcrumb = appendBreadcrumb(session.parentId, {
      type: session.agentCapability === "watcher" ? "watcher" : "subtask",
      summary: options.trigger
        ? `Started ${session.agentId || "subagent"} via ${options.trigger.type}`
        : `Started ${session.agentId || "subagent"}`,
      childSessionId: session.id,
      metadata: {
        agentId: session.agentId,
        capability: session.agentCapability,
        trigger: options.trigger,
      },
    });
    session.breadcrumbId = breadcrumb?.id;
  }

  syncAgentSessionContext(session, "pending");
  return session;
}

function ensureBreadcrumb(entry: SessionBreadcrumb, sessionId: string) {
  if (!entry.id) {
    entry.id = generateBreadcrumbId(sessionId);
  }
  if (!entry.createdAt) {
    entry.createdAt = new Date().toISOString();
  }
}

export function saveSession(
  session: Session,
  options: SaveSessionOptions = {},
): void {
  ensureSessionsDir();

  const filename = `${session.id}.jsonl`;
  const filepath = join(SESSIONS_DIR, filename);

  try {
    // Update timestamp
    session.updated = new Date().toISOString();
    session.totalMessages = session.conversationHistory.length;
    session.breadcrumbs = (session.breadcrumbs || []).map((entry) => {
      const copy = { ...entry };
      ensureBreadcrumb(copy, session.id);
      return copy;
    });

    // Write session header (metadata)
    const header = {
      type: "session_metadata",
      id: session.id,
      name: session.name,
      created: session.created,
      updated: session.updated,
      model: session.model,
      provider: session.provider,
      totalMessages: session.totalMessages,
      currentTokens: session.currentTokens,
      parentId: session.parentId,
      agentId: session.agentId,
      agentCapability: session.agentCapability,
      trigger: session.trigger,
      workspace: session.workspace,
      permissions: session.permissions,
      breadcrumbs: session.breadcrumbs,
      breadcrumbId: session.breadcrumbId,
    };

    const lines = [JSON.stringify(header)];

    // Write each message as a separate line
    for (const message of session.conversationHistory) {
      const serializedMessage = JSON.stringify(
        {
          type: message.role,
          content: message.content,
        },
        (key, value) => {
          // Convert URL objects to strings
          if (value instanceof URL) {
            return value.href;
          }
          return value;
        },
      );
      lines.push(serializedMessage);
    }

    // Write all lines at once (atomic write)
    writeFileSync(filepath, lines.join("\n") + "\n", "utf-8");

    logger.info("Session saved", {
      id: session.id,
      messages: session.totalMessages,
      tokens: session.currentTokens,
    });

    if (!options.skipParentUpdate) {
      updateParentBreadcrumbFromSession(session);
    }

    const nextStatus: AgentSessionStatus =
      session.agentCapability === "watcher" ? "waiting" : "running";
    syncAgentSessionContext(session, nextStatus);
  } catch (error: any) {
    logger.error("Failed to save session", {
      error: error.message,
      id: session.id,
    });
    throw error;
  }
}

export function loadSession(sessionId: string): Session | null {
  ensureSessionsDir();

  // Try .jsonl first (new format), then .json (legacy format)
  let filepath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const isJsonl = existsSync(filepath);

  if (!isJsonl) {
    filepath = join(SESSIONS_DIR, `${sessionId}.json`);
    if (!existsSync(filepath)) {
      logger.warn("Session not found", { id: sessionId });
      return null;
    }
  }

  try {
    const data = readFileSync(filepath, "utf-8");

    let session: Session;

    if (isJsonl) {
      // Parse JSONL format (line-delimited JSON)
      const lines = data.trim().split("\n");
      if (lines.length === 0) {
        throw new Error("Empty session file");
      }

      // First line is metadata
      const metadata = JSON.parse(lines[0]);
      session = {
        id: metadata.id,
        name: metadata.name,
        created: metadata.created,
        updated: metadata.updated,
        model: metadata.model,
        provider: metadata.provider,
        totalMessages: metadata.totalMessages || 0,
        currentTokens: metadata.currentTokens || 0,
        conversationHistory: [],
        parentId: metadata.parentId,
        agentId: metadata.agentId,
        agentCapability: metadata.agentCapability,
        trigger: metadata.trigger,
        workspace: metadata.workspace,
        permissions: metadata.permissions,
        breadcrumbs:
          Array.isArray(metadata.breadcrumbs) && metadata.breadcrumbs.length > 0
            ? metadata.breadcrumbs
            : [],
        breadcrumbId: metadata.breadcrumbId,
      };

      // Remaining lines are messages
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const msg = JSON.parse(line);
        session.conversationHistory.push({
          role: msg.type as "user" | "assistant",
          content: msg.content,
        });
      }
    } else {
      // Parse legacy JSON format
      session = {
        breadcrumbs: [],
        ...JSON.parse(data),
      };
    }

    // Deserialize: convert image URL strings back to URL objects
    if (session.conversationHistory) {
      for (const message of session.conversationHistory) {
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === "image" && typeof part.image === "string") {
              part.image = new URL(part.image);
            }
          }
        }
      }
    }

    logger.info("Session loaded", {
      id: session.id,
      messages: session.totalMessages,
      format: isJsonl ? "jsonl" : "json",
    });

    session.breadcrumbs = session.breadcrumbs || [];
    if (!session.workspace) {
      session.workspace = createDefaultWorkspaceBinding(process.cwd());
    }

    return session as Session;
  } catch (error: any) {
    logger.error("Failed to load session", {
      error: error.message,
      id: sessionId,
    });
    return null;
  }
}

export function listSessions(): Array<{
  id: string;
  name?: string;
  created: string;
  updated: string;
  model: string;
  totalMessages: number;
}> {
  ensureSessionsDir();

  try {
    const files = readdirSync(SESSIONS_DIR).filter(
      (f) => f.endsWith(".jsonl") || f.endsWith(".json"),
    );

    const sessions = files
      .map((filename) => {
        try {
          const filepath = join(SESSIONS_DIR, filename);
          const data = readFileSync(filepath, "utf-8");

          if (filename.endsWith(".jsonl")) {
            // Parse first line only (metadata)
            const firstLine = data.split("\n")[0];
            const metadata = JSON.parse(firstLine);
            return {
              id: metadata.id,
              name: metadata.name,
              created: metadata.created,
              updated: metadata.updated,
              model: metadata.model,
              totalMessages: metadata.totalMessages || 0,
            };
          } else {
            // Legacy JSON format
            const session = JSON.parse(data);
            return {
              id: session.id,
              name: session.name,
              created: session.created,
              updated: session.updated,
              model: session.model,
              totalMessages: session.totalMessages || 0,
            };
          }
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Sort by most recent first
    sessions.sort((a, b) => {
      return new Date(b.updated).getTime() - new Date(a.updated).getTime();
    });

    return sessions;
  } catch (error: any) {
    logger.error("Failed to list sessions", { error: error.message });
    return [];
  }
}

export function deleteSession(sessionId: string): boolean {
  ensureSessionsDir();

  // Try both formats
  const jsonlPath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const jsonPath = join(SESSIONS_DIR, `${sessionId}.json`);

  let filepath: string | null = null;
  if (existsSync(jsonlPath)) {
    filepath = jsonlPath;
  } else if (existsSync(jsonPath)) {
    filepath = jsonPath;
  }

  if (!filepath) {
    return false;
  }

  try {
    // Bun has unlinkSync via fs
    const fs = require("node:fs");
    fs.unlinkSync(filepath);
    logger.info("Session deleted", { id: sessionId });
    return true;
  } catch (error: any) {
    logger.error("Failed to delete session", {
      error: error.message,
      id: sessionId,
    });
    return false;
  }
}

export function updateSessionName(sessionId: string, name: string): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  session.name = name;
  saveSession(session);
  return true;
}

function extractTextFromContent(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
  }
  return "";
}

function deriveSessionSummary(session: Session): string {
  for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
    const message = session.conversationHistory[i];
    if (message.role !== "assistant") continue;
    const text = extractTextFromContent(message.content);
    if (text && text.trim().length > 0) {
      const trimmed = text.trim();
      return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
    }
  }

  const agentLabel = session.agentId || "subagent";
  return `${agentLabel} updated at ${new Date(session.updated).toLocaleString()}`;
}

function updateParentBreadcrumbFromSession(session: Session): void {
  if (!session.parentId || !session.breadcrumbId) return;

  updateBreadcrumb(session.parentId, session.breadcrumbId, {
    summary: deriveSessionSummary(session),
    metadata: {
      ...(session.trigger ? { trigger: session.trigger } : {}),
      agentId: session.agentId,
      capability: session.agentCapability,
      updatedAt: session.updated,
    },
  });
}

function sessionToContext(
  session: Session,
  status: AgentSessionStatus,
): AgentSessionContext {
  const workspace =
    session.workspace ?? createDefaultWorkspaceBinding(process.cwd());
  if (!session.workspace) {
    session.workspace = workspace;
  }
  return {
    sessionId: session.id,
    agentId: session.agentId || "primary",
    capability: session.agentCapability || "primary",
    parentSessionId: session.parentId,
    trigger: session.trigger,
    workspace,
    permissions: session.permissions,
    status,
    startedAt: session.created,
    updatedAt: new Date().toISOString(),
  };
}

function syncAgentSessionContext(
  session: Session,
  status: AgentSessionStatus,
): void {
  upsertAgentSessionContext(sessionToContext(session, status));
}

export function appendBreadcrumb(
  sessionId: string,
  breadcrumb: SessionBreadcrumb,
): SessionBreadcrumb | null {
  const session = loadSession(sessionId);
  if (!session) return null;

  const entry = { ...breadcrumb };
  ensureBreadcrumb(entry, session.id);
  session.breadcrumbs.push(entry);
  saveSession(session, { skipParentUpdate: true });
  return entry;
}

export function updateBreadcrumb(
  sessionId: string,
  breadcrumbId: string,
  updates: Partial<SessionBreadcrumb>,
): SessionBreadcrumb | null {
  const session = loadSession(sessionId);
  if (!session) return null;

  const idx = session.breadcrumbs.findIndex((b) => b.id === breadcrumbId);
  if (idx === -1) {
    return null;
  }

  const updatedEntry: SessionBreadcrumb = {
    ...session.breadcrumbs[idx],
    ...updates,
    id: session.breadcrumbs[idx].id,
    createdAt: session.breadcrumbs[idx].createdAt,
  };

  session.breadcrumbs[idx] = updatedEntry;
  saveSession(session, { skipParentUpdate: true });
  return updatedEntry;
}

export function listBreadcrumbs(sessionId: string): SessionBreadcrumb[] {
  const session = loadSession(sessionId);
  if (!session) return [];
  return session.breadcrumbs;
}

export function ensureSessionWorkspace(
  session: Session,
  cwd: string,
  allowWrites = true,
): WorkspaceBinding {
  if (!session.workspace) {
    session.workspace = createDefaultWorkspaceBinding(cwd);
    session.workspace.allowWrites = allowWrites;
  }
  return session.workspace;
}
