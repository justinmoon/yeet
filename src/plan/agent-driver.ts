/**
 * Agent driver for coder/reviewer orchestration.
 *
 * Manages agent execution context, prompts, message history,
 * workspace permissions, and output tagging.
 */

import type { AgentRole } from "./flow-types";
import type {
  AgentDriverConfig,
  AgentMessage,
  AgentToolCall,
  AgentWorkspaceConfig,
  ModelAuthConfig,
  PromptConfig,
  TaggedOutput,
} from "./agent-driver-types";
import {
  formatPrefix,
  formatTaggedOutput,
  formatInstructionsAsUserMessage,
  requiresUserMessageInjection,
} from "./agent-driver-types";
import { buildPrompt, buildContextSeed } from "./prompt-builder";
import type { WorkspaceBinding } from "../workspace/binding";

/**
 * Default maximum history messages for reviewer (to prevent context overflow).
 */
const DEFAULT_MAX_HISTORY = 50;

/**
 * Agent driver that manages context and execution for coder/reviewer agents.
 */
export class AgentDriver {
  readonly role: AgentRole;
  private workspace: AgentWorkspaceConfig;
  private promptConfig: PromptConfig;
  private messageHistory: AgentMessage[] = [];
  private toolCalls: AgentToolCall[] = [];
  private maxHistoryMessages: number;
  private modelAuth?: ModelAuthConfig;

  constructor(config: AgentDriverConfig) {
    this.role = config.role;
    this.workspace = config.workspace;
    this.promptConfig = config.prompt;
    this.maxHistoryMessages = config.maxHistoryMessages ?? DEFAULT_MAX_HISTORY;
    this.modelAuth = config.modelAuth;
  }

  /**
   * Get the agent's role.
   */
  getRole(): AgentRole {
    return this.role;
  }

  /**
   * Check if this agent has write permissions.
   */
  canWrite(): boolean {
    return this.workspace.allowWrites;
  }

  /**
   * Get the workspace binding for this agent.
   */
  getWorkspaceBinding(): WorkspaceBinding {
    return {
      id: `ws:${this.role}:${this.workspace.cwd}`,
      cwd: this.workspace.cwd,
      isolationMode: this.workspace.allowWrites ? "shared" : "sandbox",
      allowWrites: this.workspace.allowWrites,
      label: this.workspace.label || `${this.role} workspace`,
    };
  }

  /**
   * Check if this agent requires user message injection for instructions.
   *
   * When true, instructions cannot go in the system prompt and must be
   * injected as a user message (like Codex does with AGENTS.md).
   */
  requiresUserMessageInjection(): boolean {
    if (!this.modelAuth) return false;
    return requiresUserMessageInjection(this.modelAuth);
  }

  /**
   * Get the system prompt for this agent.
   *
   * Returns null if using Codex with OAuth (use getInstructionsAsUserMessage instead).
   */
  getSystemPrompt(): string | null {
    if (this.requiresUserMessageInjection()) {
      return null;
    }
    return buildPrompt(this.role, this.promptConfig);
  }

  /**
   * Get instructions formatted as a user message (for Codex OAuth).
   *
   * This follows the same pattern Codex uses for AGENTS.md content.
   */
  getInstructionsAsUserMessage(): string {
    const instructions = buildPrompt(this.role, this.promptConfig);
    return formatInstructionsAsUserMessage(this.role, instructions);
  }

  /**
   * Get the initial context seed message.
   */
  getContextSeed(): string {
    return buildContextSeed(this.role, this.promptConfig);
  }

  /**
   * Update the model authentication config.
   */
  setModelAuth(modelAuth: ModelAuthConfig): void {
    this.modelAuth = modelAuth;
  }

  /**
   * Get the current model authentication config.
   */
  getModelAuth(): ModelAuthConfig | undefined {
    return this.modelAuth;
  }

  /**
   * Get the current message history.
   */
  getMessageHistory(): AgentMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Get the tool call history.
   */
  getToolCalls(): AgentToolCall[] {
    return [...this.toolCalls];
  }

