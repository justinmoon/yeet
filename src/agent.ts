// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { Config } from "./config";
import { logger } from "./logger";
import { createMapleFetch } from "./maple";
import * as tools from "./tools";

const SYSTEM_PROMPT = `You are yeet, a minimal coding assistant that executes tasks using tools.

CRITICAL INSTRUCTIONS:
- You have tools available: bash, read, write, edit, search, complete, clarify, pause
- When asked to do something, USE THE TOOLS to actually do it
- DO NOT write code blocks showing what should be done
- DO NOT describe what you would do
- ACTUALLY CALL THE TOOLS to perform the actions

MULTI-STEP TASKS:
- Many tasks have multiple steps (e.g., "create file A, then file B, then file C")
- You must complete ALL steps before calling the complete tool
- After each tool succeeds, check if there are more steps remaining
- Only call complete when you have truly finished EVERYTHING the user requested

WORKFLOW CONTROL:
- When you've finished ALL parts of the task, call complete({ summary: "what you did" })
- If you need clarification from user, call clarify({ question: "what you need to know" })
- If you're stuck or want to pause for review, call pause({ reason: "why pausing" })

SEARCH TOOL:
- Use 'search' instead of bash+grep for finding patterns in files
- search returns structured results (file, line number, content)
- Much better than parsing bash output

Examples:
WRONG: "Here's the code: \`\`\`js ... \`\`\`"
RIGHT: Call write tool with the code

WRONG: "\`\`\`bash ls \`\`\`"  
RIGHT: Call bash tool with "ls"

WRONG: bash("grep -r 'pattern' src/")
RIGHT: search({ pattern: "pattern", path: "src" })

Be concise. Execute the work, don't describe it.`;

export interface ImageAttachment {
  data: string; // base64
  mimeType: string;
}

export interface AgentEvent {
  type: "text" | "tool" | "tool-result" | "done" | "error";
  content?: string;
  name?: string;
  args?: any;
  result?: any;
  error?: string;
}

export type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image"; image: URL }>;

export async function* runAgent(
  messages: Array<{ role: "user" | "assistant"; content: MessageContent }>,
  config: Config,
  onToolCall?: (tool: string) => void,
  maxSteps?: number,
): AsyncGenerator<AgentEvent> {
  try {
    // Choose provider based on config
    let provider;
    let modelName: string;

    if (config.activeProvider === "maple") {
      logger.info("Using Maple AI with encrypted inference");
      const mapleFetch = await createMapleFetch({
        apiUrl: config.maple!.apiUrl,
        apiKey: config.maple!.apiKey,
        pcr0Values: config.maple!.pcr0Values,
      });

      provider = createOpenAICompatible({
        name: "maple",
        baseURL: `${config.maple!.apiUrl}/v1`,
        fetch: mapleFetch,
      });
      modelName = config.maple!.model;
    } else {
      // Use OpenCode
      provider = createOpenAICompatible({
        name: "opencode",
        apiKey: config.opencode.apiKey,
        baseURL: config.opencode.baseURL,
      });
      modelName = config.opencode.model;
    }

    const toolSet = {
      bash: tools.bash,
      read: tools.read,
      edit: tools.edit,
      write: tools.write,
      search: tools.search,
      // Control flow tools
      complete: tools.complete,
      clarify: tools.clarify,
      pause: tools.pause,
      // Orchestration tools
      delegate_to_worker: tools.delegateToWorker,
      transition_stage: tools.transitionStage,
      report_results: tools.reportResults,
      complete_workflow: tools.completeWorkflow,
    };

    logger.info("Starting agent with tools", {
      tools: Object.keys(toolSet),
      messagesCount: messages.length,
    });

    // maxSteps controls how many tool rounds the agent can do:
    // - For XState integration: pass maxSteps=1 so XState controls the loop
    // - For direct TUI usage: use config.maxSteps (default 20) for multi-step tasks
    // If not specified, uses config value (allowing agent to complete multi-step tasks)
    const effectiveMaxSteps = maxSteps ?? config.maxSteps ?? 20;

    const result = await streamText({
      model: provider(modelName),
      system: SYSTEM_PROMPT,
      messages,
      tools: toolSet,
      maxSteps: effectiveMaxSteps,
      temperature: config.temperature || 0.3,
    });

    for await (const chunk of result.fullStream) {
      logger.debug("Stream chunk received", { type: chunk.type });

      if (chunk.type === "text-delta") {
        logger.debug("Text delta", { text: chunk.text?.substring(0, 50) });
        yield { type: "text", content: chunk.text };
      }
      if (chunk.type === "tool-call") {
        logger.debug("Tool call", { toolName: chunk.toolName });
        onToolCall?.(chunk.toolName);
        yield {
          type: "tool",
          name: chunk.toolName,
          args: chunk.input || {},
        };
      }
      if (chunk.type === "tool-result") {
        logger.debug("Tool result", { toolName: chunk.toolName });
        yield {
          type: "tool-result",
          name: chunk.toolName,
          result: chunk.output,
        };
      }
      if (chunk.type === "error") {
        const errorObj = (chunk as any).error;
        logger.error("Stream error chunk", {
          error: errorObj,
          errorMessage: errorObj?.message,
          errorStack: errorObj?.stack,
          errorString: String(errorObj),
        });
        yield { type: "error", error: errorObj?.message || String(errorObj) };
      }
    }

    logger.info("Agent stream completed");
    yield { type: "done" };
  } catch (error: any) {
    yield { type: "error", error: error.message };
  }
}
