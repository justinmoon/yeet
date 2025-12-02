// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";
import { resolveWorkspacePath } from "../workspace/state";

const readSchema = z.object({
  path: z.string().describe("Path to the file to read"),
});

export const read = tool({
  description: "Read the contents of a file",
  inputSchema: jsonSchema(z.toJSONSchema(readSchema)),
  execute: async ({ path }: { path: string }) => {
    try {
      const resolvedPath = resolveWorkspacePath(path);
      const file = Bun.file(resolvedPath);
      const content = await file.text();
      return { content };
    } catch (error: any) {
      return { error: `Failed to read ${path}: ${error.message}` };
    }
  },
});
