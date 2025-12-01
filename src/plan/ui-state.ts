/**
 * UI state types for coder/reviewer orchestration display.
 *
 * These types represent the state needed to render the orchestration UI,
 * including active agent indicators, step progress, and user prompts.
 */

import type { FlowState, AgentRole } from "./flow-types";

/**
 * State of the orchestration UI.
 */
export interface OrchestrationUIState {
  /** Whether orchestration mode is active */
  active: boolean;

  /** Current flow state */
  flowState: FlowState;

  /** Currently active agent role */
  activeAgent: AgentRole | null;

  /** Current step identifier */
  activeStep: string;

  /** Number of change requests on current step */
  changeRequestCount: number;

  /** Whether waiting for user input */
  awaitingUser: boolean;

  /** Prompt to show user (when awaitingUser) */
  userPrompt?: string;

  /** Error message (when in error state) */
  errorMessage?: string;

  /** Plan file path for display */
  planPath?: string;

  /** Total number of steps (if known) */
  totalSteps?: number;
}

/**
 * Default/initial orchestration UI state.
 */
export const DEFAULT_ORCHESTRATION_UI_STATE: OrchestrationUIState = {
  active: false,
  flowState: "coder_active",
  activeAgent: null,
  activeStep: "1",
  changeRequestCount: 0,
  awaitingUser: false,
};

/**
 * Create initial orchestration UI state.
 */
export function createOrchestrationUIState(
  planPath?: string,
  activeStep: string = "1",
  totalSteps?: number,
): OrchestrationUIState {
  return {
    active: true,
    flowState: "coder_active",
    activeAgent: "coder",
    activeStep,
    changeRequestCount: 0,
    awaitingUser: false,
    planPath,
    totalSteps,
  };
}

/**
 * UI event types for orchestration state changes.
 */
export type OrchestrationUIEvent =
  | { type: "activate"; planPath: string; activeStep: string; totalSteps?: number }
  | { type: "deactivate" }
  | { type: "agent_changed"; agent: AgentRole }
  | { type: "step_changed"; step: string; totalSteps?: number }
  | { type: "change_request"; count: number }
  | { type: "awaiting_user"; prompt: string }
  | { type: "user_replied" }
  | { type: "error"; message: string }
  | { type: "error_cleared" };

/**
 * Reduce orchestration UI state based on an event.
 */
export function reduceOrchestrationUIState(
  state: OrchestrationUIState,
  event: OrchestrationUIEvent,
): OrchestrationUIState {
  switch (event.type) {
    case "activate":
      return {
        ...state,
        active: true,
        flowState: "coder_active",
        activeAgent: "coder",
        activeStep: event.activeStep,
        totalSteps: event.totalSteps,
        planPath: event.planPath,
        changeRequestCount: 0,
        awaitingUser: false,
        userPrompt: undefined,
        errorMessage: undefined,
      };

    case "deactivate":
      return {
        ...state,
        active: false,
        activeAgent: null,
      };

    case "agent_changed":
      return {
        ...state,
        activeAgent: event.agent,
        flowState: event.agent === "coder" ? "coder_active" : "reviewer_active",
      };

    case "step_changed":
      return {
        ...state,
        activeStep: event.step,
        totalSteps: event.totalSteps ?? state.totalSteps,
        changeRequestCount: 0, // Reset on step change
      };

    case "change_request":
      return {
        ...state,
        changeRequestCount: event.count,
      };

    case "awaiting_user":
      return {
        ...state,
        flowState: "awaiting_user_input",
        awaitingUser: true,
        userPrompt: event.prompt,
      };

    case "user_replied":
      return {
        ...state,
        awaitingUser: false,
        userPrompt: undefined,
      };

    case "error":
      return {
        ...state,
        flowState: "error",
        errorMessage: event.message,
      };

    case "error_cleared":
      return {
        ...state,
        flowState: state.activeAgent === "coder" ? "coder_active" : "reviewer_active",
        errorMessage: undefined,
      };

    default:
      return state;
  }
}
