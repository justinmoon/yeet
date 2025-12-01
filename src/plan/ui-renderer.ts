/**
 * UI renderer for coder/reviewer orchestration.
 *
 * Provides functions to render orchestration UI elements:
 * - Status bar with active agent and step
 * - Agent-prefixed messages and tool calls
 * - Ask-user prompts with blocking state
 * - Step progress display
 */

import { type StyledText, bold, dim, fg, t } from "@opentui/core";
import { getCurrentTheme } from "../ui/colors";
import type { AgentRole, FlowState } from "./flow-types";
import type { OrchestrationUIState } from "./ui-state";

/**
 * Colors for orchestration UI (extend the theme dynamically).
 */
export const orchestrationColors = {
  /** Coder agent color - green (implementing) */
  coder: () => fg(getCurrentTheme().successGreen),

  /** Reviewer agent color - cyan (reviewing) */
  reviewer: () => fg(getCurrentTheme().agentCyan),

  /** Step indicator color */
  step: () => fg(getCurrentTheme().userBlue),

  /** Blocked/waiting state color */
  blocked: () => fg(getCurrentTheme().warningYellow),

  /** Error state color */
  error: () => fg(getCurrentTheme().errorRed),
};

/**
 * Agent display names for UI.
 */
const AGENT_DISPLAY_NAMES: Record<AgentRole, string> = {
  coder: "Coder",
  reviewer: "Reviewer",
};

/**
 * Agent status indicators.
 */
const AGENT_STATUS_ICONS: Record<AgentRole, string> = {
  coder: "🔨",
  reviewer: "👀",
};

/**
 * Format the orchestration status bar.
 *
 * Shows: [Active Agent] | Step X/Y | Change requests: N
 *
 * @example
 * "🔨 Coder | Step 2/5 | Changes: 0"
 * "👀 Reviewer | Step 2/5 | Changes: 1"
 * "⏳ Waiting for user | Step 2/5"
 */
export function formatOrchestrationStatus(state: OrchestrationUIState): string {
  if (!state.active) {
    return "";
  }

  const parts: string[] = [];

  // Agent indicator
  if (state.awaitingUser) {
    parts.push("⏳ Waiting for user");
  } else if (state.flowState === "error") {
    parts.push("❌ Error");
  } else if (state.activeAgent) {
    const icon = AGENT_STATUS_ICONS[state.activeAgent];
    const name = AGENT_DISPLAY_NAMES[state.activeAgent];
    parts.push(`${icon} ${name}`);
  }

  // Step indicator
  if (state.totalSteps) {
    parts.push(`Step ${state.activeStep}/${state.totalSteps}`);
  } else {
    parts.push(`Step ${state.activeStep}`);
  }

  // Change request count (only show if > 0)
  if (state.changeRequestCount > 0 && !state.awaitingUser) {
    parts.push(`Changes: ${state.changeRequestCount}`);
  }

  return parts.join(" | ");
}

/**
 * Format the agent prefix for messages.
 *
 * @example
 * formatAgentPrefix("coder") => "[coder]"
 * formatAgentPrefix("coder", "bash") => "[coder:bash]"
 */
export function formatAgentPrefix(
  role: AgentRole,
  toolName?: string,
): StyledText {
  const colorFn = role === "coder" ? orchestrationColors.coder() : orchestrationColors.reviewer();

  if (toolName) {
    return colorFn(`[${role}:${toolName}]`);
  }
  return colorFn(`[${role}]`);
}

/**
 * Format an agent message with prefix.
 *
 * @example
 * "[coder] Starting implementation of step 2..."
 */
export function formatAgentMessage(
  role: AgentRole,
  content: string,
): StyledText {
  const prefix = formatAgentPrefix(role);
  return t`${prefix} ${content}\n`;
}

/**
 * Format an agent tool call with prefix.
 *
 * @example
 * "[coder:edit] src/main.ts +10/-2"
 */
export function formatAgentToolCall(
  role: AgentRole,
  toolName: string,
  summary: string,
): StyledText {
  const prefix = formatAgentPrefix(role, toolName);
  return t`${prefix} ${summary}\n`;
}

/**
 * Format an ask-user prompt with blocking indicator.
 *
 * @example
 * "╭─ [coder] Question ─────────────────────╮
 *  │ Which approach should I use?           │
 *  │                                        │
 *  │ ⏳ Waiting for your response...        │
 *  ╰────────────────────────────────────────╯"
 */
