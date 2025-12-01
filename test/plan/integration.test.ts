/**
 * Integration tests for coder/reviewer orchestration.
 *
 * These tests simulate the full orchestration flow:
 * coder → request_review → reviewer → request_changes → coder → request_review → reviewer → approve
 *
 * Tests verify:
 * - Complete flow execution with state transitions
 * - Event logging throughout the flow
 * - Transcript generation for tool calls
 * - Resume capability mid-flow
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Flow machine
import { FlowMachine } from "../../src/plan/flow-machine";
import type { FlowState } from "../../src/plan/flow-types";

// Event log
import {
  createEventLog,
  logStateTransition,
  logToolCall,
  logAskUser,
  logUserResponse,
  logStepChange,
  logLifecycle,
  updateLogState,
  getLogSummary,
  type EventLog,
} from "../../src/plan/event-log";

// Persistence
import {
  saveLog,
  loadLog,
  getLogPath,
  resumeOrchestration,
  syncLogState,
  createTranscriptPath,
  saveTranscript,
  loadTranscript,
  getTranscriptsDir,
} from "../../src/plan/persistence";

// Tools
import {
  requestReview,
  requestChanges,
  approve,
  createAskUserTool,
} from "../../src/plan/tools";

// Tool executor
import {
  ToolExecutor,
  createArrayStepResolver,
} from "../../src/plan/tool-executor";

// UI state
import {
  createOrchestrationUIState,
  reduceOrchestrationUIState,
  type OrchestrationUIState,
} from "../../src/plan/ui-state";

// UI renderer
import { formatOrchestrationStatus } from "../../src/plan/ui-renderer";

/**
 * Helper to execute an AI SDK tool.
 */
async function executeTool(
  tool: { execute: (args: Record<string, unknown>, options: unknown) => Promise<unknown> },
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return tool.execute(args, {});
}

