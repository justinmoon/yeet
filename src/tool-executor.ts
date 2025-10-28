/**
 * Tool executor for XState machine
 * Executes tools and returns results
 */

import type { ToolCall, ToolResult } from "./agent-machine";
import type { SnapshotMetadata } from "./filesystem-snapshot";
import * as tools from "./tools";

export interface ToolExecutionResult {
  result: ToolResult;
  snapshot?: SnapshotMetadata;
}

/**
 * Execute a tool call and return the result
 */
export async function executeTool(
  toolCall: ToolCall,
  workingDir: string,
): Promise<ToolExecutionResult> {
  const { name, args, id } = toolCall;

  try {
    let result: any;

    // Minimal ToolCallOptions for execute method
    const toolCallOptions = {
      toolCallId: id,
      messages: [],
    };

    switch (name) {
      case "bash":
        result = await tools.bash.execute?.(args, toolCallOptions);
        break;
      case "read":
        result = await tools.read.execute?.(args, toolCallOptions);
        break;
      case "write":
        result = await tools.write.execute?.(args, toolCallOptions);
        break;
      case "edit":
        result = await tools.edit.execute?.(args, toolCallOptions);
        break;
      case "search":
        result = await tools.search.execute?.(args, toolCallOptions);
        break;
      case "complete":
        result = await tools.complete.execute?.(args, toolCallOptions);
        break;
      case "clarify":
        result = await tools.clarify.execute?.(args, toolCallOptions);
        break;
      case "pause":
        result = await tools.pause.execute?.(args, toolCallOptions);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      result: {
        toolCallId: toolCall.id,
        result,
      },
    };
  } catch (error: any) {
    return {
      result: {
        toolCallId: toolCall.id,
        error: error.message || String(error),
        result: null,
      },
    };
  }
}
