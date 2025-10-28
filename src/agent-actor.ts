/**
 * Agent actor for XState machine
 * Wraps the streaming agent and emits state machine events
 */

import { type AgentEvent, type MessageContent, runAgent } from "./agent";
import type { AgentMachineEvent, Message } from "./agent-machine";
import type { Config } from "./config";
import type { SnapshotMetadata } from "./filesystem-snapshot";

export interface AgentActorInput {
  messages: Message[];
  snapshot: SnapshotMetadata;
  config: Config;
  workingDirectory: string;
}

/**
 * Convert yeet agent events to XState machine events
 */
export async function* createAgentActor(
  input: AgentActorInput,
): AsyncGenerator<AgentMachineEvent> {
  const { messages, config } = input;

  // Convert Message[] to the format expected by runAgent
  const agentMessages: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Stream agent events and convert to XState events
  for await (const event of runAgent(agentMessages, config)) {
    switch (event.type) {
      case "text":
        if (event.content) {
          yield { type: "TEXT_DELTA", text: event.content };
        }
        break;

      case "tool":
        // Check if it's a control flow tool
        if (event.name === "complete") {
          yield { type: "AGENT_DONE" };
          return; // Stop consuming agent stream
        } else if (event.name === "clarify") {
          yield {
            type: "AGENT_CLARIFICATION",
            question: event.args?.question || "Need clarification",
          };
          return; // Stop after clarification request
        } else if (event.name === "pause") {
          yield {
            type: "AGENT_PAUSED",
            reason: event.args?.reason || "Agent paused",
          };
          return; // Stop after pause
        } else {
          // Regular tool call
          yield {
            type: "TOOL_CALL",
            toolCall: {
              id: `tool-${Date.now()}-${Math.random()}`,
              name: event.name!,
              args: event.args || {},
            },
          };
        }
        break;

      case "tool-result":
        // Tool results will be handled by the executeTool actor
        // We don't need to emit these directly
        break;

      case "done":
        // If agent finishes without calling complete/clarify/pause,
        // treat it as implicit completion
        yield { type: "AGENT_DONE" };
        break;

      case "error":
        yield { type: "ERROR", error: event.error || "Unknown error" };
        break;
    }
  }
}
