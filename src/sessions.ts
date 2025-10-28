import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageContent } from "./agent";
import { logger } from "./logger";

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
}

const SESSIONS_DIR = join(homedir(), ".config", "yeet", "sessions");

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

export function createSession(model: string, provider: string): Session {
  return {
    id: generateSessionId(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    model,
    provider,
    conversationHistory: [],
    totalMessages: 0,
    currentTokens: 0,
  };
}

export function saveSession(session: Session): void {
  ensureSessionsDir();

  const filename = `${session.id}.json`;
  const filepath = join(SESSIONS_DIR, filename);
  const tempFilepath = `${filepath}.tmp`;

  try {
    // Update timestamp
    session.updated = new Date().toISOString();
    session.totalMessages = session.conversationHistory.length;

    // Serialize session (handle URL objects in images)
    const serialized = JSON.stringify(
      session,
      (key, value) => {
        // Convert URL objects to strings
        if (value instanceof URL) {
          return value.href;
        }
        return value;
      },
      2,
    );

    // Write to temp file first, then rename (atomic on most systems)
    writeFileSync(tempFilepath, serialized, "utf-8");
    writeFileSync(filepath, serialized, "utf-8");

    // Clean up temp file
    if (existsSync(tempFilepath)) {
      // Bun doesn't have unlinkSync in the same way
      try {
        writeFileSync(tempFilepath, "");
      } catch {
        // Ignore cleanup errors
      }
    }

    logger.info("Session saved", {
      id: session.id,
      messages: session.totalMessages,
      tokens: session.currentTokens,
    });
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

  const filename = `${sessionId}.json`;
  const filepath = join(SESSIONS_DIR, filename);

  if (!existsSync(filepath)) {
    logger.warn("Session not found", { id: sessionId });
    return null;
  }

  try {
    const data = readFileSync(filepath, "utf-8");
    const session = JSON.parse(data);

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
    });

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
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));

    const sessions = files
      .map((filename) => {
        try {
          const filepath = join(SESSIONS_DIR, filename);
          const data = readFileSync(filepath, "utf-8");
          const session = JSON.parse(data);
          return {
            id: session.id,
            name: session.name,
            created: session.created,
            updated: session.updated,
            model: session.model,
            totalMessages: session.totalMessages || 0,
          };
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

  const filename = `${sessionId}.json`;
  const filepath = join(SESSIONS_DIR, filename);

  if (!existsSync(filepath)) {
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