export function formatAskUserPrompt(
  requester: AgentRole | undefined,
  message: string,
): StyledText {
  const requesterName = requester
    ? AGENT_DISPLAY_NAMES[requester]
    : "Agent";

  const colorFn = requester === "coder"
    ? orchestrationColors.coder()
    : orchestrationColors.reviewer();

  const header = colorFn(`[${requester || "agent"}]`);
  const blockingIndicator = orchestrationColors.blocked()("⏳ Waiting for your response...");

  // Simple format without box drawing for compatibility
  return t`
${header} ${bold("Question")}
  ${message}

  ${blockingIndicator}
`;
}

/**
 * Format the step progress header.
 *
 * @example
 * "═══ Step 2: Implementation ═══"
 */
export function formatStepHeader(
  stepId: string,
  stepContent?: string,
  totalSteps?: number,
): StyledText {
  const stepColor = orchestrationColors.step();

  let stepLabel = `Step ${stepId}`;
  if (totalSteps) {
    stepLabel = `Step ${stepId}/${totalSteps}`;
  }

  const header = stepColor(bold(`═══ ${stepLabel} ═══`));

  if (stepContent) {
    const contentLine = dim(stepContent.slice(0, 60) + (stepContent.length > 60 ? "..." : ""));
    return t`\n${header}\n${contentLine}\n`;
  }

  return t`\n${header}\n`;
}

/**
 * Format a step completion message.
 *
 * @example
 * "✓ Step 2 approved"
 */
export function formatStepApproved(stepId: string): StyledText {
  const successColor = fg(getCurrentTheme().successGreen);
  return t`${successColor(`✓ Step ${stepId} approved`)}\n`;
}

/**
 * Format a change request message.
 *
 * @example
 * "↩ Changes requested (2/3): Fix the bug in line 42"
 */
export function formatChangeRequest(
  reason: string,
  count: number,
  maxCount: number,
): StyledText {
  const warningColor = orchestrationColors.blocked();
  return t`${warningColor(`↩ Changes requested (${count}/${maxCount})`)}: ${reason}\n`;
}

/**
 * Format a loop guard warning.
 *
 * @example
 * "⚠️ Loop guard triggered: Too many change requests on step 2"
 */
export function formatLoopGuardWarning(
  stepId: string,
  count: number,
): StyledText {
  const errorColor = orchestrationColors.error();
  return t`${errorColor(`⚠️ Loop guard triggered`)}: ${count} change requests on step ${stepId}. User intervention required.\n`;
}

/**
 * Format an error message.
 *
 * @example
 * "❌ Error: API timeout"
 */
export function formatError(message: string): StyledText {
  const errorColor = orchestrationColors.error();
  return t`${errorColor(`❌ Error`)}: ${message}\n`;
}

/**
 * Format the orchestration activation message.
 *
 * @example
 * "🎭 Orchestration started: docs/feature/plan.md"
 */
export function formatOrchestrationStarted(
  planPath: string,
  activeStep: string,
): StyledText {
  const stepColor = orchestrationColors.step();
  return t`🎭 ${bold("Orchestration started")}: ${planPath}\n   Starting at ${stepColor(`Step ${activeStep}`)}\n`;
}

/**
 * Format the orchestration completion message.
 *
 * @example
 * "🎉 All steps completed!"
 */
export function formatOrchestrationComplete(): StyledText {
  const successColor = fg(getCurrentTheme().successGreen);
  return t`${successColor(bold("🎉 All steps completed!"))}\n`;
}

/**
 * Format agent transition message.
 *
 * @example
 * "→ Switching to Reviewer"
 */
export function formatAgentTransition(
  fromAgent: AgentRole | null,
  toAgent: AgentRole,
): StyledText {
  const colorFn = toAgent === "coder"
    ? orchestrationColors.coder()
    : orchestrationColors.reviewer();
  const name = AGENT_DISPLAY_NAMES[toAgent];
  const icon = AGENT_STATUS_ICONS[toAgent];
  return t`${dim("→")} ${colorFn(`${icon} ${name}`)}\n`;
}

/**
 * Create a formatted orchestration header for the status bar.
 * This is used to update the status area of the TUI.
 */
export function createOrchestrationStatusText(
  state: OrchestrationUIState,
  modelInfo?: string,
): string {
  const orchestrationStatus = formatOrchestrationStatus(state);

  if (modelInfo && orchestrationStatus) {
    return `${modelInfo} | ${orchestrationStatus}`;
  }

  return orchestrationStatus || modelInfo || "";
}
