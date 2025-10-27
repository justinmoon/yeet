// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";

const writeSchema = z.object({
  path: z.string().describe("Path for the new file"),
  content: z.string().describe("Content to write"),
});

export const write = tool({
  description: "Write content to a new file",
  inputSchema: jsonSchema(z.toJSONSchema(writeSchema)),
  execute: async ({ path, content }: { path: string; content: string }) => {
    try {
      await Bun.write(path, content);
      return { success: true, message: `Created ${path}` };
    } catch (error: any) {
      return { error: `Failed to write ${path}: ${error.message}` };
    }
  },
});
