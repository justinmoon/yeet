/**
 * Types for agent drivers in coder/reviewer orchestration.
 *
 * Agent drivers manage the execution context, prompts, and workspace
 * permissions for coder and reviewer agents.
 */

import type { AgentRole } from "./flow-types";

/**
 * Model authentication configuration.
 *
 * Determines how instructions are delivered to the model:
 * - Codex with OAuth: Instructions go in user message (system prompt is locked)
 * - Everything else: Instructions go in system prompt
 */
export interface ModelAuthConfig {
  /** The model being used */
  model: string;

  /** Authentication type */
  authType: "oauth" | "api-key" | "anthropic";

  /** Whether this is a Codex model (gpt-5-codex, etc.) */
  isCodex: boolean;
}

/**
 * Check if instructions must be injected as user message.
 *
 * Codex with OAuth doesn't allow custom system prompts, so we inject
 * instructions as a user message (like AGENTS.md).
 */
export function requiresUserMessageInjection(config: ModelAuthConfig): boolean {
  return config.isCodex && config.authType === "oauth";
}

/**
 * User message prefix for injected instructions (matches Codex AGENTS.md format).
 */
export const INSTRUCTIONS_PREFIX = "# Agent instructions for";

/**
 * Format instructions as a user message (like Codex does with AGENTS.md).
 *
 * @example
 * formatInstructionsAsUserMessage("coder", "You are a coder...")
 * // => "# Agent instructions for coder\n\n<INSTRUCTIONS>\nYou are a coder...\n</INSTRUCTIONS>"
 */
export function formatInstructionsAsUserMessage(
  role: AgentRole,
  instructions: string,
): string {
  return `${INSTRUCTIONS_PREFIX} ${role}\n\n<INSTRUCTIONS>\n${instructions}\n</INSTRUCTIONS>`;
}

/**
 * Message in an agent's conversation history.
 */
export interface AgentMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/**
 * Configuration for building agent prompts.
 */
export interface PromptConfig {
  /** Path to the plan file (docs/<feature>/plan.md) */
  planPath: string;

  /** Path to the intent file (docs/<feature>/intent.md) */
  intentPath: string;

  /** Path to the spec file (docs/<feature>/spec.md) */
  specPath: string;

  /** Current active step identifier */
  activeStep: string;

  /** The step's content/description from the plan body */
  stepContent?: string;

  /** Summary of prior approvals/rejections for context */
  priorHistory?: string;
}

/**
 * Workspace configuration for an agent.
 */
export interface AgentWorkspaceConfig {
  /** Working directory for the agent */
  cwd: string;

  /** Whether the agent can write files */
  allowWrites: boolean;

  /** Label for the workspace (shown in errors) */
  label?: string;
}

/**
 * Configuration for creating an agent driver.
 */
export interface AgentDriverConfig {
  /** The agent's role */
  role: AgentRole;

  /** Workspace configuration */
  workspace: AgentWorkspaceConfig;

  /** Prompt configuration */
  prompt: PromptConfig;

  /** Maximum history messages to retain (for reviewer) */
  maxHistoryMessages?: number;

  /** Model authentication config (determines how instructions are delivered) */
  modelAuth?: ModelAuthConfig;
}

/**
 * A tool call made by an agent.
 */
export interface AgentToolCall {
  /** The tool name */
  name: string;

  /** The tool arguments */
  args: Record<string, unknown>;

  /** Result of the tool call */
  result?: string;

  /** Timestamp of the call */
  timestamp: number;
}

/**
 * Output from an agent that should be tagged for display.
 */
export interface TaggedOutput {
  /** The agent role that produced this output */
  role: AgentRole;

  /** The type of output */
  type: "message" | "tool_call" | "tool_result";

  /** The tool name (if type is tool_call or tool_result) */
  toolName?: string;

  /** The content */
  content: string;

  /** Timestamp */
  timestamp: number;
}

/**
 * Format a tagged output for display.
 *
 * @example
 * formatTaggedOutput({ role: "coder", type: "message", content: "Done" })
 * // => "[coder] Done"
 *
 * formatTaggedOutput({ role: "reviewer", type: "tool_call", toolName: "bash", content: "ls" })
 * // => "[reviewer:bash] ls"
 */
export function formatTaggedOutput(output: TaggedOutput): string {
  const prefix = formatPrefix(output.role, output.type, output.toolName);
  return `${prefix} ${output.content}`;
}

/**
 * Format a prefix for agent output.
 *
 * @example
 * formatPrefix("coder", "message") // => "[coder]"
 * formatPrefix("reviewer", "tool_call", "bash") // => "[reviewer:bash]"
 */
export function formatPrefix(
  role: AgentRole,
  type: "message" | "tool_call" | "tool_result",
  toolName?: string,
): string {
  if (type === "tool_call" || type === "tool_result") {
    return `[${role}:${toolName || "tool"}]`;
  }
  return `[${role}]`;
}

/**
 * Parse a prefix to extract role and tool name.
 *
 * @example
 * parsePrefix("[coder]") // => { role: "coder" }
 * parsePrefix("[reviewer:bash]") // => { role: "reviewer", toolName: "bash" }
 */
export function parsePrefix(
  prefix: string,
): { role: AgentRole; toolName?: string } | null {
  const match = prefix.match(/^\[(\w+)(?::(\w+))?\]$/);
  if (!match) return null;

  const role = match[1] as AgentRole;
  if (role !== "coder" && role !== "reviewer") return null;

  return {
    role,
    toolName: match[2],
  };
}
