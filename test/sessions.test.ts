import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
  updateSessionName,
} from "../src/sessions";

const TEST_SESSIONS_DIR = join(process.cwd(), ".test-sessions");

// Mock homedir to use test directory
const originalHomedir = require("node:os").homedir;
beforeEach(() => {
  require("node:os").homedir = () => process.cwd();
  process.env.HOME = process.cwd();

  // Clean up test directory
  if (existsSync(join(process.cwd(), ".config"))) {
    rmSync(join(process.cwd(), ".config"), { recursive: true });
  }
});

afterEach(() => {
  require("node:os").homedir = originalHomedir;
  // Clean up test directory
  if (existsSync(join(process.cwd(), ".config"))) {
    rmSync(join(process.cwd(), ".config"), { recursive: true });
  }
});

describe("Session Management", () => {
  test("create new session", () => {
    const session = createSession("grok-code", "opencode");

    expect(session.id).toBeDefined();
    expect(session.model).toBe("grok-code");
    expect(session.provider).toBe("opencode");
    expect(session.conversationHistory).toEqual([]);
    expect(session.totalMessages).toBe(0);
    expect(session.currentTokens).toBe(0);
  });

  test("save and load session", () => {
    const session = createSession("claude-sonnet-4-5", "opencode");
    session.conversationHistory = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ];
    session.currentTokens = 50;

    saveSession(session);

    const loaded = loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.model).toBe("claude-sonnet-4-5");
    expect(loaded?.conversationHistory.length).toBe(2);
    expect(loaded?.currentTokens).toBe(50);
  });

  test("save session with multimodal content", () => {
    const session = createSession("claude-haiku-4-5", "opencode");
    session.conversationHistory = [
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          { type: "image", image: new URL("data:image/png;base64,abc123") },
        ],
      },
    ];

    saveSession(session);

    const loaded = loadSession(session.id);
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded?.conversationHistory[0].content)).toBe(true);

    const content = loaded?.conversationHistory[0].content as any[];
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image");
    expect(content[1].image).toBeInstanceOf(URL);
  });

  test("list sessions", () => {
    const session1 = createSession("grok-code", "opencode");
    // Add small delay to ensure different IDs
    const session2 = createSession("claude-sonnet-4-5", "opencode");

    session1.conversationHistory = [{ role: "user", content: "Test 1" }];
    session2.conversationHistory = [
      { role: "user", content: "Test 2" },
      { role: "assistant", content: "Response 2" },
    ];

    saveSession(session1);
    saveSession(session2);

    const sessions = listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    // Find our sessions
    const foundSession1 = sessions.find((s) => s.id === session1.id);
    const foundSession2 = sessions.find((s) => s.id === session2.id);

    expect(foundSession1).toBeDefined();
    expect(foundSession2).toBeDefined();
  });

  test("delete session", () => {
    const session = createSession("grok-code", "opencode");
    saveSession(session);

    expect(loadSession(session.id)).not.toBeNull();

    const deleted = deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(loadSession(session.id)).toBeNull();
  });

  test("update session name", () => {
    const session = createSession("grok-code", "opencode");
    saveSession(session);

    const updated = updateSessionName(session.id, "My Important Session");
    expect(updated).toBe(true);

    const loaded = loadSession(session.id);
    expect(loaded?.name).toBe("My Important Session");
  });

  test("load non-existent session", () => {
    const loaded = loadSession("non-existent-id");
    expect(loaded).toBeNull();
  });

  test("delete non-existent session", () => {
    const deleted = deleteSession("non-existent-id");
    expect(deleted).toBe(false);
  });

  test("save and load multiple sessions sequentially", () => {
    // Create 5 sessions to simulate multiple agents
    const sessions = Array.from({ length: 5 }, (_, i) => {
      const session = createSession("claude-sonnet-4-5", "opencode");
      session.conversationHistory = [
        { role: "user", content: `Agent ${i} request` },
        { role: "assistant", content: `Agent ${i} response` },
      ];
      saveSession(session);
      return session;
    });

    // Verify all sessions were saved correctly
    for (const session of sessions) {
      const loaded = loadSession(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(session.id);
      expect(loaded?.conversationHistory.length).toBe(2);
    }
  });

  test("sequential session updates", () => {
    const session = createSession("claude-sonnet-4-5", "opencode");
    saveSession(session);

    // Simulate sequential updates to the same session
    for (let i = 0; i < 10; i++) {
      const loaded = loadSession(session.id);
      if (loaded) {
        loaded.conversationHistory.push({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i}`,
        });
        saveSession(loaded);
      }
    }

    const final = loadSession(session.id);
    expect(final).not.toBeNull();
    expect(final?.conversationHistory.length).toBe(10);
  });

  test("load multiple sessions", () => {
    // Create and save multiple sessions
    const sessions = Array.from({ length: 5 }, (_, i) => {
      const session = createSession("grok-code", "opencode");
      session.conversationHistory = [{ role: "user", content: `Test ${i}` }];
      saveSession(session);
      return session;
    });

    // Load all
    const loaded = sessions.map((s) => loadSession(s.id));

    // Verify all loaded correctly
    expect(loaded.every((s) => s !== null)).toBe(true);
    expect(loaded.length).toBe(5);
  });

  test("handle session deletion while preserving others", () => {
    const session1 = createSession("claude-sonnet-4-5", "opencode");
    session1.conversationHistory = [{ role: "user", content: "Test 1" }];
    saveSession(session1);

    // Verify save
    expect(loadSession(session1.id)).not.toBeNull();

    // Delete session
    const deleted = deleteSession(session1.id);
    expect(deleted).toBe(true);

    // Verify deletion
    expect(loadSession(session1.id)).toBeNull();

    // Create a new session after deletion to verify isolation
    const session2 = createSession("grok-code", "opencode");
    session2.conversationHistory = [{ role: "user", content: "Test 2" }];
    saveSession(session2);

    // Verify new session works independently
    const loaded2 = loadSession(session2.id);
    expect(loaded2).not.toBeNull();
    expect(loaded2?.conversationHistory[0].content).toBe("Test 2");
  });

  test("session with large conversation history", () => {
    const session = createSession("claude-sonnet-4-5", "opencode");

    // Simulate a long conversation (100 messages)
    for (let i = 0; i < 100; i++) {
      session.conversationHistory.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i} with some content that simulates a real conversation`,
      });
    }

    saveSession(session);
    const loaded = loadSession(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.conversationHistory.length).toBe(100);
    expect(loaded?.conversationHistory[0].content).toBe(
      "Message 0 with some content that simulates a real conversation",
    );
    expect(loaded?.conversationHistory[99].content).toBe(
      "Message 99 with some content that simulates a real conversation",
    );
  });

  test("session persistence across multiple save/load cycles", () => {
    const session = createSession("grok-code", "opencode");
    session.conversationHistory = [{ role: "user", content: "Initial" }];
    saveSession(session);

    // Save and reload multiple times
    for (let i = 0; i < 5; i++) {
      const loaded = loadSession(session.id);
      expect(loaded).not.toBeNull();

      if (loaded) {
        loaded.conversationHistory.push({
          role: "assistant",
          content: `Response ${i}`,
        });

        saveSession(loaded);
      }
    }

    const final = loadSession(session.id);
    expect(final?.conversationHistory.length).toBe(6); // 1 initial + 5 responses
  });
});
