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
    "## MANDATORY: Call `request_review` When Done",
    "",
    "**You MUST call the `request_review` tool when you have finished implementing the step.**",
    "This is how you hand off to the reviewer. Without calling `request_review`, the workflow cannot proceed.",
    "Do not continue working indefinitely - once the acceptance criteria are met, call `request_review` immediately.",
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
    "## Workflow",
    "",
    "1. Read the intent and spec files to understand the full context",
    "2. Implement the current step according to the acceptance criteria",
    "3. **Make a git commit for this step** before requesting review",
    "4. **Call `request_review` to submit your work for review** (REQUIRED)",
    "",
    "**Important:** Before calling `request_review`, make a git commit for this step.",
    "Do not request review on uncommitted work. The reviewer will only review committed changes.",
    "",
    "## What NOT to Do",
    "",
    "- **Do NOT create documentation files** (README, .md files, etc.) unless explicitly requested in the spec",
    "- **Do NOT create verification scripts** or test files named after steps (e.g., `verify-step1.sh`)",
    "- **Do NOT use plan-specific naming** in code, comments, or filenames (e.g., `step2Config`, `# For step 3`)",
    "- **Do NOT over-engineer** - implement exactly what's needed, nothing more",
    "",
    "The plan is temporary; the code is permanent. All artifacts should stand on their own without plan context.",
    "",
    "## Available Tools",
    "",
    "- `request_review()` - **REQUIRED** when done. Submits your work for review.",
    "- `ask_user(message)` - **REQUIRED** when you need user input. Pauses the workflow.",
    "",
    "## CRITICAL: How to Ask Questions",
    "",
    "**If you need to ask the user a question, you MUST call the `ask_user` tool.**",
    "Questions written in regular text output will NOT be seen by the user and will NOT pause the workflow.",
    "The only way to get user input is through the `ask_user` tool.",
    "",
    "Example: Instead of writing 'Should I use approach A or B?', call `ask_user({ message: 'Should I use approach A or B?' })`",
    "",
    "Focus on completing this step, commit your changes, then call `request_review`. Do not move to other steps.",
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
    "## MANDATORY: You Must Call `approve` or `request_changes`",
    "",
    "**You MUST end your review by calling either `approve` or `request_changes`.**",
    "This is how you hand off control. Without calling one of these tools, the workflow cannot proceed.",
    "",
    "- Call `approve()` if the implementation meets the acceptance criteria",
    "- Call `request_changes(reason)` if changes are needed, with specific instructions",
    "",
    "Do not review indefinitely - make a decision and call the appropriate tool.",
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
    "1. Check that changes are committed (run `git status`)",
    "2. Read the plan step's acceptance criteria",
    "3. Verify the implementation meets the criteria",
    "4. Check for regressions on prior steps",
    "5. Run tests if applicable (`just pre-merge` or project CI)",
    "6. **Call `approve` or `request_changes`** (REQUIRED)",
    "",
    "**Important:** Review only committed changes. If there are uncommitted changes or no",
    "step-specific commit, call `request_changes` and ask the coder to commit first.",
    "",
    "**Reject plan-specific artifacts:** Code, comments, and filenames must be appropriate long-term.",
    "Reject any references to the plan, step numbers, or task-specific context that won't make sense",
    "after the plan is completed. Examples to reject:",
    "- Comments like `# Required by step 3` or `// Added for plan task`",
    "- Filenames like `step3-helper.ts` or `plan-migration.sql`",
    "- Variable names like `step2Config` or `planTaskResult`",
    "The plan is temporary; the code is permanent. All artifacts should stand on their own.",
    "",
    "**Reject unsolicited markdown files:** Do not approve new `.md` files (README, docs, etc.)",
    "unless they were explicitly requested in the spec or plan. Coders tend to over-document;",
    "only accept documentation that was specifically asked for.",
    "",
    "## Available Tools",
    "",
    "- `approve()` - **Call this** when the step meets acceptance criteria",
    "- `request_changes(reason)` - **Call this** when changes are needed (be specific)",
    "- `ask_user(message)` - Ask the user a question if you need clarification",
    "- All standard tools (bash, read, etc.) are available for verification",
    "",
    "You can run any commands needed to verify the implementation (git status, git log, git diff, tests, etc.).",
    "If you need code changes, call `request_changes` with specific instructions for the coder.",
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
    return `Please implement step "${config.activeStep}" according to the plan. Read the intent and spec files first to understand the context. When you have finished implementing the step, you MUST call \`request_review\` to submit your work.`;
  } else {
    return `Please review step "${config.activeStep}". Check if the implementation meets the acceptance criteria in the plan. When you have completed your review, you MUST call either \`approve\` or \`request_changes\`.`;
  }
}
