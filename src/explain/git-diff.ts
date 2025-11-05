import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parse } from "diff2html/lib-esm/diff-parser.js";
import type { DiffBlock, DiffFile } from "diff2html/lib-esm/types.js";
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

const DEFAULT_BASE_CANDIDATES = [
  "origin/master",
  "origin/main",
  "upstream/master",
  "upstream/main",
  "master",
  "main",
];

export async function resolveDefaultBaseRef(cwd: string): Promise<string> {
  await ensureGitRepo(cwd);

  for (const candidate of DEFAULT_BASE_CANDIDATES) {
    try {
      await execAsync(`git rev-parse --verify ${candidate}`, { cwd });
      try {
        const { stdout } = await execAsync(`git merge-base HEAD ${candidate}`, {
          cwd,
        });
        const mergeBase = stdout.trim();
        if (mergeBase) {
          return mergeBase;
        }
      } catch {
        // Fall back to the candidate itself if merge-base fails
        return candidate;
      }
    } catch {
      // candidate not found, continue
    }
  }

  // Fall back to previous commit
  const fallbacks = ["HEAD~1", "HEAD^1"];
  for (const fallback of fallbacks) {
    try {
      const { stdout } = await execAsync(`git rev-parse ${fallback}`, {
        cwd,
      });
      const ref = stdout.trim();
      if (ref) {
        return ref;
      }
    } catch {
      // Ignore failures and continue
    }
  }

  throw new Error(
    "Unable to determine base ref automatically. Please specify a base ref.",
  );
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

  const args = ["diff", `--unified=${contextLines}`, `${base}..${head}`];

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
