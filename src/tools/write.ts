// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";
import { ensureWorkspaceWriteAccess, resolveWorkspacePath } from "../workspace/state";
import { createFileDiff } from "./diff-utils";

const writeSchema = z.object({
  path: z.string().describe("Path for the new file"),
  content: z.string().describe("Content to write"),
});

export const write = tool({
  description: "Write content to a new file",
  inputSchema: jsonSchema(z.toJSONSchema(writeSchema)),
  execute: async ({ path, content }: { path: string; content: string }) => {
    try {
      ensureWorkspaceWriteAccess(`write to ${path}`);
      const resolvedPath = resolveWorkspacePath(path);
      const file = Bun.file(resolvedPath);
      const existedBefore = await file.exists();
      const beforeContent = existedBefore ? await file.text() : "";

      await Bun.write(resolvedPath, content);

      const afterContent = await Bun.file(resolvedPath).text();
      const diff = createFileDiff(path, beforeContent, afterContent);

      return { success: true, message: `Created ${path}`, diff };
    } catch (error: any) {
      return { error: `Failed to write ${path}: ${error.message}` };
    }
  },
});
