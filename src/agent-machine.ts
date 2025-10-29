/**
 * XState machine for agent loop
 * Models the complete agent conversation as state transitions
 */

import { assign, fromCallback, fromPromise, setup } from "xstate";
import type { AgentEvent } from "./agent";
import type { SnapshotMetadata } from "./filesystem-snapshot";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: any;
}

export interface ToolResult {
  toolCallId: string;
  result: any;
  error?: string;
}

export interface AgentContext {
  // Filesystem state
  currentSnapshot: SnapshotMetadata;
  snapshotHistory: SnapshotMetadata[];

  // Conversation
  messages: Message[];
  currentResponse: string; // accumulated text from agent

  // Tool execution
  pendingToolCall?: ToolCall;
  toolHistory: Array<{ call: ToolCall; result: ToolResult }>;

  // State tracking
  currentStep: number;
  maxSteps: number;
  workingDirectory: string;
  workflowMode: boolean;
}

export type AgentMachineEvent =
  | { type: "USER_MESSAGE"; content: string }
  | { type: "TEXT_DELTA"; text: string }
  | { type: "TOOL_CALL"; toolCall: ToolCall }
  | { type: "TOOL_RESULT"; result: ToolResult }
  | { type: "AGENT_DONE" }
  | { type: "AGENT_PAUSED"; reason: string }
  | { type: "AGENT_CLARIFICATION"; question: string }
  | { type: "CONTINUE" }
  | { type: "ERROR"; error: string };

export interface AgentMachineInput {
  workingDirectory?: string;
  initialMessage?: string;
  model?: string;
  maxSteps?: number;
  /**
   * When true, machine transitions to final "complete" state after finishing.
   * This enables workflow orchestration with onDone events.
   * When false (default), stays in "idle" for interactive use (TUI).
   */
  workflowMode?: boolean;
}

