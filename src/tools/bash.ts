// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import { $ } from "bun";
import z from "zod/v4";
import { getActiveWorkspaceBinding } from "../workspace/state";

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds default timeout

const bashSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeout: z
    .number()
    .optional()
    .describe(
      "Timeout in milliseconds. Defaults to 30000 (30 seconds). If a command times out, consider retrying with a longer timeout.",
    ),
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

    const binding = getActiveWorkspaceBinding();
    if (!binding.allowWrites) {
      return {
        error: `Workspace "${binding.label || binding.cwd}" is read-only; bash tool is disabled.`,
        exitCode: 1,
      };
    }

    const timeoutMs = args.timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      // quiet() prevents Bun from writing command output directly to terminal
      const proc = $`sh -c ${command}`.cwd(binding.cwd).nothrow().quiet();

      // Race between command completion and timeout
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs),
      );

      const raceResult = await Promise.race([proc, timeoutPromise]);

      if (raceResult === "timeout") {
        // Kill the process on timeout
        try {
          proc.kill();
        } catch {
          // Process may have already exited
        }
        return {
          error: `Command timed out after ${timeoutMs}ms. If this command needs more time, retry with a longer timeout (e.g., timeout: ${timeoutMs * 2}).`,
          exitCode: 124, // Standard timeout exit code
          timedOut: true,
        };
      }

      const result = raceResult;
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
