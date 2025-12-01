/**
 * Event log for coder/reviewer orchestration.
 *
 * Records state transitions, tool calls, ask-user prompts, and errors
 * with timestamps and optional transcript links for replay/resume.
 */

import type { FlowState, FlowEvent, AgentRole } from "./flow-types";

/**
 * Base event entry with common fields.
 */
interface BaseLogEntry {
  /** Unique event ID */
  id: string;

  /** Timestamp when the event occurred */
  timestamp: number;

  /** Current step at time of event */
  activeStep: string;
}

/**
 * Log entry for state transitions.
 */
export interface StateTransitionEntry extends BaseLogEntry {
  type: "state_transition";
  fromState: FlowState;
  toState: FlowState;
  event: FlowEvent;
}

/**
 * Log entry for tool calls.
 */
export interface ToolCallEntry extends BaseLogEntry {
  type: "tool_call";
  agent: AgentRole;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  /** Duration in milliseconds */
  duration?: number;
  /** Link to transcript file */
  transcriptPath?: string;
}

/**
 * Log entry for ask-user prompts.
 */
export interface AskUserEntry extends BaseLogEntry {
  type: "ask_user";
  agent: AgentRole;
  message: string;
  /** User's response (filled in when they reply) */
  response?: string;
  /** Time when user responded */
  responseTimestamp?: number;
}

/**
 * Log entry for errors.
 */
export interface ErrorEntry extends BaseLogEntry {
  type: "error";
  error: string;
  /** Stack trace if available */
  stack?: string;
  /** Whether the error was recovered from */
  recovered?: boolean;
}

/**
 * Log entry for step changes.
 */
export interface StepChangeEntry extends BaseLogEntry {
  type: "step_change";
  fromStep: string;
  toStep: string;
  /** Reason for the change (approved, user override, etc.) */
  reason: string;
}

/**
 * Log entry for orchestration start/stop.
 */
export interface OrchestrationLifecycleEntry extends BaseLogEntry {
  type: "lifecycle";
  action: "started" | "completed" | "aborted" | "resumed";
  planPath: string;
  totalSteps?: number;
}

/**
 * Union of all log entry types.
 */
export type LogEntry =
  | StateTransitionEntry
  | ToolCallEntry
  | AskUserEntry
  | ErrorEntry
  | StepChangeEntry
  | OrchestrationLifecycleEntry;

/**
 * The complete event log structure.
 */
export interface EventLog {
  /** Version for format compatibility */
  version: 1;

  /** Path to the plan file */
  planPath: string;

  /** When the orchestration started */
  startedAt: number;

  /** When the log was last updated */
  updatedAt: number;

  /** Current active step (for quick resume) */
  activeStep: string;

  /** Current flow state (for quick resume) */
  currentState: FlowState;

  /** Change request counter (for quick resume) */
  changeRequestCount: number;

  /** Whether orchestration is complete */
  completed: boolean;

  /** All log entries */
  entries: LogEntry[];
}

/**
 * Generate a unique event ID.
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create an empty event log.
 */
export function createEventLog(planPath: string, activeStep: string): EventLog {
  return {
    version: 1,
    planPath,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    activeStep,
    currentState: "coder_active",
    changeRequestCount: 0,
    completed: false,
    entries: [],
  };
}

/**
 * Add an entry to the log.
 */
export function addLogEntry(log: EventLog, entry: Omit<LogEntry, "id" | "timestamp" | "activeStep">): EventLog {
  const fullEntry: LogEntry = {
    ...entry,
    id: generateEventId(),
    timestamp: Date.now(),
    activeStep: log.activeStep,
  } as LogEntry;

  return {
    ...log,
    updatedAt: Date.now(),
    entries: [...log.entries, fullEntry],
  };
}

/**
 * Log a state transition.
 */
export function logStateTransition(
  log: EventLog,
  fromState: FlowState,
  toState: FlowState,
  event: FlowEvent,
): EventLog {
  return addLogEntry(log, {
    type: "state_transition",
    fromState,
    toState,
    event,
  });
}

/**
 * Log a tool call.
 */
export function logToolCall(
  log: EventLog,
  agent: AgentRole,
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown,
  duration?: number,
  transcriptPath?: string,
): EventLog {
  return addLogEntry(log, {
    type: "tool_call",
    agent,
    toolName,
    args,
    result,
    duration,
    transcriptPath,
  });
}

/**
 * Log an ask-user prompt.
 */
export function logAskUser(
  log: EventLog,
  agent: AgentRole,
  message: string,
): EventLog {
  return addLogEntry(log, {
    type: "ask_user",
    agent,
    message,
  });
}

