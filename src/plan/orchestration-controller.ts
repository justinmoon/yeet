/**
 * Orchestration controller for coder/reviewer workflow.
 *
 * This is THE single controller abstraction for orchestrating coder/reviewer agents.
 * The TUI is a thin client; all orchestration logic lives here.
 *
 * Responsibilities:
 * - Register orchestration tools (request_review, request_changes, approve, ask_user) with agent
 * - Honor selected models per role (fallback to config defaults)
 * - Bind workspace to plan directory
 * - Persist to .orchestration/ log + transcripts
 * - Emit status callbacks for UI
 */

import { dirname, join } from "node:path";
import type { Config } from "../config";
import type { AgentEvent, MessageContent } from "../agent";
import { runAgent } from "../agent";
import { FlowMachine } from "./flow-machine";
import type { FlowState, FlowConfig, AgentRole } from "./flow-types";
import { ToolExecutor, createPlanBodyStepResolver } from "./tool-executor";
import type { ToolAction } from "./tools";
import { createCoderTools, createReviewerTools } from "./tools";
import { createCoderDriver, createReviewerDriver } from "./agent-driver";
import type { PromptConfig } from "./agent-driver-types";
import { loadPlan } from "./loader";
import {
  resumeOrchestration,
  saveLog,
  syncLogState,
  createTranscriptPath,
  saveTranscript,
} from "./persistence";
import type { EventLog } from "./event-log";
import {
  logStateTransition,
  logToolCall,
  logAskUser,
  logUserResponse,
  logError,
  logLifecycle,
  logStepChange,
} from "./event-log";
import { filterToolsForRole } from "./tool-filter";
import * as baseTools from "../tools";
import { logger } from "../logger";
import {
  setActiveWorkspaceBinding,
  getActiveWorkspaceBinding,
} from "../workspace/state";
import type { WorkspaceBinding } from "../workspace/binding";

/**
 * Status update emitted to UI.
 */
export interface OrchestrationStatus {
  /** Current flow state */
  flowState: FlowState;
  /** Currently active agent (or null if paused) */
  activeAgent: AgentRole | null;
  /** Current step ID */
  currentStep: string;
  /** Total number of steps */
  totalSteps: number;
  /** Number of change requests on current step */
  changeRequestCount: number;
  /** User prompt if awaiting input */
  awaitingUserPrompt: string | null;
  /** All steps with titles */
  steps: Array<{ id: string; title: string }>;
  /** Error message if in error state */
  errorMessage?: string;
}

/**
 * Callback for status updates.
 */
export type StatusCallback = (status: OrchestrationStatus) => void;

/**
 * Callback for agent output (text, tool calls, etc).
 */
export type OutputCallback = (
  role: AgentRole,
  event: AgentEvent,
) => void;

/**
 * Callback for error events.
 * This is the single path for all orchestration errors to surface to the UI.
 */
export type ErrorCallback = (error: string, role?: AgentRole) => void;

/**
 * Model configuration per role.
 */
export interface RoleModelConfig {
  /** Model ID for coder agent */
  coderModel?: string;
  /** Model ID for reviewer agent */
  reviewerModel?: string;
  /** Provider for coder (defaults to config.activeProvider) */
  coderProvider?: "anthropic" | "openai" | "maple" | "opencode";
  /** Provider for reviewer (defaults to config.activeProvider) */
  reviewerProvider?: "anthropic" | "openai" | "maple" | "opencode";
}

/**
 * Configuration for the orchestration controller.
 */
export interface OrchestrationControllerConfig {
  /** Path to the plan.md file */
  planPath: string;
  /** Base config (for model defaults, API keys, etc) */
  config: Config;
  /** Model configuration per role */
  roleModels?: RoleModelConfig;
  /** Callback for status updates */
  onStatus?: StatusCallback;
  /** Callback for agent output */
  onOutput?: OutputCallback;
  /** Callback for errors - the single path for all orchestration errors */
  onError?: ErrorCallback;
  /** Flow machine configuration overrides */
  flowConfig?: Partial<FlowConfig>;
}

/**
 * Controller state.
 */
type ControllerState = "idle" | "running" | "awaiting_user" | "stopped" | "error";

/**
 * Orchestration controller - the single abstraction for coder/reviewer workflow.
 */
