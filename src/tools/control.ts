/**
 * Control flow tools for agent workflow management
 */

import { jsonSchema, tool } from "ai";
import z from "zod/v4";

const completeSchema = z.object({
  summary: z.string().describe("Brief summary of what was accomplished"),
});

export const complete = tool({
  description:
    "Mark the current task as complete. Use this when you have successfully accomplished what the user asked for.",
  inputSchema: jsonSchema(z.toJSONSchema(completeSchema)),
  execute: async (args: any) => {
    return {
      status: "complete",
      summary: args.summary,
    };
  },
});

const clarifySchema = z.object({
  question: z
    .string()
    .describe("The specific question or clarification needed"),
});

export const clarify = tool({
  description:
    "Ask the user for clarification when the task requirements are unclear or you need more information to proceed.",
  inputSchema: jsonSchema(z.toJSONSchema(clarifySchema)),
  execute: async (args: any) => {
    return {
      status: "needs_clarification",
      question: args.question,
    };
  },
});

const pauseSchema = z.object({
  reason: z
    .string()
    .describe("Why you're pausing (blocker, review needed, etc)"),
  nextSteps: z.string().optional().describe("What you plan to do when resumed"),
});

export const pause = tool({
  description:
    "Pause execution to let the user review progress. Use this when you've hit a blocker, need to economize tokens, or want user guidance before proceeding.",
  inputSchema: jsonSchema(z.toJSONSchema(pauseSchema)),
  execute: async (args: any) => {
    return {
      status: "paused",
      reason: args.reason,
      nextSteps: args.nextSteps,
    };
  },
});
