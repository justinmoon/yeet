// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";

/**
 * Tool for orchestrator to delegate work to a specialist worker agent
 */
const delegateToWorkerSchema = z.object({
  worker_type: z
    .string()
    .describe("Type of worker (e.g., 'analyzer', 'security', 'style')"),
  instructions: z
    .string()
    .describe(
      "Specific instructions for the worker based on current stage goal",
    ),
});

export const delegateToWorker = tool({
  description: "Delegate the current stage's work to a specialist worker agent",
  inputSchema: jsonSchema(z.toJSONSchema(delegateToWorkerSchema)),
  execute: async (args: any) => {
    // This tool is handled specially in the orchestrator loop
    // It returns a marker that tells the orchestrator to spawn a worker
    return {
      action: "delegate",
      worker_type: args.worker_type,
      instructions: args.instructions,
    };
  },
});

/**
 * Tool for orchestrator to transition to next stage
 */
const transitionStageSchema = z.object({
  from: z.string().describe("Current stage name"),
  to: z.string().describe("Next stage name to transition to"),
  reason: z
    .string()
    .describe(
      "Clear explanation of why this transition is chosen based on evidence",
    ),
  summary: z
    .string()
    .describe("Brief summary of what was accomplished in current stage"),
});

export const transitionStage = tool({
  description:
    "Transition to the next stage in the workflow after completing current stage",
  inputSchema: jsonSchema(z.toJSONSchema(transitionStageSchema)),
  execute: async (args: any) => {
    // This tool is handled specially in the orchestrator loop
    return {
      action: "transition",
      from: args.from,
      to: args.to,
      reason: args.reason,
      summary: args.summary,
    };
  },
});

/**
 * Tool for workers to report results back to orchestrator
 */
const reportResultsSchema = z.object({
  findings: z.string().describe("Detailed findings from the worker's task"),
  recommendation: z
    .string()
    .optional()
    .describe("Optional: suggested next steps or concerns to address"),
});

export const reportResults = tool({
  description:
    "Worker reports results back to orchestrator after completing task",
  inputSchema: jsonSchema(z.toJSONSchema(reportResultsSchema)),
  execute: async (args: any) => {
    return {
      action: "report",
      findings: args.findings,
      recommendation: args.recommendation,
    };
  },
});

/**
 * Tool for orchestrator to signal workflow completion (final stage)
 */
const completeWorkflowSchema = z.object({
  summary: z
    .string()
    .describe("Final summary of the entire workflow and decision"),
});

export const completeWorkflow = tool({
  description:
    "Signal that the workflow is complete with final summary (only use in final stages)",
  inputSchema: jsonSchema(z.toJSONSchema(completeWorkflowSchema)),
  execute: async (args: any) => {
    return {
      action: "complete",
      summary: args.summary,
    };
  },
});
