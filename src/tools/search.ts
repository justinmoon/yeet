import { exec } from "node:child_process";
import { promisify } from "node:util";
// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { jsonSchema, tool } from "ai";
import z from "zod/v4";

const execAsync = promisify(exec);

const searchSchema = z.object({
  pattern: z.string().describe("The text or regex pattern to search for"),
  path: z
    .string()
    .optional()
    .describe("Directory to search in (default: current directory)"),
  file_type: z
    .string()
    .optional()
    .describe("Filter by file extension (e.g., 'ts', 'js', 'py', 'md')"),
  case_insensitive: z
    .boolean()
    .optional()
    .describe("Perform case-insensitive search"),
  context_lines: z
    .number()
    .optional()
    .describe("Number of lines to show before/after each match"),
  max_results: z
    .number()
    .optional()
    .describe("Maximum number of matches to return"),
});

export const search = tool({
  description: `Search for text patterns in files using ripgrep. 
Returns file paths, line numbers, and matching content.
Use this instead of bash grep for better structured results.`,
  inputSchema: jsonSchema(z.toJSONSchema(searchSchema)),
  execute: async (args: any) => {
    const pattern = args.pattern;
    const path = args.path || ".";
    const file_type = args.file_type;
    const case_insensitive = args.case_insensitive || false;
    const context_lines = args.context_lines || 0;
    const max_results = args.max_results || 50;

    try {
      // Build ripgrep command
      const rgArgs: string[] = [
        "rg",
        "--color=never",
        "--line-number",
        "--no-heading",
        "--with-filename",
        `--max-count=${max_results}`,
      ];

      if (case_insensitive) {
        rgArgs.push("--ignore-case");
      }

      if (context_lines > 0) {
        rgArgs.push(`--context=${context_lines}`);
      }

      if (file_type) {
        rgArgs.push(`--type=${file_type}`);
      }

      // Add pattern and path (quote pattern for safety)
      rgArgs.push(`"${pattern}"`);
      rgArgs.push(path);

      const command = rgArgs.join(" ");
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
        cwd: process.cwd(),
      });

      if (stderr && !stderr.includes("No such file")) {
        return {
          error: stderr,
          matches: [],
          total: 0,
        };
      }

      // Parse ripgrep output
      const lines = stdout.trim().split("\n").filter(Boolean);

      if (lines.length === 0) {
        return {
          matches: [],
          total: 0,
          message: `No matches found for pattern: ${pattern}`,
        };
      }

      // Format: filename:line:content
      const matches = lines
        .slice(0, max_results)
        .map((line) => {
          const match = line.match(/^([^:]+):(\d+):(.*)$/);
          if (!match) return null;

          const [, file, lineNum, content] = match;
          return {
            file,
            line: Number.parseInt(lineNum, 10),
            content: content.trim(),
          };
        })
        .filter(Boolean);

      return {
        matches,
        total: matches.length,
        pattern,
        path,
        truncated: lines.length > max_results,
      };
    } catch (error: any) {
      // ripgrep exits with code 1 when no matches found
      if (error.code === 1) {
        return {
          matches: [],
          total: 0,
          message: `No matches found for pattern: ${pattern}`,
        };
      }

      return {
        error: `Search failed: ${error.message}`,
        matches: [],
        total: 0,
      };
    }
  },
});
