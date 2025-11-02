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

  const filename = `${session.id}.jsonl`;
  const filepath = join(SESSIONS_DIR, filename);

  try {
    // Update timestamp
    session.updated = new Date().toISOString();
    session.totalMessages = session.conversationHistory.length;

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
      session = JSON.parse(data);
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