export class OrchestrationController {
  private planPath: string;
  private planDir: string;
  private config: Config;
  private roleModels: RoleModelConfig;
  private onStatus?: StatusCallback;
  private onOutput?: OutputCallback;
  private onError?: ErrorCallback;
  private flowConfigOverrides?: Partial<FlowConfig>;

  private controllerState: ControllerState = "idle";
  private flowMachine!: FlowMachine;
  private toolExecutor!: ToolExecutor;
  private eventLog!: EventLog;
  private steps: Array<{ id: string; title: string }> = [];
  private abortController?: AbortController;

  // Workspace binding management
  private originalWorkspace: WorkspaceBinding | null = null;

  // Agent drivers for prompt management
  private coderDriver!: ReturnType<typeof createCoderDriver>;
  private reviewerDriver!: ReturnType<typeof createReviewerDriver>;

  // Coder conversation history (preserved across request_changes cycles)
  private coderHistory: Array<{ role: "user" | "assistant"; content: MessageContent }> = [];

  // Pending user message to inject into the next agent iteration
  private pendingUserMessage: string | null = null;

  constructor(controllerConfig: OrchestrationControllerConfig) {
    this.planPath = controllerConfig.planPath;
    this.planDir = dirname(controllerConfig.planPath);
    this.config = controllerConfig.config;
    this.roleModels = controllerConfig.roleModels || {};
    this.onStatus = controllerConfig.onStatus;
    this.onOutput = controllerConfig.onOutput;
    this.onError = controllerConfig.onError;
    this.flowConfigOverrides = controllerConfig.flowConfig;
  }

  /**
   * Emit an error event to the UI so users can see what went wrong.
   * This is the single path for all orchestration errors.
   */
  private emitError(error: string, role?: AgentRole): void {
    // Always log for post-mortem
    logger.error("Orchestration error", { error, role });

    // Surface to UI via dedicated callback
    if (this.onError) {
      this.onError(error, role);
    }
  }

  /**
   * Initialize and start the orchestration.
   *
   * This loads the plan, resumes from any existing log, and starts the loop.
   */
  async start(): Promise<void> {
    if (this.controllerState !== "idle") {
      throw new Error(`Cannot start: controller is ${this.controllerState}`);
    }

    logger.info("OrchestrationController starting", { planPath: this.planPath });

    try {
      // Load plan and extract steps
      const plan = await loadPlan(this.planPath);
      const stepResolver = createPlanBodyStepResolver(plan.body);

      // Extract steps for UI
      this.extractSteps(plan.body);

      // Resume or start fresh
      const resumeResult = await resumeOrchestration(
        this.planPath,
        this.flowConfigOverrides,
      );

      if (!resumeResult.success) {
        this.controllerState = "error";
        this.emitStatus();
        const errorMsg = resumeResult.error || "Failed to resume orchestration";
        this.emitError(errorMsg);
        throw new Error(errorMsg);
      }

      this.flowMachine = resumeResult.flowMachine!;
      this.eventLog = resumeResult.log;

      // Create tool executor
      this.toolExecutor = new ToolExecutor(
        this.flowMachine,
        this.planPath,
        stepResolver,
      );

      // Create agent drivers (modelAuth handled via agentConfig, not drivers)
      const promptConfig = this.buildPromptConfig(plan.frontmatter.active_step);

      this.coderDriver = createCoderDriver(
        this.planDir,
        promptConfig,
      );

      this.reviewerDriver = createReviewerDriver(
        this.planDir,
        promptConfig,
        50, // maxHistoryMessages
      );

      // Emit initial status
      this.controllerState = "running";
      this.emitStatus();

      // Save log
      await this.saveEventLog();

      // Start the orchestration loop
      await this.runLoop();
    } catch (error) {
      // Make sure errors are surfaced to the UI
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Orchestration start/loop error", { error: errorMessage });

      this.emitError(`Orchestration error: ${errorMessage}`);
      this.controllerState = "error";
      this.emitStatus();

      // Re-throw so caller can also handle
      throw error;
    }
  }

