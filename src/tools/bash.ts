// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { tool, jsonSchema } from "ai"
import z from "zod/v4"
import { $ } from "bun"

const bashSchema = z.object({
  command: z.string().describe("The bash command to execute"),
})

export const bash = tool({
  description: "Execute a bash command in the current directory",
  inputSchema: jsonSchema(z.toJSONSchema(bashSchema)),
  execute: async (args: any) => {
    // Debug: log what we receive
    console.error("[bash] Received args:", JSON.stringify(args, null, 2))
    console.error("[bash] Type of args:", typeof args)
    console.error("[bash] Args keys:", Object.keys(args || {}))
    
    // Try multiple ways to extract the command
    let command: string | undefined
    if (typeof args === "string") {
      command = args
    } else if (args && typeof args === "object") {
      command = args.command || args.input?.command || args.arguments?.command
    }
    
    if (!command) {
      return {
        error: "No command provided. Received: " + JSON.stringify(args),
        exitCode: 1,
      }
    }
    
    try {
      const result = await $`sh -c ${command}`.nothrow()
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode,
      }
    } catch (error: any) {
      return {
        error: error.message,
        exitCode: 1,
      }
    }
  },
})