  /**
   * Add a message to the history.
   */
  addMessage(role: "user" | "assistant" | "system", content: string): void {
    this.messageHistory.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Trim history if needed (for reviewer's cumulative context)
    if (this.messageHistory.length > this.maxHistoryMessages) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistoryMessages);
    }
  }

  /**
   * Record a tool call.
   */
  recordToolCall(name: string, args: Record<string, unknown>, result?: string): void {
    this.toolCalls.push({
      name,
      args,
      result,
      timestamp: Date.now(),
    });
  }

  /**
   * Reset the context (for coder between steps).
   *
   * Clears message history and tool calls, updates prompt config.
   */
  resetContext(newPromptConfig: PromptConfig): void {
    this.messageHistory = [];
    this.toolCalls = [];
    this.promptConfig = newPromptConfig;
  }

  /**
   * Update the prompt config without clearing history (for reviewer).
   */
  updatePromptConfig(newPromptConfig: PromptConfig): void {
    this.promptConfig = newPromptConfig;
  }

  /**
   * Add prior history summary to the prompt config.
   */
  setPriorHistory(history: string): void {
    this.promptConfig = {
      ...this.promptConfig,
      priorHistory: history,
    };
  }

  /**
   * Format a message output with the appropriate tag.
   */
  tagMessage(content: string): TaggedOutput {
    return {
      role: this.role,
      type: "message",
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * Format a tool call output with the appropriate tag.
   */
  tagToolCall(toolName: string, content: string): TaggedOutput {
    return {
      role: this.role,
      type: "tool_call",
      toolName,
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * Format a tool result output with the appropriate tag.
   */
  tagToolResult(toolName: string, content: string): TaggedOutput {
    return {
      role: this.role,
      type: "tool_result",
      toolName,
      content,
      timestamp: Date.now(),
    };
  }

  /**
   * Get the prefix for this agent's output.
   */
  getPrefix(toolName?: string): string {
    return formatPrefix(
      this.role,
      toolName ? "tool_call" : "message",
      toolName,
    );
  }

  /**
   * Format output for display.
   */
  formatOutput(output: TaggedOutput): string {
    return formatTaggedOutput(output);
  }

  /**
   * Build a history summary from message history.
   *
   * Used to provide context to the next agent or step.
   */
  buildHistorySummary(maxMessages: number = 10): string {
    const recent = this.messageHistory.slice(-maxMessages);
    if (recent.length === 0) {
      return "No prior messages.";
    }

    return recent
      .map((msg) => `[${msg.role}] ${msg.content.slice(0, 200)}...`)
      .join("\n");
  }

  /**
   * Serialize the driver state for persistence.
   */
  serialize(): SerializedAgentDriver {
    return {
      role: this.role,
      workspace: this.workspace,
      promptConfig: this.promptConfig,
      messageHistory: this.messageHistory,
      toolCalls: this.toolCalls,
      maxHistoryMessages: this.maxHistoryMessages,
      modelAuth: this.modelAuth,
    };
  }

  /**
   * Create a driver from serialized state.
   */
  static deserialize(data: SerializedAgentDriver): AgentDriver {
    const driver = new AgentDriver({
      role: data.role,
      workspace: data.workspace,
      prompt: data.promptConfig,
      maxHistoryMessages: data.maxHistoryMessages,
      modelAuth: data.modelAuth,
    });
    driver.messageHistory = data.messageHistory;
    driver.toolCalls = data.toolCalls;
    return driver;
  }
}

/**
 * Serialized state of an agent driver.
 */
export interface SerializedAgentDriver {
  role: AgentRole;
  workspace: AgentWorkspaceConfig;
  promptConfig: PromptConfig;
  messageHistory: AgentMessage[];
  toolCalls: AgentToolCall[];
  maxHistoryMessages: number;
  modelAuth?: ModelAuthConfig;
}

/**
 * Create a coder driver with writable workspace.
 */
export function createCoderDriver(
  cwd: string,
  promptConfig: PromptConfig,
  modelAuth?: ModelAuthConfig,
): AgentDriver {
  return new AgentDriver({
    role: "coder",
    workspace: {
      cwd,
      allowWrites: true,
      label: "coder workspace",
    },
    prompt: promptConfig,
    modelAuth,
  });
}

/**
 * Create a reviewer driver.
 * Note: Reviewer now has write access (relaxed constraints).
 * Read-only behavior is instructed via prompt, not enforced.
 */
export function createReviewerDriver(
  cwd: string,
  promptConfig: PromptConfig,
  maxHistoryMessages: number = DEFAULT_MAX_HISTORY,
  modelAuth?: ModelAuthConfig,
): AgentDriver {
  return new AgentDriver({
    role: "reviewer",
    workspace: {
      cwd,
      allowWrites: true,
      label: "reviewer workspace",
    },
    prompt: promptConfig,
    maxHistoryMessages,
    modelAuth,
  });
}

/**
 * Create a ModelAuthConfig for common configurations.
 */
export function createModelAuthConfig(
  model: string,
  authType: "oauth" | "api-key" | "anthropic",
): ModelAuthConfig {
  const isCodex = model.toLowerCase().includes("codex") ||
    model.toLowerCase().includes("gpt-5");
  return { model, authType, isCodex };
}