describe("Integration: Full Orchestration Flow", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-integration-"));
    planPath = join(tmpDir, "plan.md");

    // Create a plan file with 3 steps
    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps

1. Implement authentication module
2. Add user profile page
3. Write integration tests
`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("Complete Flow: coder → reviewer → changes → coder → reviewer → approve", () => {
    test("executes full orchestration flow with logging", async () => {
      // Initialize components
      const flowMachine = new FlowMachine({
        initialStep: "1",
        hasMoreSteps: true,
      });

      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started", 3);

      let uiState = createOrchestrationUIState(planPath, "1", 3);

      // Verify initial state
      expect(flowMachine.getState()).toBe("coder_active");
      expect(uiState.activeAgent).toBe("coder");
      expect(formatOrchestrationStatus(uiState)).toContain("Coder");

      // Step 1: Coder works and requests review
      log = logToolCall(log, "coder", "edit", { path: "src/auth.ts" }, "success", 150);
      log = logToolCall(log, "coder", "bash", { command: "npm test" }, "tests pass", 2000);

      // Coder calls request_review
      const reviewResult = await flowMachine.send({ type: "request_review" });
      expect(reviewResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("reviewer_active");

      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, { type: "agent_changed", agent: "reviewer" });
      expect(formatOrchestrationStatus(uiState)).toContain("Reviewer");

      // Step 2: Reviewer reviews and requests changes
      log = logToolCall(log, "reviewer", "read", { path: "src/auth.ts" }, "file contents", 50);

      // Reviewer requests changes
      const changesResult = await flowMachine.send({
        type: "request_changes",
        reason: "Missing error handling in login function",
      });
      expect(changesResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("coder_active");
      expect(flowMachine.getChangeRequestCount()).toBe(1);

      log = logStateTransition(log, "reviewer_active", "coder_active", {
        type: "request_changes",
        reason: "Missing error handling",
      });
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, { type: "change_request", count: 1 });
      uiState = reduceOrchestrationUIState(uiState, { type: "agent_changed", agent: "coder" });
      expect(formatOrchestrationStatus(uiState)).toContain("Changes: 1");

      // Step 3: Coder addresses changes and requests review again
      log = logToolCall(log, "coder", "edit", { path: "src/auth.ts" }, "added error handling", 100);

      const review2Result = await flowMachine.send({ type: "request_review" });
      expect(review2Result.success).toBe(true);
      expect(flowMachine.getState()).toBe("reviewer_active");

      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, { type: "agent_changed", agent: "reviewer" });

      // Step 4: Reviewer approves
      flowMachine.setHasMoreSteps(true); // More steps exist
      const approveResult = await flowMachine.send({ type: "approve" });
      expect(approveResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("coder_active");

      log = logStateTransition(log, "reviewer_active", "coder_active", { type: "approve" });

      // Advance to step 2
      flowMachine.advanceStep("2", true);
      log = logStepChange(log, "1", "2", "approved");
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, { type: "step_changed", step: "2", totalSteps: 3 });
      uiState = reduceOrchestrationUIState(uiState, { type: "agent_changed", agent: "coder" });
      expect(uiState.activeStep).toBe("2");
      expect(uiState.changeRequestCount).toBe(0); // Reset on step change

      // Save log
      await saveLog(planPath, log);

      // Verify log was created
      const logPath = getLogPath(planPath);
      expect(existsSync(logPath)).toBe(true);

      // Verify log summary
      const summary = getLogSummary(log);
      expect(summary.totalTransitions).toBe(4);
      expect(summary.totalToolCalls).toBe(4);
      expect(summary.totalStepChanges).toBe(1);
    });

    test("produces transcripts for tool calls", async () => {
      const flowMachine = new FlowMachine({ initialStep: "1" });
      let log = createEventLog(planPath, "1");

      // Simulate a tool call with transcript
      const timestamp = Date.now();
      const transcriptPath = createTranscriptPath(planPath, "coder", "bash", timestamp);

      const transcriptContent = {
        command: "npm test",
        output: "All 42 tests passed",
        exitCode: 0,
        duration: 1500,
      };

      await saveTranscript(transcriptPath, transcriptContent);

      // Log tool call with transcript reference
      log = logToolCall(
        log,
        "coder",
        "bash",
        { command: "npm test" },
        "42 tests passed",
        1500,
        transcriptPath,
      );

      // Verify transcript was saved
      const loaded = await loadTranscript(transcriptPath);
      expect(loaded).toEqual(transcriptContent);

      // Verify transcript path is in log entry
      const toolEntry = log.entries[0];
      expect(toolEntry.type).toBe("tool_call");
      if (toolEntry.type === "tool_call") {
        expect(toolEntry.transcriptPath).toBe(transcriptPath);
      }
    });

    test("handles ask_user flow with logging", async () => {
      const flowMachine = new FlowMachine({ initialStep: "1" });
      let log = createEventLog(planPath, "1");
      let uiState = createOrchestrationUIState(planPath, "1");

      // Coder asks user a question
      const askResult = await flowMachine.send({
        type: "ask_user",
        message: "Which database should I use: PostgreSQL or MongoDB?",
      });
      expect(askResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("awaiting_user_input");

      log = logAskUser(log, "coder", "Which database should I use: PostgreSQL or MongoDB?");
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, {
        type: "awaiting_user",
        prompt: "Which database?",
      });
      expect(uiState.awaitingUser).toBe(true);
      expect(formatOrchestrationStatus(uiState)).toContain("Waiting for user");

      // User replies
      const replyResult = await flowMachine.send({
        type: "user_reply",
        response: "Use PostgreSQL for this project",
      });
      expect(replyResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("coder_active");

      log = logUserResponse(log, "Use PostgreSQL for this project");
      log = syncLogState(log, flowMachine);

      uiState = reduceOrchestrationUIState(uiState, { type: "user_replied" });
      expect(uiState.awaitingUser).toBe(false);

      // Verify ask_user entry has response
      const askEntry = log.entries.find((e) => e.type === "ask_user");
      expect(askEntry).toBeDefined();
      if (askEntry?.type === "ask_user") {
        expect(askEntry.response).toBe("Use PostgreSQL for this project");
        expect(askEntry.responseTimestamp).toBeGreaterThan(0);
      }
    });
  });

  describe("Resume Mid-Flow", () => {
    test("resumes after coder requests review", async () => {
      // Setup: Create log state after coder requested review
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = logToolCall(log, "coder", "edit", { path: "src/main.ts" });
      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = updateLogState(log, {
        currentState: "reviewer_active",
        changeRequestCount: 0,
      });
      await saveLog(planPath, log);

      // Resume
      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.isFreshStart).toBe(false);
      expect(result.flowMachine!.getState()).toBe("reviewer_active");

      // Can continue the flow
      const changesResult = await result.flowMachine!.send({
        type: "request_changes",
        reason: "Fix typo",
      });
      expect(changesResult.success).toBe(true);
      expect(result.flowMachine!.getState()).toBe("coder_active");
    });

    test("resumes after change request with counter preserved", async () => {
      // Setup: Create log state after 2 change requests
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = updateLogState(log, {
        currentState: "coder_active",
        changeRequestCount: 2,
      });
      await saveLog(planPath, log);

      // Resume
      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.flowMachine!.getChangeRequestCount()).toBe(2);

      // Continue flow - request review
      await result.flowMachine!.send({ type: "request_review" });

      // One more change request should work (count becomes 3)
      const changes3 = await result.flowMachine!.send({
        type: "request_changes",
        reason: "Another fix",
      });
      expect(changes3.success).toBe(true);
      expect(result.flowMachine!.getState()).toBe("coder_active");
      expect(result.flowMachine!.getChangeRequestCount()).toBe(3);

      // Request review again
      await result.flowMachine!.send({ type: "request_review" });

      // Fourth change request triggers loop guard
      const changes4 = await result.flowMachine!.send({
        type: "request_changes",
        reason: "Yet another fix",
      });
      expect(changes4.success).toBe(true);
      expect(result.flowMachine!.getState()).toBe("awaiting_user_input");
    });

    test("resumes in awaiting_user_input state", async () => {
      // Setup: Create log state in awaiting_user_input
      let log = createEventLog(planPath, "1");
      log = logLifecycle(log, "started");
      log = logAskUser(log, "coder", "Which approach?");
      log = updateLogState(log, {
        currentState: "awaiting_user_input",
      });
      await saveLog(planPath, log);

      // Resume
      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      expect(result.flowMachine!.getState()).toBe("awaiting_user_input");

      // User can reply
      const replyResult = await result.flowMachine!.send({
        type: "user_reply",
        response: "Use approach A",
      });
      expect(replyResult.success).toBe(true);
      // Note: without awaitingReplyFrom context, defaults to coder
      expect(result.flowMachine!.getState()).toBe("coder_active");
    });

    test("resumes with step sync from plan frontmatter", async () => {
      // Setup: Create log with step 1, but plan has step 2
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
1. Done
2. Current
3. Next
`,
      );

      // Resume
      const result = await resumeOrchestration(planPath);

      expect(result.success).toBe(true);
      // Should sync to plan's active_step
      expect(result.log.activeStep).toBe("2");
      expect(result.flowMachine!.getContext().activeStep).toBe("2");
    });
  });

  describe("Tool Executor Integration", () => {
    test("executes tools and dispatches flow events", async () => {
      const flowMachine = new FlowMachine({ initialStep: "1", hasMoreSteps: true });
      const steps = ["1", "2", "3"];

      const executor = new ToolExecutor(
        flowMachine,
        planPath,
        createArrayStepResolver(steps),
      );

      // Execute request_review
      const reviewAction = await executeTool(requestReview, {});
      expect(reviewAction).toEqual({ action: "request_review" });

      const reviewResult = await executor.execute(reviewAction as { action: string });
      expect(reviewResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("reviewer_active");

      // Execute request_changes
      const changesAction = await executeTool(requestChanges, { reason: "Fix bug" });
      expect(changesAction).toEqual({ action: "request_changes", reason: "Fix bug" });

      const changesResult = await executor.execute(changesAction as { action: string; reason?: string });
      expect(changesResult.success).toBe(true);
      expect(flowMachine.getState()).toBe("coder_active");
      expect(executor.getChangeRequestCount()).toBe(1);

      // Execute request_review again
      await executor.execute({ action: "request_review" });

      // Execute approve - should advance to step 2
      const approveAction = await executeTool(approve, {});
      const approveResult = await executor.execute(approveAction as { action: string });
      expect(approveResult.success).toBe(true);
      expect(approveResult.triggerCoder).toBe(true);
      expect(executor.getActiveStep()).toBe("2");
    });

    test("ask_user tool blocks and resumes correctly", async () => {
      const flowMachine = new FlowMachine({ initialStep: "1" });

      const executor = new ToolExecutor(
        flowMachine,
        planPath,
        createArrayStepResolver(["1"]),
      );

      const askUserTool = createAskUserTool();
      const askAction = await executeTool(askUserTool, { message: "Which option?" });

      const result = await executor.execute(askAction as { action: string; message?: string; requester?: string });

      expect(result.success).toBe(true);
      expect(result.awaitingUser).toBe(true);
      expect(result.userPrompt).toBe("Which option?");
      expect(flowMachine.getState()).toBe("awaiting_user_input");

      // User replies
      const replyResult = await executor.handleUserReply("Use option A");
      expect(replyResult.success).toBe(true);
      expect(replyResult.triggerCoder).toBe(true);
      expect(flowMachine.getState()).toBe("coder_active");
    });
  });

  describe("End-to-End Smoke Test", () => {
    test("complete flow: start → work → review → changes → work → review → approve → next step", async () => {
      // This test simulates a complete orchestration session

      // 1. Start orchestration
      const startResult = await resumeOrchestration(planPath);
      expect(startResult.success).toBe(true);
      expect(startResult.isFreshStart).toBe(true);

      const machine = startResult.flowMachine!;
      let log = startResult.log;

      // 2. Coder does work (simulated tool calls)
      log = logToolCall(log, "coder", "read", { path: "README.md" });
      log = logToolCall(log, "coder", "edit", { path: "src/auth.ts" }, "created file", 100);
      log = logToolCall(log, "coder", "bash", { command: "npm test" }, "passed", 500);

      // 3. Coder requests review
      await machine.send({ type: "request_review" });
      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = syncLogState(log, machine);

      expect(machine.getState()).toBe("reviewer_active");

      // 4. Reviewer reviews and requests changes
      log = logToolCall(log, "reviewer", "read", { path: "src/auth.ts" });
      log = logToolCall(log, "reviewer", "bash", { command: "npm test" });

      await machine.send({ type: "request_changes", reason: "Add input validation" });
      log = logStateTransition(log, "reviewer_active", "coder_active", {
        type: "request_changes",
        reason: "Add input validation",
      });
      log = syncLogState(log, machine);

      expect(machine.getState()).toBe("coder_active");
      expect(machine.getChangeRequestCount()).toBe(1);

      // 5. Save log mid-flow
      await saveLog(planPath, log);

      // 6. Simulate restart - resume from log
      const resumeResult = await resumeOrchestration(planPath);
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.isFreshStart).toBe(false);

      const resumedMachine = resumeResult.flowMachine!;
      log = resumeResult.log;

      expect(resumedMachine.getState()).toBe("coder_active");
      expect(resumedMachine.getChangeRequestCount()).toBe(1);

      // 7. Coder addresses feedback
      log = logToolCall(log, "coder", "edit", { path: "src/auth.ts" }, "added validation", 80);

      // 8. Coder requests review again
      await resumedMachine.send({ type: "request_review" });
      log = logStateTransition(log, "coder_active", "reviewer_active", { type: "request_review" });
      log = syncLogState(log, resumedMachine);

      // 9. Reviewer approves
      resumedMachine.setHasMoreSteps(true);
      await resumedMachine.send({ type: "approve" });

      // 10. Advance to next step
      resumedMachine.advanceStep("2", true);
      log = logStepChange(log, "1", "2", "approved");
      log = syncLogState(log, resumedMachine);

      expect(resumedMachine.getContext().activeStep).toBe("2");
      expect(resumedMachine.getChangeRequestCount()).toBe(0);

      // 11. Save final log
      log = logLifecycle(log, "completed");
      await saveLog(planPath, log);

      // 12. Verify final state
      const finalLog = await loadLog(planPath);
      expect(finalLog).not.toBeNull();
      expect(finalLog!.completed).toBe(true);
      expect(finalLog!.activeStep).toBe("2");

      const summary = getLogSummary(finalLog!);
      expect(summary.totalToolCalls).toBeGreaterThanOrEqual(6);
      expect(summary.totalTransitions).toBeGreaterThanOrEqual(3);
      expect(summary.totalStepChanges).toBe(1);
    });
  });
});
