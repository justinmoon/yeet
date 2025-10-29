/**
 * Workflow machine for orchestrating multiple agents
 * Implements parallel execution, review, and debate patterns
 */

import { assign, createActor, fromPromise, setup } from "xstate";
import {
  type AgentContext,
  type AgentMachineInput,
  agentMachine,
} from "./agent-machine";
import { coordinateDebate } from "./debate-coordinator";

export interface WorkflowContext {
  // Input
  task: string;
  implementationModels: string[];
  reviewerModels: string[];

  // Outputs from each phase
  implementations: Map<
    string,
    {
      messages: Array<{ role: string; content: string }>;
      workingDir: string;
      success: boolean;
      error?: string;
    }
  >;

  reviews: Map<string, string>;
  debateTranscript: Array<{ speaker: string; model: string; message: string }>;
  consensus: string | null;

  // Iteration control
  revisionCount: number;
  maxRevisions: number;
  approved: boolean;
}

export type WorkflowEvent =
  | { type: "START" }
  | { type: "AGENT_COMPLETED"; agentId: string; output: any }
  | { type: "ERROR"; error: string };

/**
 * Simple 2-agent workflow: 1 coder + 1 reviewer
 * This is the MVP to test the concept before scaling up
 */
export const simpleWorkflowMachine = setup({
  types: {
    context: {} as Pick<
      WorkflowContext,
      | "task"
      | "implementations"
      | "reviews"
      | "implementationModels"
      | "reviewerModels"
    >,
    input: {} as {
      task: string;
      coderModel?: string;
      reviewerModel?: string;
    },
  },
  actors: {
    codingAgent: agentMachine,
    reviewAgent: agentMachine,
  },
}).createMachine({
  id: "simple-workflow",
  initial: "implementation",
  context: ({ input }) => ({
    task: input.task,
    implementationModels: [input.coderModel || "claude-sonnet-4-5"],
    reviewerModels: [input.reviewerModel || "claude-sonnet-4-5"],
    implementations: new Map(),
    reviews: new Map(),
  }),
  states: {
    implementation: {
      invoke: {
        src: "codingAgent",
        input: ({ context }) => ({
          workingDirectory: "/tmp/workflow-coder",
          initialMessage: context.task,
          maxSteps: 50,
          workflowMode: true,
        }),
        onDone: {
          target: "review",
          actions: assign({
            implementations: ({ context, event }) => {
              const output = event.output as { context: AgentContext };
              context.implementations.set("coder", {
                messages: output.context.messages,
                workingDir: "/tmp/workflow-coder",
                success: true,
              });
              return context.implementations;
            },
          }),
        },
        onError: {
          target: "error",
          actions: assign({
            implementations: ({ context, event }) => {
              context.implementations.set("coder", {
                messages: [],
                workingDir: "/tmp/workflow-coder",
                success: false,
                error: String(event.error),
              });
              return context.implementations;
            },
          }),
        },
      },
    },

    review: {
      invoke: {
        src: "reviewAgent",
        input: ({ context }) => {
          const impl = context.implementations.get("coder");
          const lastMessage =
            impl?.messages[impl.messages.length - 1]?.content || "";

          return {
            workingDirectory: "/tmp/workflow-reviewer",
            initialMessage:
              `Review this implementation:\n\nTask: ${context.task}\n\n` +
              `Implementation output:\n${lastMessage}\n\n` +
              `Please provide detailed feedback on correctness, completeness, and code quality. ` +
              `If approved, start your response with "APPROVED:". If changes needed, start with "CHANGES NEEDED:".`,
            maxSteps: 20,
            workflowMode: true,
          };
        },
        onDone: {
          target: "complete",
          actions: assign({
            reviews: ({ context, event }) => {
              const output = event.output as { context: AgentContext };
              const lastMessage =
                output.context.messages[output.context.messages.length - 1]
                  ?.content || "";
              context.reviews.set("reviewer", lastMessage);
              return context.reviews;
            },
          }),
        },
        onError: {
          target: "error",
        },
      },
    },

    complete: {
      type: "final",
    },

    error: {
      type: "final",
    },
  },
});

/**
 * Full parallel workflow with 3 coders, 2 reviewers, debate, and revision
 * This is the complete implementation from the design doc
 */
