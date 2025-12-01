/**
 * Prompt builders for coder and reviewer agents.
 *
 * Builds role-specific system prompts with current step context,
 * intent/spec pointers, and prior history summaries.
 */

import type { AgentRole } from "./flow-types";
import type { PromptConfig } from "./agent-driver-types";

/**
 * Build the system prompt for a coder agent.
 *
 * Coder gets:
 * - Role description
 * - Current step from plan
 * - Pointers to intent.md and spec.md
 * - Summary of prior approvals/rejections
 */
export function buildCoderPrompt(config: PromptConfig): string {
  const lines: string[] = [
    "# Role: Coder",
    "",
    "You are the coder agent working on implementing a plan step by step.",
    "Your job is to implement the current step according to the specification.",
    "",
    "## Current Step",
    "",
    `You are working on step: **${config.activeStep}**`,
    "",
  ];

  if (config.stepContent) {
    lines.push("### Step Details", "", config.stepContent, "");
  }

  lines.push(
    "## Reference Documents",
    "",
    `- **Plan:** ${config.planPath}`,
    `- **Intent:** ${config.intentPath} (read this to understand the user's goals)`,
    `- **Spec:** ${config.specPath} (read this for detailed requirements)`,
    "",
  );

  if (config.priorHistory) {
    lines.push(
      "## Prior History",
      "",
      config.priorHistory,
      "",
    );
  }

  lines.push(
    "## Instructions",
    "",
    "1. Read the intent and spec files to understand the full context",
    "2. Implement the current step according to the acceptance criteria",
    "3. When done, use the `request_review` tool to submit for review",
    "4. If you need clarification, use the `ask_user` tool",
    "",
    "Focus on completing this step before moving to the next.",
  );

  return lines.join("\n");
}

/**
 * Build the system prompt for a reviewer agent.
 *
 * Reviewer gets:
 * - Role description
 * - Current step being reviewed
 * - Pointers to intent.md and spec.md
 * - Cumulative history of prior reviews
 */
export function buildReviewerPrompt(config: PromptConfig): string {
  const lines: string[] = [
    "# Role: Reviewer",
    "",
    "You are the reviewer agent responsible for verifying implementation quality.",
    "Your job is to review the coder's work and ensure it meets the acceptance criteria.",
    "",
    "## Current Step Under Review",
    "",
    `Reviewing step: **${config.activeStep}**`,
    "",
  ];

  if (config.stepContent) {
    lines.push("### Step Details", "", config.stepContent, "");
  }

  lines.push(
    "## Reference Documents",
    "",
    `- **Plan:** ${config.planPath}`,
    `- **Intent:** ${config.intentPath} (understand user goals)`,
    `- **Spec:** ${config.specPath} (detailed requirements)`,
    "",
  );

  if (config.priorHistory) {
    lines.push(
      "## Review History",
      "",
      "Previous reviews and decisions:",
      "",
      config.priorHistory,
      "",
    );
  }

  lines.push(
    "## Review Checklist",
    "",
    "1. Read the plan step's acceptance criteria",
    "2. Verify the implementation meets the criteria",
    "3. Check for regressions on prior steps",
    "4. Consider risks for future steps",
    "5. Run tests if applicable (`just pre-merge` or project CI)",
    "",
    "## Available Actions",
    "",
    "- `approve()` - Step meets acceptance criteria, advance to next step",
    "- `request_changes(reason)` - Changes needed before approval",
    "- `ask_user(message)` - Need clarification from the user",
    "",
    "**Important:** You are in read-only mode. You cannot modify files.",
    "If you need code changes, use `request_changes` with specific instructions.",
  );

  return lines.join("\n");
}

/**
 * Build a prompt for the specified role.
 */
export function buildPrompt(role: AgentRole, config: PromptConfig): string {
  switch (role) {
    case "coder":
      return buildCoderPrompt(config);
    case "reviewer":
      return buildReviewerPrompt(config);
    default:
      throw new Error(`Unknown role: ${role}`);
  }
}

/**
 * Build a context seed message for starting an agent.
 *
 * This is the initial user message that provides context to the agent.
 */
export function buildContextSeed(role: AgentRole, config: PromptConfig): string {
  if (role === "coder") {
    return `Please implement step "${config.activeStep}" according to the plan. Read the intent and spec files first to understand the context.`;
  } else {
    return `Please review step "${config.activeStep}". Check if the implementation meets the acceptance criteria in the plan.`;
  }
}
