/**
 * Workflow definitions for orchestration
 */

import type { Workflow } from "./state";

export const CODE_REVIEW_WORKFLOW: Workflow = {
  name: "code_review",
  description:
    "Review code changes for security, style, and correctness before approval",
  initialStage: "analyze",

  stages: {
    analyze: {
      name: "analyze",
      description: "Analyze the code changes to understand what was modified",
      goal: "Identify what changed, assess complexity, and determine initial risk level",
      tools: ["read", "search", "bash"],
      transitions: [
        {
          condition:
            "Security risks, vulnerabilities, or concerning patterns identified",
          next: "security",
        },
        {
          condition: "No security concerns found, code appears safe",
          next: "style",
        },
      ],
    },

    security: {
      name: "security",
      description: "Deep security analysis of the changes",
      goal: "Verify no security vulnerabilities exist (XSS, SQL injection, authentication issues, etc.)",
      tools: ["read", "search", "bash"],
      transitions: [
        {
          condition:
            "Critical security issue found that makes code unsafe and cannot be easily fixed",
          next: "reject",
        },
        {
          condition:
            "Security concerns are minor, addressed, or acceptable with notes",
          next: "style",
        },
      ],
    },

    style: {
      name: "style",
      description: "Check code style, formatting, and conventions",
      goal: "Ensure code follows project style guidelines, is readable, and maintainable",
      tools: ["read", "bash"], // Can run linters, formatters
      transitions: [
        {
          condition:
            "Style issues, formatting problems, or convention violations found",
          next: "suggest",
        },
        {
          condition: "Code style is acceptable and follows conventions",
          next: "approve",
        },
      ],
    },

    suggest: {
      name: "suggest",
      description: "Suggest fixes for style and minor issues",
      goal: "Provide actionable, specific suggestions to improve code quality",
      tools: ["read"],
      transitions: [
        {
          condition: "Suggestions provided",
          next: "approve",
        },
      ],
    },

    approve: {
      name: "approve",
      description: "Approve the code changes",
      goal: "Give final approval with summary of review",
      tools: [],
      transitions: [],
      isFinal: true,
    },

    reject: {
      name: "reject",
      description: "Reject the code changes",
      goal: "Clearly explain why the changes are rejected and what must be fixed",
      tools: [],
      transitions: [],
      isFinal: true,
    },
  },
};

export const BUG_INVESTIGATION_WORKFLOW: Workflow = {
  name: "bug_investigation",
  description: "Systematically investigate and diagnose a reported bug",
  initialStage: "reproduce",

  stages: {
    reproduce: {
      name: "reproduce",
      description: "Attempt to reproduce the reported bug",
      goal: "Verify the bug exists and understand reproduction steps",
      tools: ["read", "bash", "search"],
      transitions: [
        {
          condition: "Bug reproduced successfully",
          next: "analyze",
        },
        {
          condition: "Cannot reproduce bug or bug does not exist",
          next: "close",
        },
      ],
    },

    analyze: {
      name: "analyze",
      description: "Analyze the bug to understand root cause",
      goal: "Identify the root cause of the bug through code analysis",
      tools: ["read", "search", "bash"],
      transitions: [
        {
          condition: "Root cause identified",
          next: "fix",
        },
        {
          condition:
            "Cannot determine root cause, need more information or different approach",
          next: "escalate",
        },
      ],
    },

    fix: {
      name: "fix",
      description: "Implement a fix for the bug",
      goal: "Create a fix that resolves the bug without introducing new issues",
      tools: ["read", "write", "edit", "bash"],
      transitions: [
        {
          condition: "Fix implemented and verified",
          next: "close",
        },
      ],
    },

    escalate: {
      name: "escalate",
      description: "Escalate the bug for human review",
      goal: "Document findings and explain why escalation is needed",
      tools: ["read"],
      transitions: [],
      isFinal: true,
    },

    close: {
      name: "close",
      description: "Close the bug investigation",
      goal: "Summarize investigation results and resolution",
      tools: [],
      transitions: [],
      isFinal: true,
    },
  },
};

// Export all workflows
export const WORKFLOWS = {
  code_review: CODE_REVIEW_WORKFLOW,
  bug_investigation: BUG_INVESTIGATION_WORKFLOW,
};
