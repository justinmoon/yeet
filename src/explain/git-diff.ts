import fs from "node:fs";
import path from "node:path";
import { parse } from "diff2html/lib-esm/diff-parser.js";
import type { DiffBlock, DiffFile } from "diff2html/lib-esm/types.js";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { DiffLine, DiffSection } from "./types";

const execAsync = promisify(exec);

export interface GitDiffOptions {
  cwd: string;
  base: string;
  head: string;
  includePath?: string;
  contextLines?: number;
  maxFiles?: number;
}

export async function ensureGitRepo(cwd: string): Promise<void> {
  const gitDir = path.join(cwd, ".git");
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Directory ${cwd} is not a git repository`);
  }
}

export async function getGitDiff({
  cwd,
  base,
  head,
  includePath,
  contextLines = 3,
  maxFiles = 50,
}: GitDiffOptions): Promise<DiffSection[]> {
  await ensureGitRepo(cwd);

  const args = [
    "diff",
    `--unified=${contextLines}`,
    `${base}..${head}`,
  ];

  if (includePath) {
    args.push("--", includePath);
  }

  const { stdout } = await execAsync(`git ${args.join(" ")}`, { cwd });
  const diffText = stdout.trim();
  if (!diffText) {
    return [];
  }

  const parsed = parse(diffText, {
    diffMaxChanges: Number.MAX_SAFE_INTEGER,
  }) as DiffFile[];

  const sections: DiffSection[] = [];

  for (const file of parsed.slice(0, maxFiles)) {
    for (const block of file.blocks as DiffBlock[]) {
      const lines: DiffLine[] = block.lines.map((line) => ({
        type:
          line.type === "insert"
            ? "add"
            : line.type === "delete"
              ? "remove"
              : "context",
        content: line.content,
        oldLineNumber: line.oldNumber ?? null,
        newLineNumber: line.newNumber ?? null,
      }));

      sections.push({
        id: randomUUID(),
        filePath: file.newName || file.oldName || "unknown",
        header: block.header || "",
        lines,
      });
    }
  }

  return sections;
}
