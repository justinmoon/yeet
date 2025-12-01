import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  // Event log types and functions
  type EventLog,
  type LogEntry,
  createEventLog,
  addLogEntry,
  logStateTransition,
  logToolCall,
  logAskUser,
  logUserResponse,
  logError,
  logErrorRecovered,
  logStepChange,
  logLifecycle,
  updateLogState,
  serializeLog,
  parseLog,
  LogParseError,
  getLogSummary,
} from "../../src/plan/event-log";
import {
  // Persistence functions
  getLogPath,
  getTranscriptsDir,
  saveLog,
  loadLog,
  deleteLog,
  resumeOrchestration,
  syncLogState,
  createTranscriptPath,
  saveTranscript,
  loadTranscript,
} from "../../src/plan/persistence";
import { FlowMachine } from "../../src/plan";

describe("Event Log", () => {
  describe("createEventLog", () => {
    test("creates empty log with correct structure", () => {
      const log = createEventLog("/path/to/plan.md", "1");

      expect(log.version).toBe(1);
      expect(log.planPath).toBe("/path/to/plan.md");
      expect(log.activeStep).toBe("1");
      expect(log.currentState).toBe("coder_active");
      expect(log.changeRequestCount).toBe(0);
      expect(log.completed).toBe(false);
      expect(log.entries).toEqual([]);
      expect(log.startedAt).toBeGreaterThan(0);
      expect(log.updatedAt).toBeGreaterThanOrEqual(log.startedAt);
    });
  });

  describe("logStateTransition", () => {
    test("adds state transition entry", () => {
      let log = createEventLog("/plan.md", "1");

      log = logStateTransition(log, "coder_active", "reviewer_active", {
        type: "request_review",
      });

      expect(log.entries.length).toBe(1);
      expect(log.entries[0].type).toBe("state_transition");
      const entry = log.entries[0] as any;
      expect(entry.fromState).toBe("coder_active");
      expect(entry.toState).toBe("reviewer_active");
      expect(entry.event.type).toBe("request_review");
    });
  });

  describe("logToolCall", () => {
    test("adds tool call entry", () => {
      let log = createEventLog("/plan.md", "1");

      log = logToolCall(log, "coder", "edit", { path: "/file.ts" }, "success", 100);

      expect(log.entries.length).toBe(1);
      expect(log.entries[0].type).toBe("tool_call");
      const entry = log.entries[0] as any;
      expect(entry.agent).toBe("coder");
      expect(entry.toolName).toBe("edit");
      expect(entry.args).toEqual({ path: "/file.ts" });
      expect(entry.result).toBe("success");
      expect(entry.duration).toBe(100);
    });

    test("includes transcript path when provided", () => {
      let log = createEventLog("/plan.md", "1");

      log = logToolCall(
        log,
        "reviewer",
        "bash",
        { command: "npm test" },
        undefined,
        undefined,
        "/transcripts/test.json",
      );

      const entry = log.entries[0] as any;
      expect(entry.transcriptPath).toBe("/transcripts/test.json");
    });
  });

  describe("logAskUser and logUserResponse", () => {
    test("logs ask-user prompt", () => {
      let log = createEventLog("/plan.md", "1");

      log = logAskUser(log, "coder", "Which approach?");

      expect(log.entries.length).toBe(1);
      expect(log.entries[0].type).toBe("ask_user");
      const entry = log.entries[0] as any;
      expect(entry.agent).toBe("coder");
      expect(entry.message).toBe("Which approach?");
      expect(entry.response).toBeUndefined();
    });

    test("updates with user response", () => {
      let log = createEventLog("/plan.md", "1");
      log = logAskUser(log, "coder", "Which approach?");
      log = logUserResponse(log, "Use approach A");

      const entry = log.entries[0] as any;
      expect(entry.response).toBe("Use approach A");
      expect(entry.responseTimestamp).toBeGreaterThan(0);
    });
  });

  describe("logError and logErrorRecovered", () => {
    test("logs error", () => {
      let log = createEventLog("/plan.md", "1");

      log = logError(log, "API timeout", "Error: API timeout\n  at...");

      expect(log.entries.length).toBe(1);
      const entry = log.entries[0] as any;
      expect(entry.type).toBe("error");
      expect(entry.error).toBe("API timeout");
      expect(entry.stack).toContain("Error: API timeout");
    });

    test("marks error as recovered", () => {
      let log = createEventLog("/plan.md", "1");
      log = logError(log, "API timeout");
      log = logErrorRecovered(log);

      const entry = log.entries[0] as any;
      expect(entry.recovered).toBe(true);
    });
  });

  describe("logStepChange", () => {
    test("logs step change and updates activeStep", () => {
      let log = createEventLog("/plan.md", "1");

      log = logStepChange(log, "1", "2", "approved");

      expect(log.activeStep).toBe("2");
      expect(log.entries.length).toBe(1);
      const entry = log.entries[0] as any;
      expect(entry.type).toBe("step_change");
      expect(entry.fromStep).toBe("1");
      expect(entry.toStep).toBe("2");
      expect(entry.reason).toBe("approved");
    });
  });

  describe("logLifecycle", () => {
    test("logs started event", () => {
      let log = createEventLog("/plan.md", "1");

      log = logLifecycle(log, "started", 5);

      expect(log.entries.length).toBe(1);
      const entry = log.entries[0] as any;
      expect(entry.type).toBe("lifecycle");
      expect(entry.action).toBe("started");
      expect(entry.totalSteps).toBe(5);
    });

    test("logs completed event and sets completed flag", () => {
      let log = createEventLog("/plan.md", "1");

      log = logLifecycle(log, "completed");

      expect(log.completed).toBe(true);
    });

    test("logs aborted event and sets completed flag", () => {
      let log = createEventLog("/plan.md", "1");

      log = logLifecycle(log, "aborted");

      expect(log.completed).toBe(true);
    });
  });

  describe("updateLogState", () => {
    test("updates state fields", () => {
      let log = createEventLog("/plan.md", "1");

      log = updateLogState(log, {
        activeStep: "3",
        currentState: "reviewer_active",
        changeRequestCount: 2,
      });

      expect(log.activeStep).toBe("3");
      expect(log.currentState).toBe("reviewer_active");
      expect(log.changeRequestCount).toBe(2);
    });

    test("partial updates preserve other fields", () => {
      let log = createEventLog("/plan.md", "1");
      log = updateLogState(log, { changeRequestCount: 2 });

      log = updateLogState(log, { activeStep: "2" });

      expect(log.activeStep).toBe("2");
      expect(log.changeRequestCount).toBe(2);
    });
  });

  describe("serializeLog and parseLog", () => {
    test("serializes to valid JSON", () => {
      let log = createEventLog("/plan.md", "1");
      log = logStateTransition(log, "coder_active", "reviewer_active", {
        type: "request_review",
      });

      const json = serializeLog(log);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(1);
      expect(parsed.entries.length).toBe(1);
    });

    test("parseLog restores log", () => {
      let log = createEventLog("/plan.md", "step-5");
      log = updateLogState(log, { changeRequestCount: 3 });

      const json = serializeLog(log);
      const parsed = parseLog(json);

      expect(parsed.planPath).toBe("/plan.md");
      expect(parsed.activeStep).toBe("step-5");
      expect(parsed.changeRequestCount).toBe(3);
    });

    test("parseLog throws on invalid version", () => {
      const json = JSON.stringify({ version: 99 });

      expect(() => parseLog(json)).toThrow(LogParseError);
      expect(() => parseLog(json)).toThrow("Unsupported log version");
    });

    test("parseLog throws on missing planPath", () => {
      const json = JSON.stringify({ version: 1, activeStep: "1", entries: [] });

      expect(() => parseLog(json)).toThrow(LogParseError);
      expect(() => parseLog(json)).toThrow("planPath");
    });

    test("parseLog throws on invalid JSON", () => {
      expect(() => parseLog("not json")).toThrow(LogParseError);
    });

    test("parseLog throws on invalid currentState", () => {
      const json = JSON.stringify({
        version: 1,
        planPath: "/plan.md",
        activeStep: "1",
        currentState: "invalid_state",
        entries: [],
      });

      expect(() => parseLog(json)).toThrow(LogParseError);
      expect(() => parseLog(json)).toThrow("Invalid currentState");
    });
  });

  describe("getLogSummary", () => {
    test("counts entries by type", () => {
      let log = createEventLog("/plan.md", "1");
      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = logStateTransition(log, "reviewer_active", "coder_active", { type: "approve" });
      log = logToolCall(log, "coder", "edit", {});
      log = logToolCall(log, "coder", "bash", {});
      log = logToolCall(log, "reviewer", "read", {});
      log = logAskUser(log, "coder", "Question?");
      log = logError(log, "Error");
      log = logStepChange(log, "1", "2", "approved");

      const summary = getLogSummary(log);

      expect(summary.totalTransitions).toBe(2);
      expect(summary.totalToolCalls).toBe(3);
      expect(summary.totalAskUser).toBe(1);
      expect(summary.totalErrors).toBe(1);
      expect(summary.totalStepChanges).toBe(1);
    });
  });
});

