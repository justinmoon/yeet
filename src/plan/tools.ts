/**
 * Tools for coder/reviewer orchestration.
 *
 * These tools allow agents to communicate with the orchestration layer:
 * - request_review: Coder signals work is ready for review
 * - request_changes: Reviewer requests changes from coder
 * - approve: Reviewer approves the current step
 * - ask_user: Either agent asks the user a question
 *
 * Tools return action markers that the orchestrator interprets.
 * The actual state transitions happen in the FlowMachine.
 */

// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";
import type { AgentRole } from "./flow-types";

/**
 * Action types returned by tools for orchestrator to handle.
 */
export type ToolAction =
  | { action: "request_review" }
  | { action: "request_changes"; reason: string }
  | { action: "approve" }
  | { action: "ask_user"; message: string; requester: AgentRole }
  | { action: "blocked"; reason: string };

/**
 * Schema for request_review tool (no parameters).
 */
const requestReviewSchema = z.object({});

/**
 * Tool for coder to request a review of their work.
 *
 * The coder calls this when they have completed implementation
 * and are ready for the reviewer to check their work.
 */
export const requestReview = tool({
  description:
    "Request a review of your implementation. Call this when you have completed the current step and are ready for the reviewer to evaluate your work.",
  inputSchema: jsonSchema(z.toJSONSchema(requestReviewSchema)),
  execute: async (): Promise<ToolAction> => {
    return { action: "request_review" };
  },
});

/**
 * Schema for request_changes tool.
 */
const requestChangesSchema = z.object({
  reason: z
    .string()
    .describe(
      "Clear explanation of what changes are needed and why. Be specific about what to fix.",
    ),
});

/**
 * Tool for reviewer to request changes from the coder.
 *
 * The reviewer calls this when they find issues that need to be fixed
 * before the step can be approved.
 */
export const requestChanges = tool({
  description:
    "Request changes from the coder. Call this when you find issues that need to be fixed before the step can be approved. Be specific about what needs to change.",
  inputSchema: jsonSchema(z.toJSONSchema(requestChangesSchema)),
  execute: async (args: { reason: string }): Promise<ToolAction> => {
    return {
      action: "request_changes",
      reason: args.reason,
    };
  },
});

/**
 * Schema for approve tool (no parameters).
 */
const approveSchema = z.object({});

/**
 * Tool for reviewer to approve the current step.
 *
 * The reviewer calls this when the implementation meets
 * the acceptance criteria and is ready to move on.
 */
export const approve = tool({
  description:
    "Approve the current step. Call this when the implementation meets the acceptance criteria and is ready to move to the next step.",
  inputSchema: jsonSchema(z.toJSONSchema(approveSchema)),
  execute: async (): Promise<ToolAction> => {
    return { action: "approve" };
  },
});

/**
 * Schema for ask_user tool.
 */
const askUserSchema = z.object({
  message: z
    .string()
    .describe(
      "The question or clarification request to send to the user. Be clear and specific.",
    ),
});

/**
 * Tool for either agent to ask the user a question.
 *
 * This pauses the flow until the user responds.
 * Used when clarification is needed or a decision must be made by the user.
 */
export function createAskUserTool(requester: AgentRole) {
  return tool({
    description:
      "Ask the user a question. Call this when you need clarification, have a decision that requires user input, or need to report a blocking issue. The flow will pause until the user responds.",
    inputSchema: jsonSchema(z.toJSONSchema(askUserSchema)),
    execute: async (args: { message: string }): Promise<ToolAction> => {
      return {
        action: "ask_user",
        message: args.message,
        requester,
      };
    },
  });
}

/**
 * Create the coder's toolset.
 *
 * Coder has: request_review, ask_user
 */
export function createCoderTools() {
  return {
    request_review: requestReview,
    ask_user: createAskUserTool("coder"),
  };
}

/**
 * Create the reviewer's toolset.
 *
 * Reviewer has: request_changes, approve, ask_user
 *
 * Note: The reviewer's workspace should be configured as read-only
 * at the agent driver level. These tools only control flow, not file access.
 */
export function createReviewerTools() {
  return {
    request_changes: requestChanges,
    approve: approve,
    ask_user: createAskUserTool("reviewer"),
  };
}

/**
 * Get all orchestration tools for a given role.
 */
export function getToolsForRole(role: AgentRole) {
  if (role === "coder") {
    return createCoderTools();
  }
  return createReviewerTools();
}