/**
 * Update the last ask-user entry with the user's response.
 */
export function logUserResponse(log: EventLog, response: string): EventLog {
  // Find the last ask_user entry without a response
  const entries = [...log.entries];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "ask_user" && !entry.response) {
      entries[i] = {
        ...entry,
        response,
        responseTimestamp: Date.now(),
      };
      break;
    }
  }

  return {
    ...log,
    updatedAt: Date.now(),
    entries,
  };
}

/**
 * Log an error.
 */
export function logError(
  log: EventLog,
  error: string,
  stack?: string,
): EventLog {
  return addLogEntry(log, {
    type: "error",
    error,
    stack,
  });
}

/**
 * Mark the last error as recovered.
 */
export function logErrorRecovered(log: EventLog): EventLog {
  const entries = [...log.entries];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "error" && !entry.recovered) {
      entries[i] = {
        ...entry,
        recovered: true,
      };
      break;
    }
  }

  return {
    ...log,
    updatedAt: Date.now(),
    entries,
  };
}

/**
 * Log a step change.
 */
export function logStepChange(
  log: EventLog,
  fromStep: string,
  toStep: string,
  reason: string,
): EventLog {
  const newLog = addLogEntry(log, {
    type: "step_change",
    fromStep,
    toStep,
    reason,
  });

  return {
    ...newLog,
    activeStep: toStep,
  };
}

/**
 * Log orchestration lifecycle events.
 */
export function logLifecycle(
  log: EventLog,
  action: "started" | "completed" | "aborted" | "resumed",
  totalSteps?: number,
): EventLog {
  const newLog = addLogEntry(log, {
    type: "lifecycle",
    action,
    planPath: log.planPath,
    totalSteps,
  });

  return {
    ...newLog,
    completed: action === "completed" || action === "aborted",
  };
}

/**
 * Update the log's current state snapshot.
 */
export function updateLogState(
  log: EventLog,
  updates: {
    activeStep?: string;
    currentState?: FlowState;
    changeRequestCount?: number;
  },
): EventLog {
  return {
    ...log,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Serialize the log to JSON string.
 */
export function serializeLog(log: EventLog): string {
  return JSON.stringify(log, null, 2);
}

/**
 * Parse a log from JSON string.
 *
 * @throws {LogParseError} if the log is invalid or corrupted
 */
export function parseLog(json: string): EventLog {
  try {
    const parsed = JSON.parse(json);

    // Validate version
    if (parsed.version !== 1) {
      throw new LogParseError(
        `Unsupported log version: ${parsed.version}. Expected version 1.`,
      );
    }

    // Validate required fields
    if (!parsed.planPath || typeof parsed.planPath !== "string") {
      throw new LogParseError("Missing or invalid planPath");
    }
    if (!parsed.activeStep || typeof parsed.activeStep !== "string") {
      throw new LogParseError("Missing or invalid activeStep");
    }
    if (!Array.isArray(parsed.entries)) {
      throw new LogParseError("Missing or invalid entries array");
    }

    // Validate currentState
    const validStates: FlowState[] = [
      "coder_active",
      "reviewer_active",
      "awaiting_user_input",
      "error",
    ];
    if (!validStates.includes(parsed.currentState)) {
      throw new LogParseError(`Invalid currentState: ${parsed.currentState}`);
    }

    return parsed as EventLog;
  } catch (error) {
    if (error instanceof LogParseError) {
      throw error;
    }
    throw new LogParseError(
      `Failed to parse log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Error thrown when parsing fails.
 */
export class LogParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogParseError";
  }
}

/**
 * Extract summary statistics from the log.
 */
export interface LogSummary {
  totalTransitions: number;
  totalToolCalls: number;
  totalAskUser: number;
  totalErrors: number;
  totalStepChanges: number;
  duration: number; // milliseconds from start to last update
}

export function getLogSummary(log: EventLog): LogSummary {
  const summary: LogSummary = {
    totalTransitions: 0,
    totalToolCalls: 0,
    totalAskUser: 0,
    totalErrors: 0,
    totalStepChanges: 0,
    duration: log.updatedAt - log.startedAt,
  };

  for (const entry of log.entries) {
    switch (entry.type) {
      case "state_transition":
        summary.totalTransitions++;
        break;
      case "tool_call":
        summary.totalToolCalls++;
        break;
      case "ask_user":
        summary.totalAskUser++;
        break;
      case "error":
        summary.totalErrors++;
        break;
      case "step_change":
        summary.totalStepChanges++;
        break;
    }
  }

  return summary;
}
