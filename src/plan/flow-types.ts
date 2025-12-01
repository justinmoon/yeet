/**
 * Types for the coder/reviewer flow state machine.
 *
 * This module defines the states, events, and context for orchestrating
 * the back-and-forth between coder and reviewer agents.
 */

/**
 * The possible states of the flow state machine.
 */
export type FlowState =
  | "coder_active"
  | "reviewer_active"
  | "awaiting_user_input"
  | "error";

/**
 * The agent roles in the flow.
 */
export type AgentRole = "coder" | "reviewer";

/**
 * Events that can trigger state transitions.
 */
export type FlowEvent =
  | { type: "request_review" }
  | { type: "request_changes"; reason: string }
  | { type: "approve" }
  | { type: "ask_user"; message: string; requester: AgentRole }
  | { type: "user_reply"; response: string }
  | { type: "system_error"; error: string };

/**
 * Context maintained by the state machine.
 */
export interface FlowContext {
  /** Current state of the flow */
  state: FlowState;

  /** Current active step identifier */
  activeStep: string;

  /** Number of request_changes on the current step */
  changeRequestCount: number;

  /** Whether there are more steps after the current one */
  hasMoreSteps: boolean;

  /** The agent that called ask_user (for resuming after user reply) */
  awaitingReplyFrom?: AgentRole;

  /** The message shown to user when in awaiting_user_input state */
  userPrompt?: string;

  /** Error message when in error state */
  errorMessage?: string;

  /** History of state transitions for debugging/logging */
  transitionHistory: TransitionRecord[];
}

/**
 * Record of a state transition.
 */
export interface TransitionRecord {
  from: FlowState;
  to: FlowState;
  event: FlowEvent;
  timestamp: number;
}

/**
 * Hooks called on state entry.
 */
export interface FlowHooks {
  /** Called when entering coder_active state */
  onEnterCoder?: (context: FlowContext) => void | Promise<void>;

  /** Called when entering reviewer_active state */
  onEnterReviewer?: (context: FlowContext) => void | Promise<void>;

  /** Called when entering awaiting_user_input state */
  onEnterAwaitingInput?: (
    context: FlowContext,
    message: string,
  ) => void | Promise<void>;

  /** Called when entering error state */
  onEnterError?: (
    context: FlowContext,
    error: string,
  ) => void | Promise<void>;

  /** Called on any state transition */
  onTransition?: (
    from: FlowState,
    to: FlowState,
    event: FlowEvent,
    context: FlowContext,
  ) => void | Promise<void>;
}

/**
 * Configuration for the flow state machine.
 */
export interface FlowConfig {
  /** Maximum request_changes before halting (default: 3, halts on 4th) */
  maxChangeRequests: number;

  /** Initial active step */
  initialStep: string;

  /** Whether there are steps beyond the initial step */
  hasMoreSteps: boolean;
}

/**
 * Default configuration values.
 */
export const DEFAULT_FLOW_CONFIG: FlowConfig = {
  maxChangeRequests: 3,
  initialStep: "1",
  hasMoreSteps: true,
};