  /**
   * Handle user reply when awaiting input.
   */
  async handleUserReply(response: string): Promise<void> {
    if (this.controllerState !== "awaiting_user") {
      logger.warn("handleUserReply called but not awaiting user", {
        state: this.controllerState,
      });
      return;
    }

    logger.info("User reply received", { response: response.slice(0, 100) });

    // Log the response
    this.eventLog = logUserResponse(this.eventLog, response);

    // Send to tool executor
    const result = await this.toolExecutor.handleUserReply(response);

    // Log state transition
    this.eventLog = logStateTransition(
      this.eventLog,
      "awaiting_user_input",
      result.newState,
      { type: "user_reply", response },
    );

    // Sync and save log
    this.eventLog = syncLogState(this.eventLog, this.flowMachine);
    await this.saveEventLog();

    // Update state and emit
    this.controllerState = "running";
    this.emitStatus();

    // Resume the loop
    await this.runLoop();
  }

  /**
   * Stop the orchestration gracefully.
   */
  async stop(): Promise<void> {
    if (this.controllerState === "stopped") {
      return;
    }

    logger.info("OrchestrationController stopping", {
      previousState: this.controllerState,
    });

    // Abort any running agent
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }

    // Only log if we actually started (flowMachine exists)
    if (this.flowMachine && this.eventLog) {
      // Log completion/abort
      const isComplete = this.flowMachine.getState() === "awaiting_user_input" &&
        !this.flowMachine.getContext().awaitingReplyFrom;

      this.eventLog = logLifecycle(
        this.eventLog,
        isComplete ? "completed" : "aborted",
      );

      // Update completed flag
      if (isComplete) {
        this.eventLog = { ...this.eventLog, completed: true };
      }

      await this.saveEventLog();
    }

    // Clear internal state to prevent dangling references
    // Note: We don't null flowMachine/toolExecutor so getStatus() still works
    // but controllerState = "stopped" prevents any further operations

