// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { streamText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import * as tools from "./tools"
import type { Config } from "./config"
import { createMapleFetch } from "./maple"

const SYSTEM_PROMPT = `You are yeet, a minimal coding assistant.

You can:
- Read files (read tool)
- Edit files (edit tool)
- Write new files (write tool)
- Execute bash commands (bash tool)

Be concise. Focus on the task. No fluff.`

export interface AgentEvent {
  type: "text" | "tool" | "tool-result" | "done" | "error"
  content?: string
  name?: string
  args?: any
  result?: any
  error?: string
}

export async function* runAgent(
  message: string,
  config: Config,
  onToolCall?: (tool: string) => void
): AsyncGenerator<AgentEvent> {
  const messages = [{ role: "user" as const, content: message }]

  try {
    // Choose provider based on config
    let provider;
    let modelName: string;

    if (config.maple?.enabled) {
      // Use Maple AI with encrypted inference
      console.log("🍁 Using Maple AI (encrypted)")
      
      const mapleFetch = await createMapleFetch({
        apiUrl: config.maple.apiUrl,
        apiKey: config.maple.apiKey,
        pcr0Values: config.maple.pcr0Values,
      })

      provider = createOpenAICompatible({
        name: "maple",
        baseURL: `${config.maple.apiUrl}/v1`,
        fetch: mapleFetch,
      })
      modelName = config.maple.model
    } else {
      // Use OpenCode
      provider = createOpenAICompatible({
        name: "opencode",
        apiKey: config.opencode.apiKey,
        baseURL: config.opencode.baseURL,
      })
      modelName = config.opencode.model
    }
    
    const result = await streamText({
      model: provider(modelName),
      system: SYSTEM_PROMPT,
      messages,
      tools: {
        bash: tools.bash,
        read: tools.read,
        edit: tools.edit,
        write: tools.write,
      },
      maxSteps: config.maxSteps || 5,
      temperature: config.temperature || 0.3,
    })

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        yield { type: "text", content: chunk.text }
      }
      if (chunk.type === "tool-call") {
        onToolCall?.(chunk.toolName)
        yield {
          type: "tool",
          name: chunk.toolName,
          args: chunk.input || {},
        }
      }
      if (chunk.type === "tool-result") {
        yield {
          type: "tool-result",
          name: chunk.toolName,
          result: chunk.output,
        }
      }
    }

    yield { type: "done" }
  } catch (error: any) {
    yield { type: "error", error: error.message }
  }
}