export const parallelReviewWorkflow = setup({
  types: {
    context: {} as WorkflowContext,
    input: {} as {
      task: string;
      implementationModels?: string[];
      reviewerModels?: string[];
      maxRevisions?: number;
    },
  },
  actors: {
    codingAgent: agentMachine,
    reviewAgent: agentMachine,
    debateCoordinator: fromPromise(async (params: { input: any }) => {
      const { input } = params;
      return await coordinateDebate(input);
    }),
  },
}).createMachine({
  id: "parallel-review-workflow",
  initial: "parallel-implementation",
  context: ({ input }) => ({
    task: input.task,
    implementationModels: input.implementationModels || [
      "claude-sonnet-4-5",
      "qwen3-coder",
      "claude-haiku-4-5",
    ],
    reviewerModels: input.reviewerModels || [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ],
    implementations: new Map(),
    reviews: new Map(),
    debateTranscript: [],
    consensus: null,
    revisionCount: 0,
    maxRevisions: input.maxRevisions || 2,
    approved: false,
  }),
  states: {
    "parallel-implementation": {
      type: "parallel",
      states: {
        agent1: {
          initial: "working",
          states: {
            working: {
              invoke: {
                src: "codingAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/workflow-agent-1",
                  initialMessage: context.task,
                  maxSteps: 50,
                  workflowMode: true,
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    implementations: ({ context, event }) => {
                      const output = event.output as { context: AgentContext };
                      context.implementations.set("agent1", {
                        messages: output.context.messages,
                        workingDir: "/tmp/workflow-agent-1",
                        success: true,
                      });
                      return context.implementations;
                    },
                  }),
                },
                onError: {
                  target: "error",
                },
              },
            },
            done: { type: "final" },
            error: { type: "final" },
          },
        },

        agent2: {
          initial: "working",
          states: {
            working: {
              invoke: {
                src: "codingAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/workflow-agent-2",
                  initialMessage: context.task,
                  maxSteps: 50,
                  workflowMode: true,
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    implementations: ({ context, event }) => {
                      const output = event.output as { context: AgentContext };
                      context.implementations.set("agent2", {
                        messages: output.context.messages,
                        workingDir: "/tmp/workflow-agent-2",
                        success: true,
                      });
                      return context.implementations;
                    },
                  }),
                },
                onError: {
                  target: "error",
                },
              },
            },
            done: { type: "final" },
            error: { type: "final" },
          },
        },

        agent3: {
          initial: "working",
          states: {
            working: {
              invoke: {
                src: "codingAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/workflow-agent-3",
                  initialMessage: context.task,
                  maxSteps: 50,
                  workflowMode: true,
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    implementations: ({ context, event }) => {
                      const output = event.output as { context: AgentContext };
                      context.implementations.set("agent3", {
                        messages: output.context.messages,
                        workingDir: "/tmp/workflow-agent-3",
                        success: true,
                      });
                      return context.implementations;
                    },
                  }),
                },
                onError: {
                  target: "error",
                },
              },
            },
            done: { type: "final" },
            error: { type: "final" },
          },
        },
      },
      onDone: "consolidate-implementations",
    },

    "consolidate-implementations": {
      entry: assign({
        // Prepare review context from all implementations
        reviews: (ctx) => {
          const { context } = ctx;
          // TODO: Format implementations for review
          return new Map();
        },
      }),
      always: "initial-review",
    },

    "initial-review": {
      type: "parallel",
      states: {
        reviewer1: {
          initial: "reviewing",
          states: {
            reviewing: {
              invoke: {
                src: "reviewAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/workflow-reviewer-1",
                  initialMessage: `Review these 3 implementations of: ${context.task}`,
                  maxSteps: 30,
                  workflowMode: true,
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    reviews: ({ context, event }) => {
                      const output = event.output as { context: AgentContext };
                      const lastMessage =
                        output.context.messages[
                          output.context.messages.length - 1
                        ]?.content || "";
                      context.reviews.set("reviewer1", lastMessage);
                      return context.reviews;
                    },
                  }),
                },
              },
            },
            done: { type: "final" },
          },
        },

        reviewer2: {
          initial: "reviewing",
          states: {
            reviewing: {
              invoke: {
                src: "reviewAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/workflow-reviewer-2",
                  initialMessage: `Review these 3 implementations of: ${context.task}`,
                  maxSteps: 30,
                  workflowMode: true,
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    reviews: ({ context, event }) => {
                      const output = event.output as { context: AgentContext };
                      const lastMessage =
                        output.context.messages[
                          output.context.messages.length - 1
                        ]?.content || "";
                      context.reviews.set("reviewer2", lastMessage);
                      return context.reviews;
                    },
                  }),
                },
              },
            },
            done: { type: "final" },
          },
        },
      },
      onDone: "debate",
    },

    debate: {
      invoke: {
        src: "debateCoordinator",
        input: (ctx: any) => {
          const { context } = ctx;
          return {
            implementations: context.implementations,
            reviews: context.reviews,
            reviewerModels: context.reviewerModels,
            maxRounds: 5,
          };
        },
        onDone: {
          target: "complete",
          actions: assign({
            debateTranscript: ({ event }) => event.output.transcript,
            consensus: ({ event }) => event.output.consensus,
            approved: ({ event }) => event.output.approved,
          }),
        },
      },
    },

    complete: {
      type: "final",
    },
  },
});