    this.controllerState = "stopped";
    this.emitStatus();
  }

  /**
   * Get current status.
   */
  getStatus(): OrchestrationStatus {
    // Handle case where controller hasn't started yet
    if (!this.flowMachine) {
      return {
        flowState: "coder_active",
        activeAgent: null,
        currentStep: "1",
        totalSteps: this.steps.length || 1,
        changeRequestCount: 0,
        awaitingUserPrompt: null,
        steps: this.steps,
      };
    }

    const context = this.flowMachine.getContext();
    const state = this.flowMachine.getState();

    let activeAgent: AgentRole | null = null;
    if (state === "coder_active") {
      activeAgent = "coder";
    } else if (state === "reviewer_active") {
      activeAgent = "reviewer";
    }

    return {
      flowState: state,
      activeAgent,
      currentStep: context.activeStep || "1",
      totalSteps: this.steps.length || 1,
      changeRequestCount: context.changeRequestCount || 0,
      awaitingUserPrompt: state === "awaiting_user_input"
        ? context.userPrompt || null
        : null,
      steps: this.steps,
      errorMessage: context.errorMessage,
    };
  }

  /**
   * Check if controller is awaiting user input.
   */
  isAwaitingUser(): boolean {
    return this.controllerState === "awaiting_user";
  }

  /**
   * Check if an agent is currently running.
   */
  isRunning(): boolean {
    return this.controllerState === "running";
  }

  /**
   * Get the currently active agent role (or null if not running).
   */
  getActiveRole(): AgentRole | null {
    if (this.controllerState !== "running") {
      return null;
    }
    const state = this.flowMachine.getState();
    if (state === "coder_active") return "coder";
    if (state === "reviewer_active") return "reviewer";
    return null;
  }

  /**
   * Inject a user message into the current agent's context.
   *
   * This will:
   * 1. Abort the currently running agent
   * 2. Store the message to be included in the next iteration
   * 3. Resume the same agent with the message injected
   */
  async injectUserMessage(message: string): Promise<void> {
    if (this.controllerState !== "running") {
      logger.warn("injectUserMessage called but not running", {
        state: this.controllerState,
      });
      // If awaiting user, treat as normal reply
      if (this.controllerState === "awaiting_user") {
        await this.handleUserReply(message);
      }
      return;
    }

    const activeRole = this.getActiveRole();
    logger.info("Injecting user message", { message: message.slice(0, 100), activeRole });

    // Store the message for the next iteration
    this.pendingUserMessage = message;

    // Abort the current agent
    if (this.abortController) {
      this.abortController.abort();
    }

    // Log the injection
    this.eventLog = logUserResponse(this.eventLog, `[INTERRUPT] ${message}`);
    await this.saveEventLog();

    // The agent will be restarted by the loop after abort
    // and will pick up the pending message in buildAgentMessages
  }

  /**
   * Pause the current agent.
   *
   * This will abort the running agent and transition to awaiting_user state.
   * The next user message will resume the same agent.
   */
  async pause(): Promise<void> {
    if (this.controllerState !== "running") {
      logger.warn("pause called but not running", { state: this.controllerState });
      return;
    }

    const activeRole = this.getActiveRole();
    logger.info("Pausing orchestration", { activeRole });

    // Abort the current agent
    if (this.abortController) {
      this.abortController.abort();
    }

    // Transition to awaiting_user_input via ask_user event
    const flowState = this.flowMachine.getState();
    if (flowState === "coder_active" || flowState === "reviewer_active") {
      const requester: AgentRole = flowState === "coder_active" ? "coder" : "reviewer";
      await this.flowMachine.send({
        type: "ask_user",
        message: "Paused by user. Send a message to continue.",
        requester,
      });

      this.eventLog = logAskUser(this.eventLog, requester, "Paused by user");
      this.eventLog = syncLogState(this.eventLog, this.flowMachine);
      await this.saveEventLog();
    }

    this.controllerState = "awaiting_user";
    this.emitStatus();
  }

  /**
   * Main orchestration loop.
   */
  private async runLoop(): Promise<void> {
    while (this.controllerState === "running") {
      const state = this.flowMachine.getState();
      logger.debug("Orchestration loop iteration", { state });

      try {
        switch (state) {
          case "coder_active":
            await this.runCoderIteration();
            break;

          case "reviewer_active":
            await this.runReviewerIteration();
            break;

          case "awaiting_user_input":
            this.controllerState = "awaiting_user";
            this.emitStatus();
            return; // Exit loop, wait for user reply

          case "error":
            this.controllerState = "error";
            this.emitStatus();
            return; // Exit loop, need user intervention

          default:
            this.emitError(`Unknown flow state: ${state}`);
            this.controllerState = "error";
            return;
        }
      } catch (error) {
        // Log the error and transition to error state
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Orchestration loop error", { error: errorMessage, state });

        // Log to event log
        this.eventLog = logError(this.eventLog, errorMessage);
        await this.saveEventLog();

        // Transition to error state via flow machine
        await this.flowMachine.send({ type: "system_error", error: errorMessage });

        this.controllerState = "error";
        this.emitStatus();

        // Re-throw so TUI can display the error
        throw error;
      }
    }
  }

  /**
   * Run one coder agent iteration.
   */
  private async runCoderIteration(): Promise<void> {
    const role: AgentRole = "coder";
    logger.info("Running coder iteration");

    // Bind workspace to plan directory with write access for coder
    this.setWorkspaceForRole(role);

    try {
      // Update prompt config with current step
      const context = this.flowMachine.getContext();
      const promptConfig = this.buildPromptConfig(context.activeStep);
      this.coderDriver.updatePromptConfig(promptConfig);

      // Build messages
      const messages = this.buildAgentMessages(role);

      // Build config with role-specific model
      const agentConfig = this.buildAgentConfig(role);

      // Build toolset with orchestration tools
      const toolset = this.buildToolset(role);

      // Get system prompt from driver
      const systemPrompt = this.coderDriver.getSystemPrompt() || "";

      // Run the agent
      const action = await this.runAgentWithTools(
        role,
        messages,
        agentConfig,
        toolset,
        systemPrompt,
      );

      if (!action) {
        // Agent completed without calling orchestration tool (hit step limit)
        // Transition to awaiting_user_input instead of silently restarting
        logger.warn("Coder completed without calling orchestration tool - pausing for user input");
        await this.flowMachine.send({
          type: "ask_user",
          message: "The coder reached the step limit without requesting a review. Would you like to continue, or should I request a review now?",
          requester: "coder",
        });
        this.eventLog = logAskUser(
          this.eventLog,
          "coder",
          "Reached step limit without calling request_review. Pausing for user input.",
        );
        this.eventLog = syncLogState(this.eventLog, this.flowMachine);
        await this.saveEventLog();
        return;
      }

      // Process the action
      await this.processToolAction(role, action);
    } catch (error) {
      // Surface error to UI and transition to awaiting_user_input
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Coder iteration error", { error: errorMessage });

      // Emit error to UI
      this.emitError(`Coder error: ${errorMessage}`, role);

      // Log to event log
      this.eventLog = logError(this.eventLog, `Coder error: ${errorMessage}`);

      // Transition to awaiting_user_input so user can decide how to proceed
      await this.flowMachine.send({
        type: "ask_user",
        message: `Coder encountered an error: ${errorMessage}\n\nWould you like to retry or stop?`,
        requester: "coder",
      });
      this.eventLog = logAskUser(this.eventLog, "coder", `Error occurred: ${errorMessage}`);
      this.eventLog = syncLogState(this.eventLog, this.flowMachine);
      await this.saveEventLog();
    } finally {
      // Restore original workspace
      this.restoreWorkspace();
    }
  }

  /**
   * Run one reviewer agent iteration.
   */
  private async runReviewerIteration(): Promise<void> {
    const role: AgentRole = "reviewer";
    logger.info("Running reviewer iteration");

    // Bind workspace to plan directory
    this.setWorkspaceForRole(role);

    try {
      // Update prompt config with current step
      const context = this.flowMachine.getContext();
      const promptConfig = this.buildPromptConfig(context.activeStep);
      this.reviewerDriver.updatePromptConfig(promptConfig);

      // Build messages
      const messages = this.buildAgentMessages(role);

      // Build config with role-specific model
      const agentConfig = this.buildAgentConfig(role);

      // Build toolset with orchestration tools
      const toolset = this.buildToolset(role);

      // Get system prompt from driver
      const systemPrompt = this.reviewerDriver.getSystemPrompt() || "";

      // Run the agent
      const action = await this.runAgentWithTools(
        role,
        messages,
        agentConfig,
        toolset,
        systemPrompt,
      );

      if (!action) {
        // Reviewer completed without calling orchestration tool (hit step limit)
        // Transition to awaiting_user_input instead of silently restarting
        logger.warn("Reviewer completed without calling orchestration tool - pausing for user input");
        await this.flowMachine.send({
          type: "ask_user",
          message: "The reviewer reached the step limit without approving or requesting changes. Would you like to continue the review?",
          requester: "reviewer",
        });
        this.eventLog = logAskUser(
          this.eventLog,
          "reviewer",
          "Reached step limit without calling approve/request_changes. Pausing for user input.",
        );
        this.eventLog = syncLogState(this.eventLog, this.flowMachine);
        await this.saveEventLog();
        return;
      }

      // Process the action
      await this.processToolAction(role, action);
    } catch (error) {
      // Surface error to UI and transition to awaiting_user_input
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Reviewer iteration error", { error: errorMessage });

      // Emit error to UI
      this.emitError(`Reviewer error: ${errorMessage}`, role);

      // Log to event log
      this.eventLog = logError(this.eventLog, `Reviewer error: ${errorMessage}`);

      // Transition to awaiting_user_input so user can decide how to proceed
      await this.flowMachine.send({
        type: "ask_user",
        message: `Reviewer encountered an error: ${errorMessage}\n\nWould you like to retry or stop?`,
        requester: "reviewer",
      });
      this.eventLog = logAskUser(this.eventLog, "reviewer", `Error occurred: ${errorMessage}`);
      this.eventLog = syncLogState(this.eventLog, this.flowMachine);
      await this.saveEventLog();
    } finally {
      // Restore original workspace
      this.restoreWorkspace();
    }
  }

  /**
   * Run agent and capture orchestration tool action.
   * Also captures conversation history for the coder (to preserve across request_changes).
   */
  private async runAgentWithTools(
    role: AgentRole,
    messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
    agentConfig: Config,
    toolset: Record<string, unknown>,
    systemPrompt: string,
  ): Promise<ToolAction | null> {
    this.abortController = new AbortController();
    let orchestrationAction: ToolAction | null = null;

    // Track pending tool calls to match with results
    const pendingToolCalls = new Map<string, { name: string; args: unknown; timestamp: number }>();

    // Capture assistant text for conversation history (coder only)
    let assistantTextBuffer = "";

    try {
      const generator = runAgent(
        messages,
        agentConfig,
        (toolName) => {
          logger.debug("Tool called", { role, toolName });
        },
        100, // Allow up to 100 steps before forcing a pause
        this.abortController.signal,
        toolset, // Pass custom toolset
        systemPrompt, // Pass orchestration-specific system prompt
      );

      for await (const event of generator) {
        // Emit output to UI
        this.onOutput?.(role, event);

        // Capture text output for coder history
        if (role === "coder" && event.type === "text" && event.content) {
          assistantTextBuffer += event.content;
        }

        // Track tool calls when they start
        if (event.type === "tool" && event.name) {
          const callId = `${event.name}_${Date.now()}`;
          pendingToolCalls.set(event.name, {
            name: event.name,
            args: event.args,
            timestamp: Date.now(),
          });
          logger.debug("Tool call started", { role, toolName: event.name, args: event.args });
        }

        // Process tool results
        if (event.type === "tool-result" && event.name) {
          const pendingCall = pendingToolCalls.get(event.name);
          const timestamp = pendingCall?.timestamp || Date.now();
          const args = pendingCall?.args || {};
          pendingToolCalls.delete(event.name);

          // Log ALL tool calls with args and results
          const duration = Date.now() - timestamp;
          const transcriptPath = createTranscriptPath(
            this.planPath,
            role,
            event.name,
            timestamp,
          );

          // Save transcript for non-trivial results
          const resultData = {
            tool: event.name,
            args,
            result: event.result,
            timestamp,
            duration,
          };

          try {
            await saveTranscript(transcriptPath, resultData);
          } catch (err) {
            logger.warn("Failed to save transcript", { error: err });
          }

          // logToolCall signature: (log, agent, toolName, args, result?, duration?, transcriptPath?)
          this.eventLog = logToolCall(
            this.eventLog,
            role,
            event.name,
            args as Record<string, unknown>,
            event.result, // result
            duration,     // duration
            transcriptPath, // transcriptPath
          );

          // Check if this is an orchestration tool result
          const result = event.result as ToolAction;
          if (result && typeof result === "object" && "action" in result) {
            orchestrationAction = result;
            // For ask_user, we must stop immediately - don't let the agent continue
            // and potentially overwrite this action with request_review/etc.
            if (result.action === "ask_user") {
              logger.info("ask_user detected, aborting agent to wait for user response");
              this.abortController?.abort();
              break;
            }
          }
        }

        // Handle errors
        if (event.type === "error") {
          this.eventLog = logError(this.eventLog, event.error || "Unknown error");
          throw new Error(event.error);
        }

        // If we got an orchestration action and agent is done, we can exit
        if (orchestrationAction && event.type === "done") {
          break;
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logger.info("Agent aborted", { role });
        // If we have an orchestration action (e.g., ask_user triggered the abort),
        // return it instead of null so it gets processed
        if (orchestrationAction) {
          logger.info("Returning orchestration action after abort", { action: orchestrationAction.action });
          // Fall through to return orchestrationAction below
        } else {
          return null;
        }
      } else {
        throw error;
      }
    } finally {
      this.abortController = undefined;
    }

    // For coder: save conversation history (input messages + assistant response)
    // This is used to preserve context across request_changes cycles
    if (role === "coder" && assistantTextBuffer) {
      // Start fresh or append to existing history
      if (this.coderHistory.length === 0) {
        // First run - save the initial messages
        this.coderHistory = [...messages];
      }
      // Add assistant's response
      this.coderHistory.push({
        role: "assistant",
        content: assistantTextBuffer,
      });
      logger.debug("Saved coder history", { messageCount: this.coderHistory.length });
    }

    return orchestrationAction;
  }

  /**
   * Process a tool action through the tool executor.
   */
  private async processToolAction(
    role: AgentRole,
    action: ToolAction,
  ): Promise<void> {
    const previousState = this.flowMachine.getState();
    const result = await this.toolExecutor.execute(action);

    // Log state transition
    if (result.newState !== previousState) {
      this.eventLog = logStateTransition(
        this.eventLog,
        previousState,
        result.newState,
        { type: action.action as any },
      );
    }

    // Handle ask_user logging
    if (action.action === "ask_user") {
      this.eventLog = logAskUser(this.eventLog, role, action.message);
    }

    // Handle step changes on approve
    if (action.action === "approve" && result.triggerCoder) {
      const previousStep = this.flowMachine.getContext().activeStep;
      const newStep = this.toolExecutor.getActiveStep();
      if (newStep !== previousStep) {
        this.eventLog = logStepChange(
          this.eventLog,
          previousStep,
          newStep,
          "Step approved",
        );
      }
      // Clear coder history and reviewer feedback for the new step (fresh context)
      this.coderHistory = [];
      this.flowMachine.getContext().reviewerFeedback = undefined;
      logger.debug("Cleared coder history for new step", { newStep });
    }

    // Sync and save log
    this.eventLog = syncLogState(this.eventLog, this.flowMachine);
    await this.saveEventLog();

    // Emit status update
    this.emitStatus();
  }

  /**
   * Build messages for agent.
   *
   * For coder: preserves conversation history across request_changes cycles,
   * and injects reviewer feedback when resuming after changes requested.
   */
  private buildAgentMessages(
    role: AgentRole,
  ): Array<{ role: "user" | "assistant"; content: MessageContent }> {
    const driver = role === "coder" ? this.coderDriver : this.reviewerDriver;
    const context = this.flowMachine.getContext();

    // If model requires user message injection, add instructions first
    const messages: Array<{ role: "user" | "assistant"; content: MessageContent }> = [];

    if (driver.requiresUserMessageInjection()) {
      messages.push({
        role: "user",
        content: driver.getInstructionsAsUserMessage(),
      });
      messages.push({
        role: "assistant",
        content: "I understand my role and instructions. I'm ready to proceed.",
      });
    }

    // For coder: use preserved history if we have it (request_changes cycle)
    if (role === "coder" && this.coderHistory.length > 0) {
      // Add the preserved conversation history
      messages.push(...this.coderHistory);

      // Add reviewer feedback as a new user message
      if (context.reviewerFeedback) {
        messages.push({
          role: "user",
          content: `The reviewer has requested changes:\n\n${context.reviewerFeedback}\n\nPlease address this feedback. When done, commit your changes and call \`request_review\` again.`,
        });
      }
    } else {
      // Fresh start - use context seed
      const contextSeed = driver.getContextSeed();
      messages.push({
        role: "user",
        content: contextSeed,
      });
    }

    // If there's a pending user message (from interrupt), add it
    if (this.pendingUserMessage) {
      messages.push({
        role: "user",
        content: `[User interrupt]: ${this.pendingUserMessage}`,
      });
      // Clear the pending message after adding it
      this.pendingUserMessage = null;
    }

    return messages;
  }

  /**
   * Build agent config with role-specific model.
   */
  private buildAgentConfig(role: AgentRole): Config {
    const provider = role === "coder"
      ? this.roleModels.coderProvider || this.config.activeProvider
      : this.roleModels.reviewerProvider || this.config.activeProvider;

    const model = role === "coder"
      ? this.roleModels.coderModel
      : this.roleModels.reviewerModel;

    // Clone config with role-specific settings
    const agentConfig: Config = {
      ...this.config,
      activeProvider: provider,
    };

    // Set model for the appropriate provider
    if (model) {
      if (provider === "anthropic" && agentConfig.anthropic) {
        agentConfig.anthropic = { ...agentConfig.anthropic, model };
      } else if (provider === "openai" && agentConfig.openai) {
        agentConfig.openai = { ...agentConfig.openai, model };
      } else if (provider === "maple" && agentConfig.maple) {
        agentConfig.maple = { ...agentConfig.maple, model };
      } else if (provider === "opencode" && agentConfig.opencode) {
        agentConfig.opencode = { ...agentConfig.opencode, model };
      }
    }

    return agentConfig;
  }

  /**
   * Build toolset for agent with orchestration tools.
   */
  private buildToolset(role: AgentRole): Record<string, unknown> {
    // Get orchestration tools for role
    const orchestrationTools = role === "coder"
      ? createCoderTools()
      : createReviewerTools();

    // Get base tools, filtered for role (removes edit/write for reviewer)
    const filteredBaseTools = filterToolsForRole(
      {
        bash: baseTools.bash,
        read: baseTools.read,
        edit: baseTools.edit,
        write: baseTools.write,
        search: baseTools.search,
        complete: baseTools.complete,
        clarify: baseTools.clarify,
        pause: baseTools.pause,
      },
      role,
    );

    // Note: Previously we wrapped bash for reviewer with read-only interceptor.
    // Relaxed for now to allow reviewer to run any bash command (including git).
    // Can be tightened later if needed.

    // Merge: orchestration tools + filtered base tools
    return {
      ...filteredBaseTools,
      ...orchestrationTools,
    };
  }

  /**
   * Build prompt config for current step.
   */
  private buildPromptConfig(activeStep: string): PromptConfig {
    return {
      planPath: this.planPath,
      intentPath: join(this.planDir, "intent.md"),
      specPath: join(this.planDir, "spec.md"),
      activeStep,
      stepContent: this.getStepContent(activeStep),
    };
  }

  /**
   * Get step content from steps list.
   */
  private getStepContent(stepId: string): string | undefined {
    const step = this.steps.find((s) => s.id === stepId);
    return step?.title;
  }

  /**
   * Extract steps from plan body.
   * Falls back to a single step if no steps detected.
   */
  private extractSteps(planBody: string): void {
    // Try multiple patterns for step extraction
    const patterns = [
      // "Step 1: ..." or "- Step 1: ..." or "## Step 1: ..."
      /(?:^|\n)[-*]?\s*(?:#+\s*)?Step\s+(\d+)[:\s]+([^\n]+)/gi,
      // Numbered lists with parenthesis: "1) ..." "2) ..."
      /(?:^|\n)(\d+)\)\s+([^\n]+)/g,
      // Numbered lists with period: "1. ..." "2. ..."
      /(?:^|\n)(\d+)\.\s+([^\n]+)/g,
    ];

    this.steps = [];
    const seenIds = new Set<string>();

    for (const pattern of patterns) {
      const matches = planBody.matchAll(pattern);
      for (const match of matches) {
        const id = match[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          this.steps.push({
            id,
            title: match[2].trim(),
          });
        }
      }
      // Stop if we found steps with this pattern
      if (this.steps.length > 0) break;
    }

    // Sort by step number
    this.steps.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

    // Fallback: if no steps detected, create a single default step
    if (this.steps.length === 0) {
      logger.warn("No steps detected in plan, falling back to single step");
      this.steps = [{ id: "1", title: "Complete the plan" }];
    }

    logger.debug("Extracted steps", { steps: this.steps, count: this.steps.length });
  }

  /**
   * Set workspace binding for a specific role.
   * Both roles get write access for now (relaxed constraints).
   */
  private setWorkspaceForRole(role: AgentRole): void {
    // Save original workspace to restore later
    this.originalWorkspace = getActiveWorkspaceBinding();

    // Create workspace binding for this role
    // Note: Both roles get write access. Reviewer is told via prompt to be read-only,
    // but we don't enforce it. This allows reviewer to run git commands for verification.
    const binding: WorkspaceBinding = {
      id: `ws:orchestration:${role}:${this.planDir}`,
      cwd: this.planDir,
      isolationMode: "shared",
      allowWrites: true,
      label: `${role} workspace`,
    };

    setActiveWorkspaceBinding(binding);
    logger.debug("Set workspace binding", { role, cwd: this.planDir, allowWrites: binding.allowWrites });
  }

  /**
   * Restore the original workspace binding.
   */
  private restoreWorkspace(): void {
    if (this.originalWorkspace) {
      setActiveWorkspaceBinding(this.originalWorkspace);
      this.originalWorkspace = null;
      logger.debug("Restored original workspace binding");
    }
  }

  /**
   * Emit status update to callback.
   */
  private emitStatus(): void {
    if (this.onStatus) {
      this.onStatus(this.getStatus());
    }
  }

  /**
   * Save event log to disk.
   */
  private async saveEventLog(): Promise<void> {
    try {
      await saveLog(this.planPath, this.eventLog);
    } catch (error) {
      logger.error("Failed to save event log", { error });
    }
  }
}

/**
 * Create and start an orchestration controller.
 */
export async function startOrchestration(
  config: OrchestrationControllerConfig,
): Promise<OrchestrationController> {
  const controller = new OrchestrationController(config);
  await controller.start();
  return controller;
}
