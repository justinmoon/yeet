// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";
import type { AgentCapability } from "../config";
import { getAgentSpawner } from "../agents/service";
import { getActiveAgentContext } from "../agents/runtime-context";

const capabilityEnum = z.enum(["primary", "subtask", "watcher"]);
const returnModeEnum = z.enum(["blocking", "background"]);

const spawnSchema = z.object({
  agentId: z.string().min(1).describe("Agent profile ID to spawn"),
  prompt: z.string().min(1).describe("Instructions for the delegated agent"),
  capability: capabilityEnum
    .default("subtask")
    .describe("Capability to use when launching the agent"),
  returnMode: returnModeEnum
    .default("blocking")
    .describe("blocking waits for summary; background just starts the run"),
});

interface SpawnArgs {
  agentId: string;
  prompt: string;
  capability: AgentCapability;
  returnMode: "blocking" | "background";
}

export const spawnSubagent = tool({
  description:
    "Launch another configured agent profile to handle a subtask or watcher flow",
  inputSchema: jsonSchema(z.toJSONSchema(spawnSchema)),
  execute: async (args: SpawnArgs) => {
    const spawner = await getAgentSpawner();
    const context = getActiveAgentContext();
    const handle = await spawner.spawn({
      agentId: args.agentId,
      capability: args.capability || "subtask",
      prompt: args.prompt,
      parentSessionId: context?.sessionId ?? undefined,
      trigger: { type: "tool", value: "spawn_subagent" },
    });

    if ((args.returnMode || "blocking") === "background") {
      return {
        mode: "background",
        sessionId: handle.sessionId,
        status: handle.getStatus(),
      };
    }

    const result = await handle.awaitResult();
    return {
      mode: "blocking",
      sessionId: result.sessionId,
      status: result.status,
      summary: result.summary,
      error: result.error,
    };
  },
});
