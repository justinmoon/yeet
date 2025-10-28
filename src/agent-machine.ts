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

export const agentMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentMachineEvent,
  },
  actors: {
    // Stream agent response - yields text deltas and tool calls
    streamAgent: fromCallback(({ input, sendBack }) => {
      const run = async () => {
        const { createAgentActor } = await import("./agent-actor");
        const { loadConfig } = await import("./config");

        const config = await loadConfig();
        const ctx = input as AgentContext;

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

    // Execute a tool and capture new snapshot
    executeTool: fromPromise(
      async ({
        input,
      }: {
        input: { toolCall: ToolCall; workingDir: string };
      }): Promise<{ result: ToolResult; snapshot?: SnapshotMetadata }> => {
        const { executeTool } = await import("./tool-executor");
        return executeTool(input.toolCall, input.workingDir);
      },
    ),
  },
  guards: {
    hasReachedMaxSteps: ({ context }) =>
      context.currentStep >= context.maxSteps,
    isFileModifyingTool: ({ context }) => {
      const toolName = context.pendingToolCall?.name;
      return toolName === "write" || toolName === "edit";
    },
  },
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

    recordToolResult: assign({
      toolHistory: ({ context, event }) => {
        if (event.type !== "TOOL_RESULT" || !context.pendingToolCall) {
          return context.toolHistory;
        }
        return [
          ...context.toolHistory,
          {
            call: context.pendingToolCall,
            result: event.result,
          },
        ];
      },
      // Add tool call and result to messages for next agent invocation
      messages: ({ context, event }) => {
        if (!context.pendingToolCall) {
          return context.messages;
        }

        // Get tool result from event.output (from executeTool actor)
        const toolResult = (event as any).output?.result?.result;
        const toolError = (event as any).output?.result?.error;

        // Add assistant message (if we have response text), then tool result as user message
        // This tells the agent what happened with the tool
        const newMessages: Message[] = [...context.messages];

        if (context.currentResponse) {
          newMessages.push({
            role: "assistant" as const,
            content: context.currentResponse,
          });
        }

        // Add tool result as user message so agent sees what happened
        const resultMessage = toolError
          ? `Tool ${context.pendingToolCall.name} failed: ${toolError}`
          : `Tool ${context.pendingToolCall.name} succeeded. Result: ${JSON.stringify(toolResult)}`;

        newMessages.push({
          role: "user" as const,
          content: resultMessage,
        });

        return newMessages;
      },
      pendingToolCall: undefined,
      currentResponse: "", // Reset for next turn
    }),

    updateSnapshot: assign({
      currentSnapshot: ({ event }) => {
        // @ts-ignore - we'll properly type this when implementing
        return event.output.snapshot;
      },
      snapshotHistory: ({ context, event }) => {
        // @ts-ignore
        return [...context.snapshotHistory, event.output.snapshot];
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
  },
}).createMachine({
  id: "agent",
  initial: "idle",
  context: {
    currentSnapshot: { treeHash: "", timestamp: 0 },
    snapshotHistory: [],
    messages: [],
    currentResponse: "",
    toolHistory: [],
    currentStep: 0,
    maxSteps: 50, // Increased from 10 - complex tasks need more steps
    workingDirectory: typeof process !== "undefined" ? process.cwd() : "/",
  },
  states: {
    idle: {
      on: {
        USER_MESSAGE: {
          target: "thinking",
          actions: ["addUserMessage", "incrementStep"],
        },
      },
    },

    thinking: {
      invoke: {
        src: "streamAgent",
        input: ({ context }) => ({
          messages: context.messages,
          snapshot: context.currentSnapshot,
        }),
      },
      on: {
        TEXT_DELTA: {
          actions: "appendText",
        },
        TOOL_CALL: {
          target: "executingTool",
          actions: "recordToolCall",
        },
        AGENT_DONE: {
          target: "idle",
          actions: "finalizeResponse",
        },
        ERROR: "error",
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
            const result = await executeTool(input.toolCall, input.workingDir);

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
          actions: assign({
            toolHistory: ({ context, event }) => [
              ...context.toolHistory,
              {
                call: context.pendingToolCall!,
                result: (event as any).output.result,
              },
            ],
            messages: ({ context, event }) => {
              const result = (event as any).output.result;
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
                content: `Tool ${context.pendingToolCall!.name} succeeded. Result: ${JSON.stringify(result.result)}`,
              });

              return messages;
            },
            currentSnapshot: ({ event }) => {
              const snapshot = (event as any).output.snapshot;
              return snapshot || { treeHash: "", timestamp: 0 };
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

    error: {
      on: {
        USER_MESSAGE: {
          target: "thinking",
          actions: ["addUserMessage", "incrementStep"],
        },
      },
    },
  },
});