describe("Persistence", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "persistence-test-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps
- Step 1
- Step 2
`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("getLogPath", () => {
    test("returns path in .orchestration directory", () => {
      const logPath = getLogPath("/docs/feature/plan.md");

      expect(logPath).toBe("/docs/feature/.orchestration/orchestration.log.json");
    });
  });

  describe("getTranscriptsDir", () => {
    test("returns transcripts subdirectory", () => {
      const dir = getTranscriptsDir("/docs/feature/plan.md");

      expect(dir).toBe("/docs/feature/.orchestration/transcripts");
    });
  });

  describe("saveLog and loadLog", () => {
    test("saves and loads log", async () => {
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");

      await saveLog(planPath, log);
      const loaded = await loadLog(planPath);

      expect(loaded).not.toBeNull();
      expect(loaded!.planPath).toBe(planPath);
      expect(loaded!.entries.length).toBe(1);
    });

    test("loadLog returns null for non-existent log", async () => {
      const loaded = await loadLog(planPath);

      expect(loaded).toBeNull();
    });

    test("creates log directory if it doesn't exist", async () => {
      const log = createEventLog(planPath, "1");

      await saveLog(planPath, log);

      const logPath = getLogPath(planPath);
      expect(existsSync(logPath)).toBe(true);
    });
  });

  describe("deleteLog", () => {
    test("deletes existing log", async () => {
      const log = createEventLog(planPath, "1");
      await saveLog(planPath, log);

      await deleteLog(planPath);

      const loaded = await loadLog(planPath);
      expect(loaded).toBeNull();
    });

    test("handles non-existent log gracefully", async () => {
      // Should not throw
      await deleteLog(planPath);
    });
  });

  describe("resumeOrchestration", () => {
    test("starts fresh when no log exists", async () => {
      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(true);
      expect(result.flowMachine).toBeDefined();
      expect(result.flowMachine!.getState()).toBe("coder_active");
      expect(result.flowMachine!.getContext().activeStep).toBe("1");
    });

    test("resumes from existing log", async () => {
      // Create and save a log with some state
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = updateLogState(log, {
        activeStep: "2",
        currentState: "reviewer_active",
        changeRequestCount: 1,
      });
      await saveLog(planPath, log);

      // Update plan frontmatter to match
      await writeFile(
        planPath,
        `---
active_step: "2"
---

## Steps
- Step 1
- Step 2
`,
      );

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(false);
      expect(result.flowMachine!.getState()).toBe("reviewer_active");
    });

    test("starts fresh when log is completed", async () => {
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "completed");
      await saveLog(planPath, log);

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(true);
    });

    test("handles corrupted log gracefully", async () => {
      // Write corrupted log
      const logPath = getLogPath(planPath);
      await mkdir(join(tmpDir, ".orchestration"), { recursive: true });
      await writeFile(logPath, "not valid json");

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(true);
      expect(result.error).toContain("corrupted");
    });

    test("syncs activeStep from plan frontmatter", async () => {
      // Create log with step 1
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      await saveLog(planPath, log);

      // Update plan to step 2
      await writeFile(
        planPath,
        `---
active_step: "2"
---

## Steps
`,
      );

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      // Should sync to plan's active_step
      expect(result.log.activeStep).toBe("2");
    });

    test("handles missing plan gracefully", async () => {
      await rm(planPath);

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to load plan");
    });

    test("restores changeRequestCount directly without triggering loop guard", async () => {
      // Create log with changeRequestCount > maxChangeRequests (default 3)
      // This would have tripped the loop guard if we replayed events
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = updateLogState(log, {
        activeStep: "1",
        currentState: "coder_active",
        changeRequestCount: 5, // More than default maxChangeRequests (3)
      });
      await saveLog(planPath, log);

      const result = await resumeOrchestration(planPath);

      // Should succeed without triggering loop guard
      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(false);
      // Should NOT be in awaiting_user_input (which would indicate loop guard triggered)
      expect(result.flowMachine!.getState()).toBe("coder_active");
      // Counter should be restored
      expect(result.flowMachine!.getChangeRequestCount()).toBe(5);
    });

    test("restores changeRequestCount when resuming in reviewer_active state", async () => {
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = updateLogState(log, {
        activeStep: "1",
        currentState: "reviewer_active",
        changeRequestCount: 2,
      });
      await saveLog(planPath, log);

      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.flowMachine!.getState()).toBe("reviewer_active");
      expect(result.flowMachine!.getChangeRequestCount()).toBe(2);
    });
  });

  describe("syncLogState", () => {
    test("updates log from flow machine state", async () => {
      const log = createEventLog(planPath, "1");
      const flowMachine = new FlowMachine({ initialStep: "1" });

      await flowMachine.send({ type: "request_review" });

      const synced = syncLogState(log, flowMachine);

      expect(synced.currentState).toBe("reviewer_active");
    });
  });

  describe("transcripts", () => {
    test("createTranscriptPath generates unique path", () => {
      const path1 = createTranscriptPath(planPath, "coder", "edit", 1000);
      const path2 = createTranscriptPath(planPath, "coder", "edit", 1001);

      expect(path1).not.toBe(path2);
      expect(path1).toContain("coder_edit_1000.json");
    });

    test("saveTranscript and loadTranscript work", async () => {
      const path = createTranscriptPath(planPath, "coder", "bash", Date.now());
      const content = { command: "npm test", output: "All tests passed" };

      await saveTranscript(path, content);
      const loaded = await loadTranscript(path);

      expect(loaded).toEqual(content);
    });

    test("loadTranscript returns null for non-existent file", async () => {
      const loaded = await loadTranscript("/non/existent/path.json");

      expect(loaded).toBeNull();
    });
  });
});

describe("Integration: Full Persistence Cycle", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "persistence-integration-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps
- Step 1: Setup
- Step 2: Implementation
- Step 3: Testing
`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("full orchestration flow with persistence", async () => {
    // Start orchestration
    let result = await resumeOrchestration(planPath);
    expect(result.success).toBe(true);
    expect(result.isFreshStart).toBe(true);

    let log = result.log;
    const machine = result.flowMachine!;

    // Coder works and requests review
    log = logToolCall(log, "coder", "edit", { path: "src/main.ts" });
    await machine.send({ type: "request_review" });
    log = logStateTransition(log, "coder_active", "reviewer_active", {
      type: "request_review",
    });
    log = syncLogState(log, machine);

    // Reviewer requests changes
    await machine.send({ type: "request_changes", reason: "Fix bug" });
    log = logStateTransition(log, "reviewer_active", "coder_active", {
      type: "request_changes",
      reason: "Fix bug",
    });
    log = syncLogState(log, machine);

    // Save log
    await saveLog(planPath, log);

    // Simulate restart - resume from log
    result = await resumeOrchestration(planPath);
    expect(result.success).toBe(true);
    expect(result.isFreshStart).toBe(false);

    // Should restore to coder_active state
    expect(result.flowMachine!.getState()).toBe("coder_active");
    expect(result.log.entries.length).toBeGreaterThan(0);
  });
});
