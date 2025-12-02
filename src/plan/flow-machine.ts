/**
 * Flow state machine for coder/reviewer orchestration.
 *
 * Manages state transitions between coder and reviewer agents,
 * including loop guards and user input handling.
 */

import {
  type FlowState,
  type FlowEvent,
  type FlowContext,
  type FlowHooks,
  type FlowConfig,
  type TransitionRecord,
  type AgentRole,
  DEFAULT_FLOW_CONFIG,
} from "./flow-types";

/**
 * Result of a transition attempt.
 */
export interface TransitionResult {
  /** Whether the transition was successful */
  success: boolean;

  /** The new state after transition (or current state if failed) */
  state: FlowState;

  /** Reason if transition was blocked */
  blockedReason?: string;
}

/**
 * Flow state machine that manages coder/reviewer orchestration.
 */
export class FlowMachine {
  private context: FlowContext;
  private hooks: FlowHooks;
  private config: FlowConfig;

  constructor(
    config: Partial<FlowConfig> = {},
    hooks: FlowHooks = {},
  ) {
    this.config = { ...DEFAULT_FLOW_CONFIG, ...config };
    this.hooks = hooks;
    this.context = this.createInitialContext();
  }

  /**
   * Create the initial context.
   */
  private createInitialContext(): FlowContext {
    return {
      state: "coder_active",
      activeStep: this.config.initialStep,
      changeRequestCount: 0,
      hasMoreSteps: this.config.hasMoreSteps,
      transitionHistory: [],
    };
  }

  /**
   * Get the current state.
   */
  getState(): FlowState {
    return this.context.state;
  }

  /**
   * Get a copy of the current context.
   */
  getContext(): FlowContext {
    return { ...this.context };
  }

  /**
   * Get the change request count for the current step.
   */
  getChangeRequestCount(): number {
    return this.context.changeRequestCount;
  }

  /**
   * Set whether there are more steps (for approve transition logic).
   */
  setHasMoreSteps(hasMore: boolean): void {
    this.context.hasMoreSteps = hasMore;
  }

  /**
   * Advance to the next step (called after approve).
   */
  advanceStep(nextStep: string, hasMoreSteps: boolean): void {
    this.context.activeStep = nextStep;
    this.context.hasMoreSteps = hasMoreSteps;
    this.context.changeRequestCount = 0;
  }

  /**
   * Reset the loop guard counter for the current step.
   * Used when user manually intervenes.
   */
  resetLoopGuard(): void {
    this.context.changeRequestCount = 0;
  }

  /**
   * Set the change request count directly.
   * Used for resuming orchestration from a persisted state.
   */
  setChangeRequestCount(count: number): void {
    this.context.changeRequestCount = count;
  }

  /**
   * Send an event to the state machine.
   *
   * @param event - The event to process
   * @returns TransitionResult indicating success/failure
   */
  async send(event: FlowEvent): Promise<TransitionResult> {
    const currentState = this.context.state;
    const result = this.computeTransition(currentState, event);

    if (!result.success) {
      return result;
    }

    // Record transition
    const record: TransitionRecord = {
      from: currentState,
      to: result.state,
      event,
      timestamp: Date.now(),
    };
    this.context.transitionHistory.push(record);

    // Update state
    this.context.state = result.state;

    // Run hooks
    await this.runTransitionHooks(currentState, result.state, event);

    return result;
  }

  /**
   * Compute the next state for a given event (pure function).
   */
  private computeTransition(
    currentState: FlowState,
    event: FlowEvent,
  ): TransitionResult {
    // system_error can happen from any state
    if (event.type === "system_error") {
      this.context.errorMessage = event.error;
      return { success: true, state: "error" };
    }

    switch (currentState) {
      case "coder_active":
        return this.handleCoderEvent(event);

      case "reviewer_active":
        return this.handleReviewerEvent(event);

      case "awaiting_user_input":
        return this.handleAwaitingInputEvent(event);

      case "error":
        return this.handleErrorEvent(event);

      default:
        return {
          success: false,
          state: currentState,
          blockedReason: `Unknown state: ${currentState}`,
        };
    }
  }

  /**
   * Handle events when in coder_active state.
   */
  private handleCoderEvent(event: FlowEvent): TransitionResult {
    switch (event.type) {
      case "request_review":
        return { success: true, state: "reviewer_active" };

      case "ask_user":
        this.context.awaitingReplyFrom = "coder";
        this.context.userPrompt = event.message;
        return { success: true, state: "awaiting_user_input" };

      default:
        return {
          success: false,
          state: "coder_active",
          blockedReason: `Event '${event.type}' not valid in coder_active state`,
        };
    }
  }

