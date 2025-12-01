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
import { filterToolsForRole, createReadOnlyInterceptor } from "./tool-filter";
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

  constructor(controllerConfig: OrchestrationControllerConfig) {
    this.planPath = controllerConfig.planPath;
    this.planDir = dirname(controllerConfig.planPath);
    this.config = controllerConfig.config;
    this.roleModels = controllerConfig.roleModels || {};
    this.onStatus = controllerConfig.onStatus;
    this.onOutput = controllerConfig.onOutput;
    this.flowConfigOverrides = controllerConfig.flowConfig;
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
      throw new Error(resumeResult.error || "Failed to resume orchestration");
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
   * Main orchestration loop.
   */
  private async runLoop(): Promise<void> {
    while (this.controllerState === "running") {
      const state = this.flowMachine.getState();
      logger.debug("Orchestration loop iteration", { state });

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
          logger.error("Unknown flow state", { state });
          this.controllerState = "error";
          return;
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
        // Agent completed without calling orchestration tool
        // This shouldn't happen, but handle gracefully
        logger.warn("Coder completed without calling orchestration tool");
        return;
      }

      // Process the action
      await this.processToolAction(role, action);
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

    // Bind workspace to plan directory with read-only access for reviewer
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

      // Build toolset with orchestration tools (reviewer is read-only)
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
        logger.warn("Reviewer completed without calling orchestration tool");
        return;
      }

      // Process the action
      await this.processToolAction(role, action);
    } finally {
      // Restore original workspace
      this.restoreWorkspace();
    }
  }

  /**
   * Run agent and capture orchestration tool action.
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

    try {
      const generator = runAgent(
        messages,
        agentConfig,
        (toolName) => {
          logger.debug("Tool called", { role, toolName });
        },
        undefined, // Let agent run until it calls an orchestration tool
        this.abortController.signal,
        toolset, // Pass custom toolset
        systemPrompt, // Pass orchestration-specific system prompt
      );

      for await (const event of generator) {
        // Emit output to UI
        this.onOutput?.(role, event);

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
            // Don't break here - let the agent complete cleanly
          }
        }

        // Handle errors
        if (event.type === "error") {
          this.eventLog = logError(this.eventLog, event.error || "Unknown error");
          throw new Error(event.error);
        }

        // If we got an orchestration action, we can stop after this event cycle
        if (orchestrationAction && event.type === "done") {
          break;
        }
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        logger.info("Agent aborted", { role });
        return null;
      }
      throw error;
    } finally {
      this.abortController = undefined;
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
    }

    // Sync and save log
    this.eventLog = syncLogState(this.eventLog, this.flowMachine);
    await this.saveEventLog();

    // Emit status update
    this.emitStatus();
  }

  /**
   * Build messages for agent.
   */
  private buildAgentMessages(
    role: AgentRole,
  ): Array<{ role: "user" | "assistant"; content: MessageContent }> {
    const driver = role === "coder" ? this.coderDriver : this.reviewerDriver;

    // Start with context seed
    const contextSeed = driver.getContextSeed();

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

    messages.push({
      role: "user",
      content: contextSeed,
    });

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

    // For reviewer, wrap bash with read-only interceptor to block write commands at runtime
    if (role === "reviewer" && filteredBaseTools.bash) {
      const interceptor = createReadOnlyInterceptor(role);
      const originalBash = filteredBaseTools.bash as any;

      // Create a wrapper that checks commands before execution
      const wrappedBash = {
        ...originalBash,
        execute: async (args: { command: string }, options: any) => {
          const check = interceptor.check("bash", args);
          if (!check.allowed) {
            return {
              blocked: true,
              reason: check.reason || "Write operations not allowed in reviewer mode",
              stdout: "",
              stderr: check.reason || "Blocked",
              exitCode: 1,
            };
          }
          return originalBash.execute(args, options);
        },
      };
      filteredBaseTools.bash = wrappedBash;
    }

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
      // Numbered lists: "1. ..." "2. ..."
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
   * Coder gets write access, reviewer gets read-only.
   */
  private setWorkspaceForRole(role: AgentRole): void {
    // Save original workspace to restore later
    this.originalWorkspace = getActiveWorkspaceBinding();

    // Create workspace binding for this role
    const binding: WorkspaceBinding = {
      id: `ws:orchestration:${role}:${this.planDir}`,
      cwd: this.planDir,
      isolationMode: role === "reviewer" ? "sandbox" : "shared",
      allowWrites: role === "coder",
      label: `${role} workspace (${role === "coder" ? "writable" : "read-only"})`,
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
