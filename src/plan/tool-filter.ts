/**
 * Tool filtering for read-only enforcement.
 *
 * Provides utilities to filter and wrap tools to enforce read-only access
 * for the reviewer agent. This is defense-in-depth alongside workspace
 * permission controls.
 */

import type { AgentRole } from "./flow-types";

/**
 * Names of tools that perform write operations.
 * These should be blocked for read-only agents.
 */
export const WRITE_TOOL_NAMES = new Set([
  // File operations
  "write",
  "edit",
  "delete",
  "create",
  "move",
  "rename",
  "mkdir",
  "rmdir",
  "rm",

  // Git operations that modify state
  "git_commit",
  "git_push",
  "git_checkout",
  "git_merge",
  "git_rebase",
  "git_reset",
  "git_stash",

  // Package management
  "npm_install",
  "yarn_add",
  "pip_install",

  // Bash commands that could write (blocked via pattern)
  // Note: bash tool filtering is handled separately
]);

/**
 * Patterns for bash commands that should be blocked for read-only agents.
 */
export const WRITE_BASH_PATTERNS = [
  // File modifications
  /\brm\s/,
  /\brmdir\s/,
  /\bmkdir\s/,
  /\btouch\s/,
  /\bmv\s/,
  /\bcp\s/,
  /\bchmod\s/,
  /\bchown\s/,

  // Redirection that writes
  />\s/,
  />>>/,

  // Git modifications
  /\bgit\s+(commit|push|checkout|merge|rebase|reset|stash|add|rm)/,

  // Package managers
  /\bnpm\s+(install|uninstall|update|publish)/,
  /\byarn\s+(add|remove|install)/,
  /\bpip\s+(install|uninstall)/,

  // Editors that might save
  /\b(vim|vi|nano|emacs)\s/,
];

/**
 * Check if a tool name is a write operation.
 */
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName.toLowerCase());
}

/**
 * Check if a bash command appears to perform writes.
 * This is a heuristic and may have false positives/negatives.
 */
export function isWriteBashCommand(command: string): boolean {
  return WRITE_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Result of a tool filter check.
 */
export interface ToolFilterResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Create a tool filter function for a given role.
 *
 * Returns a function that checks if a tool call should be allowed.
 */
export function createToolFilter(
  role: AgentRole,
): (toolName: string, args?: Record<string, unknown>) => ToolFilterResult {
  if (role === "coder") {
    // Coder has full access
    return () => ({ allowed: true });
  }

  // Reviewer is read-only
  return (
    toolName: string,
    args?: Record<string, unknown>,
  ): ToolFilterResult => {
    // Check explicit write tools
    if (isWriteTool(toolName)) {
      return {
        allowed: false,
        reason: `Reviewer cannot use write tool '${toolName}'. Reviewer operates in read-only mode.`,
      };
    }

    // Check bash commands for write patterns
    if (toolName.toLowerCase() === "bash" && args?.command) {
      const command = String(args.command);
      if (isWriteBashCommand(command)) {
        return {
          allowed: false,
          reason: `Reviewer cannot execute write operation in bash: '${command.slice(0, 50)}...'. Reviewer operates in read-only mode.`,
        };
      }
    }

    return { allowed: true };
  };
}

/**
 * Filter a toolset to only include read-safe tools.
 *
 * @param tools - The tools to filter
 * @param role - The agent role
 * @returns Filtered tools with blocked tools removed
 */
export function filterToolsForRole<T extends Record<string, unknown>>(
  tools: T,
  role: AgentRole,
): Partial<T> {
  if (role === "coder") {
    return tools;
  }

  // For reviewer, filter out write tools
  const filtered: Record<string, unknown> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (!isWriteTool(name)) {
      filtered[name] = tool;
    }
  }

  return filtered as Partial<T>;
}

/**
 * Wrap a tool executor to enforce read-only for a given role.
 *
 * This creates an interceptor that checks each tool call before execution.
 */
export function createReadOnlyInterceptor(role: AgentRole) {
  const filter = createToolFilter(role);

  return {
    /**
     * Check if a tool call should be allowed.
     */
    check(
      toolName: string,
      args?: Record<string, unknown>,
    ): ToolFilterResult {
      return filter(toolName, args);
    },

    /**
     * Wrap an execute function to enforce read-only.
     */
    wrap<TArgs, TResult>(
      toolName: string,
      execute: (args: TArgs) => Promise<TResult>,
    ): (args: TArgs) => Promise<TResult | { blocked: true; reason: string }> {
      return async (args: TArgs) => {
        const result = filter(toolName, args as Record<string, unknown>);
        if (!result.allowed) {
          return {
            blocked: true,
            reason: result.reason || "Operation not allowed in read-only mode",
          };
        }
        return execute(args);
      };
    },
  };
}