export const agentMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentMachineEvent,
    input: {} as AgentMachineInput,
  },
  actors: {
    // Stream agent response - yields text deltas and tool calls
    streamAgent: fromCallback(({ input, sendBack }) => {
      const run = async () => {
        const { createAgentActor } = await import("./agent-actor");
        const { loadConfig } = await import("./config");

        const config = await loadConfig();
        const ctx = input as AgentContext;

        // Override model if specified in workflow input
        // This allows workflows to specify different models per agent
        // The model is stored in context during initialization
        // (We can't access input.model here, so it must be in context)

        // Stream events from agent to state machine
        for await (const event of createAgentActor({
          messages: ctx.messages,
          snapshot: ctx.currentSnapshot,
          config,
          workingDirectory: ctx.workingDirectory,
        })) {
          sendBack(event);
        }
      };

      run().catch((error) => {
        sendBack({ type: "ERROR", error: error.message || String(error) });
      });

      // Cleanup function (optional)
      return () => {
        // Could cancel agent here if needed
      };
    }),
  },
  guards: {},
  actions: {
    addUserMessage: assign({
      messages: ({ context, event }) => {
        if (event.type !== "USER_MESSAGE") return context.messages;
        return [
          ...context.messages,
          { role: "user" as const, content: event.content },
        ];
      },
      currentResponse: "",
    }),

    appendText: assign({
      currentResponse: ({ context, event }) => {
        if (event.type !== "TEXT_DELTA") return context.currentResponse;
        return context.currentResponse + event.text;
      },
    }),

    recordToolCall: assign({
      pendingToolCall: ({ event }) => {
        if (event.type !== "TOOL_CALL") return undefined;
        return event.toolCall;
      },
    }),

    incrementStep: assign({
      currentStep: ({ context }) => context.currentStep + 1,
    }),

    finalizeResponse: assign({
      messages: ({ context }) => [
        ...context.messages,
        { role: "assistant" as const, content: context.currentResponse },
      ],
      currentResponse: "",
    }),

    recordToolSuccess: assign({
      toolHistory: ({ context, event }) => [
        ...context.toolHistory,
        {
          call: context.pendingToolCall!,
          result: (event as any).output.result,
        },
      ],
      messages: ({ context, event }) => {
        const output = (event as any).output;
        const messages = [...context.messages];

        // Add current response if any
        if (context.currentResponse.trim()) {
          messages.push({
            role: "assistant" as const,
            content: context.currentResponse,
          });
        }

        // Add tool result
        messages.push({
          role: "user" as const,
          content: `Tool ${context.pendingToolCall!.name} succeeded. Result: ${JSON.stringify(output.result.result)}`,
        });

        return messages;
      },
      currentSnapshot: ({ context, event }) =>
        (event as any).output.snapshot || {
          treeHash: "",
          timestamp: 0,
        },
      snapshotHistory: ({ context, event }) => {
        const snapshot = (event as any).output.snapshot;
        return snapshot
          ? [...context.snapshotHistory, snapshot]
          : context.snapshotHistory;
      },
      pendingToolCall: undefined,
      currentResponse: "",
    }),
  },
}).createMachine({
  id: "agent",
  initial: "idle",
  context: ({ input }) => ({
    currentSnapshot: { treeHash: "", timestamp: 0 },
    snapshotHistory: [],
    messages: input.initialMessage
      ? [{ role: "user" as const, content: input.initialMessage }]
      : [],
    currentResponse: "",
    toolHistory: [],
    currentStep: 0,
    maxSteps: input.maxSteps || 50,
    workingDirectory:
      input.workingDirectory ||
      (typeof process !== "undefined" ? process.cwd() : "/"),
    workflowMode: input.workflowMode || false,
  }),
  states: {
    idle: {
      // If we have an initial message, start working immediately
      always: [
        {
          guard: ({ context }) =>
            context.messages.length > 0 && context.currentStep === 0,
          target: "running",
          actions: "incrementStep",
        },
        {
          // In workflow mode, transition to final state when work is complete
          guard: ({ context }) =>
            context.workflowMode && context.currentStep > 0,
          target: "complete",
        },
      ],
      on: {
        USER_MESSAGE: {
          target: "running",
          actions: ["addUserMessage", "incrementStep"],
        },
      },
    },

    // Main execution state - agent runs here until complete
    running: {
      initial: "thinking",
      on: {
        // Handle agent events at running level
        TEXT_DELTA: {
          actions: "appendText",
        },
        TOOL_CALL: {
          target: ".executingTool",
          actions: "recordToolCall",
        },
        AGENT_DONE: {
          target: "#agent.idle",
          actions: "finalizeResponse",
        },
        ERROR: "error",
      },
      states: {
        thinking: {
          // Re-invoke agent each time we enter thinking state
          // This allows it to continue after tool execution with maxSteps:1
          invoke: {
            src: "streamAgent",
            input: ({ context }) => ({
              messages: context.messages,
              snapshot: context.currentSnapshot,
            }),
          },
        },

        executingTool: {
          invoke: {
            src: fromPromise(
              async ({
                input,
              }: {
                input: {
                  toolCall: ToolCall;
                  workingDir: string;
                  context: AgentContext;
                };
              }) => {
                const { executeTool } = await import("./tool-executor");

                // Execute the tool
                const result = await executeTool(
                  input.toolCall,
                  input.workingDir,
                );

                // If tool modifies files, capture snapshot internally
                const toolName = input.toolCall.name;
                let snapshot: SnapshotMetadata | undefined;

                if (toolName === "write" || toolName === "edit") {
                  try {
                    const { FilesystemSnapshot } = await import(
                      "./filesystem-snapshot"
                    );
                    const fs = new FilesystemSnapshot(input.workingDir);
                    snapshot = await fs.capture(`After ${toolName}`);
                  } catch (error) {
                    // If snapshot fails, continue without it
                    console.warn("Snapshot capture failed:", error);
                    snapshot = {
                      treeHash: "",
                      timestamp: Date.now(),
                      description: `After ${toolName} (no snapshot)`,
                    };
                  }
                }

                return { result, snapshot };
              },
            ),
            input: ({ context }) => ({
              toolCall: context.pendingToolCall!,
              workingDir: context.workingDirectory,
              context,
            }),
            onDone: {
              target: "thinking",
              actions: "recordToolSuccess",
            },
            onError: {
              target: "thinking",
              actions: assign({
                toolHistory: ({ context, event }) => [
                  ...context.toolHistory,
                  {
                    call: context.pendingToolCall!,
                    result: {
                      toolCallId: context.pendingToolCall!.id,
                      error: (event as any).error?.message || "Unknown error",
                      result: null,
                    },
                  },
                ],
                pendingToolCall: undefined,
              }),
            },
          },
        },
      },
    },

    error: {
      // In workflow mode, errors are final
      always: {
        guard: ({ context }) => context.workflowMode,
        target: "complete",
      },
      on: {
        USER_MESSAGE: {
          target: "running",
          actions: ["addUserMessage", "incrementStep"],
        },
      },
    },

    // Final state for workflow orchestration
    complete: {
      type: "final",
    },
  },
  output: ({ context }) => ({ context }),
});
