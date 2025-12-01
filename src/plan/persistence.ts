/**
 * Persistence layer for orchestration logs.
 *
 * Handles saving, loading, and resuming orchestration state
 * from event logs and plan frontmatter.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type EventLog,
  createEventLog,
  parseLog,
  serializeLog,
  LogParseError,
  logLifecycle,
  updateLogState,
} from "./event-log";
import { loadPlan } from "./loader";
import { FlowMachine } from "./flow-machine";
import type { FlowState, FlowConfig } from "./flow-types";

/**
 * Default directory for orchestration logs, relative to plan file.
 */
const DEFAULT_LOG_DIR = ".orchestration";

/**
 * Get the log file path for a plan file.
 */
export function getLogPath(planPath: string): string {
  const planDir = dirname(planPath);
  return join(planDir, DEFAULT_LOG_DIR, "orchestration.log.json");
}

/**
 * Get the transcripts directory path for a plan file.
 */
export function getTranscriptsDir(planPath: string): string {
  const planDir = dirname(planPath);
  return join(planDir, DEFAULT_LOG_DIR, "transcripts");
}

/**
 * Ensure the log directory exists.
 */
export async function ensureLogDir(planPath: string): Promise<void> {
  const logDir = dirname(getLogPath(planPath));
  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }
}

/**
 * Save the event log to disk.
 */
export async function saveLog(planPath: string, log: EventLog): Promise<void> {
  await ensureLogDir(planPath);
  const logPath = getLogPath(planPath);
  await writeFile(logPath, serializeLog(log), "utf-8");
}

/**
 * Load the event log from disk.
 *
 * @returns The log if it exists, null otherwise
 * @throws {LogParseError} if the log is corrupted
 */
export async function loadLog(planPath: string): Promise<EventLog | null> {
  const logPath = getLogPath(planPath);

  if (!existsSync(logPath)) {
    return null;
  }

  const content = await readFile(logPath, "utf-8");
  return parseLog(content);
}

/**
 * Delete the event log.
 */
export async function deleteLog(planPath: string): Promise<void> {
  const logPath = getLogPath(planPath);
  if (existsSync(logPath)) {
    const { rm } = await import("node:fs/promises");
    await rm(logPath);
  }
}

/**
 * Result of attempting to resume orchestration.
 */
export interface ResumeResult {
  /** Whether resume was successful */
  success: boolean;

  /** The reconstructed flow machine (if successful) */
  flowMachine?: FlowMachine;

  /** The loaded/created event log */
  log: EventLog;

  /** Error message if resume failed */
  error?: string;

  /** Whether this is a fresh start (no existing log) */
  isFreshStart: boolean;
}

/**
 * Resume or start orchestration for a plan file.
 *
 * This function:
 * 1. Tries to load an existing log
 * 2. If log exists, validates it against plan frontmatter
 * 3. Reconstructs FlowMachine state from log
 * 4. If no log exists or log is corrupted, creates fresh state
 *
 * @param planPath - Path to the plan.md file
 * @param flowConfig - Optional flow machine configuration overrides
 */
