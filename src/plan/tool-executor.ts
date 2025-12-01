/**
 * Tool executor for coder/reviewer orchestration.
 *
 * Wires tool invocations to the FlowMachine state machine,
 * updating PlanState on transitions and handling user input blocking.
 */

import type { FlowMachine, TransitionResult } from "./flow-machine";
import type { FlowEvent, FlowState, AgentRole } from "./flow-types";
import type { ToolAction } from "./tools";
import { updatePlanFrontmatter } from "./loader";

/**
 * Configuration for resolving next steps after approval.
 */
export interface StepResolver {
  /**
   * Get the next step after the current one is approved.
   * Returns null if there are no more steps.
   */
  getNextStep(currentStep: string): string | null;
}

/**
 * Callback for handling user prompts (ask_user tool).
 * Returns the user's response string.
 */
export type UserPromptHandler = (message: string) => Promise<string>;

/**
 * Result of executing a tool action.
 */
export interface ToolExecutionResult {
  /** Whether the transition was successful */
  success: boolean;

  /** The new flow state after the action */
  newState: FlowState;

  /** Reason if the action was blocked */
  blockedReason?: string;

  /** Whether we're now waiting for user input */
  awaitingUser: boolean;

  /** The message to show the user (if awaitingUser) */
  userPrompt?: string;

  /** Whether the reviewer should now run */
  triggerReviewer: boolean;

  /** Whether the coder should now run */
  triggerCoder: boolean;
}

/**
 * Tool executor that connects tool invocations to the flow state machine.
 *
 * Responsibilities:
 * - Process tool actions and dispatch events to FlowMachine
 * - Update plan frontmatter on approve (active_step)
 * - Track loop counters via FlowMachine
 * - Handle user prompt blocking and resumption
 */
export class ToolExecutor {
  private flowMachine: FlowMachine;
  private planPath: string;
  private stepResolver: StepResolver;
  private userPromptHandler?: UserPromptHandler;

  constructor(
    flowMachine: FlowMachine,
    planPath: string,
    stepResolver: StepResolver,
    userPromptHandler?: UserPromptHandler,
  ) {
    this.flowMachine = flowMachine;
    this.planPath = planPath;
    this.stepResolver = stepResolver;
    this.userPromptHandler = userPromptHandler;
  }

  /**
   * Execute a tool action and return the result.
   *
   * This is the main entry point for processing tool results.
   */
  async execute(action: ToolAction): Promise<ToolExecutionResult> {
    switch (action.action) {
      case "request_review":
        return this.handleRequestReview();

      case "request_changes":
        return this.handleRequestChanges(action.reason);

      case "approve":
        return this.handleApprove();

      case "ask_user":
        return this.handleAskUser(action.message, action.requester);

      case "blocked":
        return {
          success: false,
          newState: this.flowMachine.getState(),
          blockedReason: action.reason,
          awaitingUser: false,
          triggerReviewer: false,
          triggerCoder: false,
        };

      default:
        return {
          success: false,
          newState: this.flowMachine.getState(),
          blockedReason: `Unknown action: ${(action as any).action}`,
          awaitingUser: false,
          triggerReviewer: false,
          triggerCoder: false,
        };
    }
  }

  /**
   * Handle the request_review action.
   * Triggers transition to reviewer_active state.
   */
  private async handleRequestReview(): Promise<ToolExecutionResult> {
    const event: FlowEvent = { type: "request_review" };
    const result = await this.flowMachine.send(event);

    return {
      success: result.success,
      newState: result.state,
      blockedReason: result.blockedReason,
      awaitingUser: false,
      triggerReviewer: result.success && result.state === "reviewer_active",
      triggerCoder: false,
    };
  }

  /**
   * Handle the request_changes action.
   * May trigger loop guard if too many changes requested.
   */
  private async handleRequestChanges(
    reason: string,
  ): Promise<ToolExecutionResult> {
    const event: FlowEvent = { type: "request_changes", reason };
    const result = await this.flowMachine.send(event);

    const isLoopGuard = result.state === "awaiting_user_input";

    return {
      success: result.success,
      newState: result.state,
      blockedReason: result.blockedReason,
      awaitingUser: isLoopGuard,
      userPrompt: isLoopGuard
        ? this.flowMachine.getContext().userPrompt
        : undefined,
      triggerReviewer: false,
      triggerCoder: result.success && result.state === "coder_active",
    };
  }

