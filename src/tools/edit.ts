// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { tool, jsonSchema } from "ai"
import z from "zod/v4"

const editSchema = z.object({
  path: z.string().describe("Path to the file to edit"),
  oldText: z.string().describe("Text to find and replace"),
  newText: z.string().describe("Text to replace with"),
})

export const edit = tool({
  description: "Edit a file by replacing old text with new text",
  inputSchema: jsonSchema(z.toJSONSchema(editSchema)),
  execute: async ({ path, oldText, newText }: { path: string; oldText: string; newText: string }) => {
    try {
      const file = Bun.file(path)
      const content = await file.text()

      if (!content.includes(oldText)) {
        return {
          error: `Could not find text to replace in ${path}`,
        }
      }

      const updated = content.replace(oldText, newText)
      await Bun.write(path, updated)

      return { success: true, message: `Updated ${path}` }
    } catch (error: any) {
      return { error: `Failed to edit ${path}: ${error.message}` }
    }
  },
})