export async function resumeOrchestration(
  planPath: string,
  flowConfig?: Partial<FlowConfig>,
): Promise<ResumeResult> {
  // Load the plan to get current active_step
  let plan;
  try {
    plan = await loadPlan(planPath);
  } catch (error) {
    return {
      success: false,
      log: createEventLog(planPath, "1"),
      error: `Failed to load plan: ${error instanceof Error ? error.message : String(error)}`,
      isFreshStart: true,
    };
  }

  const activeStepFromPlan = plan.frontmatter.active_step;

  // Try to load existing log
  let existingLog: EventLog | null = null;
  try {
    existingLog = await loadLog(planPath);
  } catch (error) {
    // Log is corrupted - we'll start fresh but return a warning
    const freshLog = createEventLog(planPath, activeStepFromPlan);
    const freshMachine = new FlowMachine({
      ...flowConfig,
      initialStep: activeStepFromPlan,
    });

    return {
      success: true,
      flowMachine: freshMachine,
      log: logLifecycle(freshLog, "started"),
      error: `Previous log was corrupted and discarded: ${error instanceof Error ? error.message : String(error)}`,
      isFreshStart: true,
    };
  }

  // No existing log - start fresh
  if (!existingLog) {
    const freshLog = createEventLog(planPath, activeStepFromPlan);
    const freshMachine = new FlowMachine({
      ...flowConfig,
      initialStep: activeStepFromPlan,
    });

    return {
      success: true,
      flowMachine: freshMachine,
      log: logLifecycle(freshLog, "started"),
      isFreshStart: true,
    };
  }

  // Existing log found - check if it's already completed
  if (existingLog.completed) {
    // Start a new orchestration
    const freshLog = createEventLog(planPath, activeStepFromPlan);
    const freshMachine = new FlowMachine({
      ...flowConfig,
      initialStep: activeStepFromPlan,
    });

    return {
      success: true,
      flowMachine: freshMachine,
      log: logLifecycle(freshLog, "started"),
      isFreshStart: true,
    };
  }

  // Resume from existing log
  // Prefer plan frontmatter's active_step as source of truth
  // (in case it was manually edited)
  const shouldSyncStep = activeStepFromPlan !== existingLog.activeStep;

  let resumeLog = existingLog;
  if (shouldSyncStep) {
    // Plan was updated - sync log to match
    resumeLog = updateLogState(resumeLog, {
      activeStep: activeStepFromPlan,
      // Reset change count when step changes
      changeRequestCount: 0,
    });
  }

  // Reconstruct flow machine from log state
  const flowMachine = new FlowMachine({
    ...flowConfig,
    initialStep: resumeLog.activeStep,
    hasMoreSteps: true, // Will be updated by caller
  });

  // Force to the logged state (handles cases where we're mid-flow)
  if (resumeLog.currentState !== "coder_active") {
    await flowMachine.forceState(resumeLog.currentState, "Resume from log");
  }

  // Restore change request counter
  for (let i = 0; i < resumeLog.changeRequestCount; i++) {
    // Simulate the change requests to get the counter right
    // This is a bit of a hack but keeps the FlowMachine encapsulated
    const context = flowMachine.getContext();
    if (context.state === "coder_active") {
      await flowMachine.send({ type: "request_review" });
      await flowMachine.send({ type: "request_changes", reason: "resumed" });
    }
  }

  // If we're supposed to be in a different state, force it again
  if (flowMachine.getState() !== resumeLog.currentState) {
    await flowMachine.forceState(resumeLog.currentState, "Resume state correction");
  }

  // Log the resume
  resumeLog = logLifecycle(resumeLog, "resumed");

  return {
    success: true,
    flowMachine,
    log: resumeLog,
    isFreshStart: false,
  };
}

/**
 * Synchronize log state after a flow machine operation.
 */
export function syncLogState(log: EventLog, flowMachine: FlowMachine): EventLog {
  const context = flowMachine.getContext();
  return updateLogState(log, {
    activeStep: context.activeStep,
    currentState: context.state,
    changeRequestCount: context.changeRequestCount,
  });
}

/**
 * Create a transcript file path for a tool call.
 */
export function createTranscriptPath(
  planPath: string,
  agent: string,
  toolName: string,
  timestamp: number,
): string {
  const transcriptsDir = getTranscriptsDir(planPath);
  const filename = `${agent}_${toolName}_${timestamp}.json`;
  return join(transcriptsDir, filename);
}

/**
 * Save a transcript file.
 */
export async function saveTranscript(
  path: string,
  content: Record<string, unknown>,
): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(content, null, 2), "utf-8");
}

/**
 * Load a transcript file.
 */
export async function loadTranscript(
  path: string,
): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) {
    return null;
  }
  const content = await readFile(path, "utf-8");
  return JSON.parse(content);
}