  /**
   * Handle the approve action.
   * Updates plan frontmatter if there are more steps.
   */
  private async handleApprove(): Promise<ToolExecutionResult> {
    const context = this.flowMachine.getContext();
    const currentStep = context.activeStep;
    const nextStep = this.stepResolver.getNextStep(currentStep);
    const hasMoreSteps = nextStep !== null;

    // Update flow machine's knowledge of whether there are more steps
    this.flowMachine.setHasMoreSteps(hasMoreSteps);

    // Send the approve event
    const event: FlowEvent = { type: "approve" };
    const result = await this.flowMachine.send(event);

    if (result.success && hasMoreSteps && nextStep) {
      // Update plan frontmatter with new active step
      await updatePlanFrontmatter(this.planPath, { active_step: nextStep });

      // Advance the flow machine to the next step
      const furtherStep = this.stepResolver.getNextStep(nextStep);
      this.flowMachine.advanceStep(nextStep, furtherStep !== null);
    }

    const isComplete = result.state === "awaiting_user_input";

    return {
      success: result.success,
      newState: result.state,
      blockedReason: result.blockedReason,
      awaitingUser: isComplete,
      userPrompt: isComplete
        ? this.flowMachine.getContext().userPrompt
        : undefined,
      triggerReviewer: false,
      triggerCoder: result.success && result.state === "coder_active",
    };
  }

  /**
   * Handle the ask_user action.
   * Blocks until user responds.
   */
  private async handleAskUser(
    message: string,
    requester: AgentRole,
  ): Promise<ToolExecutionResult> {
    const event: FlowEvent = { type: "ask_user", message, requester };
    const result = await this.flowMachine.send(event);

    return {
      success: result.success,
      newState: result.state,
      blockedReason: result.blockedReason,
      awaitingUser: result.success && result.state === "awaiting_user_input",
      userPrompt: message,
      triggerReviewer: false,
      triggerCoder: false,
    };
  }

  /**
   * Resume execution after user provides input.
   *
   * @param response - The user's response
   * @returns Result indicating which agent should resume
   */
  async handleUserReply(response: string): Promise<ToolExecutionResult> {
    const event: FlowEvent = { type: "user_reply", response };
    const result = await this.flowMachine.send(event);

    return {
      success: result.success,
      newState: result.state,
      blockedReason: result.blockedReason,
      awaitingUser: false,
      triggerReviewer: result.success && result.state === "reviewer_active",
      triggerCoder: result.success && result.state === "coder_active",
    };
  }

  /**
   * Get the current flow state.
   */
  getState(): FlowState {
    return this.flowMachine.getState();
  }

  /**
   * Get the current active step.
   */
  getActiveStep(): string {
    return this.flowMachine.getContext().activeStep;
  }

  /**
   * Get the change request count for the current step.
   */
  getChangeRequestCount(): number {
    return this.flowMachine.getChangeRequestCount();
  }

  /**
   * Check if the flow is waiting for user input.
   */
  isAwaitingUser(): boolean {
    return this.flowMachine.getState() === "awaiting_user_input";
  }

  /**
   * Get the pending user prompt (if awaiting input).
   */
  getPendingUserPrompt(): string | undefined {
    return this.flowMachine.getContext().userPrompt;
  }
}

/**
 * Create a simple step resolver from an array of step IDs.
 */
export function createArrayStepResolver(steps: string[]): StepResolver {
  return {
    getNextStep(currentStep: string): string | null {
      const index = steps.indexOf(currentStep);
      if (index === -1 || index >= steps.length - 1) {
        return null;
      }
      return steps[index + 1];
    },
  };
}

/**
 * Create a step resolver that parses steps from plan body content.
 *
 * Expects steps to be formatted as markdown list items or headers
 * with a step number pattern like "Step 1:", "- Step 2:", "## Step 3", etc.
 */
export function createPlanBodyStepResolver(planBody: string): StepResolver {
  // Extract step identifiers from the plan body
  // Match patterns like "Step 1:", "- Step 2:", "## Step 3:", "1.", "2.", etc.
  const stepPatterns = [
    /(?:^|\n)#+\s*Step\s+(\d+|[\w-]+)/gi,
    /(?:^|\n)-\s*Step\s+(\d+|[\w-]+)/gi,
    /(?:^|\n)\*\s*Step\s+(\d+|[\w-]+)/gi,
    /(?:^|\n)(\d+)\.\s/g,
  ];

  const steps: string[] = [];
  const seen = new Set<string>();

  for (const pattern of stepPatterns) {
    let match;
    while ((match = pattern.exec(planBody)) !== null) {
      const step = match[1];
      if (!seen.has(step)) {
        seen.add(step);
        steps.push(step);
      }
    }
  }

  // Sort numerically if all steps are numbers
  if (steps.every((s) => /^\d+$/.test(s))) {
    steps.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }

  return createArrayStepResolver(steps);
}
