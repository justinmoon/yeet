// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import { $ } from "bun";
import z from "zod/v4";

const bashSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

export const bash = tool({
  description: "Execute a bash command in the current directory",
  inputSchema: jsonSchema(z.toJSONSchema(bashSchema)),
  execute: async (args: any) => {
    const command = args.command;

    if (!command) {
      return {
        error: "No command provided. Received: " + JSON.stringify(args),
        exitCode: 1,
      };
    }

    try {
      // quiet() prevents Bun from writing command output directly to terminal
      const result = await $`sh -c ${command}`.nothrow().quiet();
      return {
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode,
      };
    } catch (error: any) {
      return {
        error: error.message,
        exitCode: 1,
      };
    }
  },
});