  /**
   * Handle events when in reviewer_active state.
   */
  private handleReviewerEvent(event: FlowEvent): TransitionResult {
    switch (event.type) {
      case "request_changes":
        // Increment change request counter
        this.context.changeRequestCount++;

        // Store the reviewer's feedback for the coder
        this.context.reviewerFeedback = event.reason;

        // Check loop guard - on 4th request (count > maxChangeRequests), halt
        if (this.context.changeRequestCount > this.config.maxChangeRequests) {
          this.context.userPrompt =
            `Loop guard triggered: ${this.context.changeRequestCount} change requests ` +
            `on step "${this.context.activeStep}". ` +
            `Last request: ${event.reason}`;
          this.context.awaitingReplyFrom = "reviewer";
          return { success: true, state: "awaiting_user_input" };
        }

        return { success: true, state: "coder_active" };

      case "approve":
        // Check if there are more steps
        if (!this.context.hasMoreSteps) {
          this.context.userPrompt =
            `All steps completed. Step "${this.context.activeStep}" approved.`;
          this.context.awaitingReplyFrom = undefined;
          return { success: true, state: "awaiting_user_input" };
        }

        // More steps exist - go back to coder for next step
        // Note: caller should call advanceStep() before or after this
        return { success: true, state: "coder_active" };

      case "ask_user":
        this.context.awaitingReplyFrom = "reviewer";
        this.context.userPrompt = event.message;
        return { success: true, state: "awaiting_user_input" };

      default:
        return {
          success: false,
          state: "reviewer_active",
          blockedReason: `Event '${event.type}' not valid in reviewer_active state`,
        };
    }
  }

  /**
   * Handle events when in awaiting_user_input state.
   */
  private handleAwaitingInputEvent(event: FlowEvent): TransitionResult {
    switch (event.type) {
      case "user_reply":
        // Resume to the requester
        const resumeTo = this.context.awaitingReplyFrom;
        this.context.userPrompt = undefined;
        this.context.awaitingReplyFrom = undefined;

        if (resumeTo === "coder") {
          return { success: true, state: "coder_active" };
        } else if (resumeTo === "reviewer") {
          return { success: true, state: "reviewer_active" };
        } else {
          // No specific requester (e.g., loop guard or completion)
          // Default to coder
          return { success: true, state: "coder_active" };
        }

      default:
        return {
          success: false,
          state: "awaiting_user_input",
          blockedReason: `Event '${event.type}' not valid in awaiting_user_input state. Waiting for user_reply.`,
        };
    }
  }

  /**
   * Handle events when in error state.
   */
  private handleErrorEvent(event: FlowEvent): TransitionResult {
    // Error state requires explicit user intervention
    // Only user_reply can recover from error
    switch (event.type) {
      case "user_reply":
        this.context.errorMessage = undefined;
        // Resume to coder by default after error recovery
        return { success: true, state: "coder_active" };

      default:
        return {
          success: false,
          state: "error",
          blockedReason: `Cannot process events in error state. User intervention required.`,
        };
    }
  }

  /**
   * Run state-entry hooks after a transition.
   */
  private async runTransitionHooks(
    from: FlowState,
    to: FlowState,
    event: FlowEvent,
  ): Promise<void> {
    // Run general transition hook
    if (this.hooks.onTransition) {
      await this.hooks.onTransition(from, to, event, this.context);
    }

    // Run state-specific entry hooks
    switch (to) {
      case "coder_active":
        if (this.hooks.onEnterCoder) {
          await this.hooks.onEnterCoder(this.context);
        }
        break;

      case "reviewer_active":
        if (this.hooks.onEnterReviewer) {
          await this.hooks.onEnterReviewer(this.context);
        }
        break;

      case "awaiting_user_input":
        if (this.hooks.onEnterAwaitingInput) {
          await this.hooks.onEnterAwaitingInput(
            this.context,
            this.context.userPrompt || "",
          );
        }
        break;

      case "error":
        if (this.hooks.onEnterError) {
          await this.hooks.onEnterError(
            this.context,
            this.context.errorMessage || "",
          );
        }
        break;
    }
  }

  /**
   * Force transition to a specific state (for user overrides).
   */
  async forceState(
    targetState: FlowState,
    reason: string = "User override",
  ): Promise<void> {
    const from = this.context.state;
    const event: FlowEvent = { type: "user_reply", response: reason };

    // Record the forced transition
    const record: TransitionRecord = {
      from,
      to: targetState,
      event,
      timestamp: Date.now(),
    };
    this.context.transitionHistory.push(record);

    // Update state
    this.context.state = targetState;

    // Clear any pending state
    this.context.userPrompt = undefined;
    this.context.awaitingReplyFrom = undefined;
    if (targetState !== "error") {
      this.context.errorMessage = undefined;
    }

    // Run hooks
    await this.runTransitionHooks(from, targetState, event);
  }
}
