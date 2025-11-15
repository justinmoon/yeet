import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { generateObject } from "ai";
import { z } from "zod";
import { createExplainModel } from "./model";

/**
 * Get git repository context information
 */
function getGitContext(cwd: string): {
  currentBranch: string;
  branches: string[];
  remoteBranches: string[];
  recentCommits: string;
} {
  try {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
    }).trim();

    const branches = execSync("git branch --format='%(refname:short)'", {
      cwd,
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);

    const remoteBranches = execSync(
      "git branch -r --format='%(refname:short)'",
      {
        cwd,
        encoding: "utf-8",
      },
    )
      .trim()
      .split("\n")
      .filter(Boolean);

    const recentCommits = execSync("git log --oneline -10", {
      cwd,
      encoding: "utf-8",
    }).trim();

    return { currentBranch, branches, remoteBranches, recentCommits };
  } catch (error: any) {
    throw new Error(`Failed to get git context: ${error.message}`);
  }
}

const InferParamsSchema = z.object({
  base: z.string().describe("The base git ref to compare from"),
  head: z.string().describe("The head git ref to compare to"),
  reasoning: z
    .string()
    .describe("Brief explanation of why these refs were chosen"),
});

/**
 * Use LLM to infer git parameters from user prompt and repo context
 */
export async function inferGitParams(options: {
  prompt: string;
  cwd?: string;
  base?: string;
  head?: string;
}): Promise<{
  cwd: string;
  base: string;
  head: string;
}> {
  const cwd = options.cwd || process.cwd();

  // Verify it's a git repo
  const gitDir = path.join(cwd, ".git");
  if (!existsSync(gitDir)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  // If base and head are already provided, use them
  if (options.base && options.head) {
    return { cwd, base: options.base, head: options.head };
  }

  // Get git context
  const gitContext = getGitContext(cwd);

  // Use LLM to infer the missing parameters
  const model = await createExplainModel();

  const inferencePrompt = `You are analyzing a user's request to explain git changes.

User's prompt: "${options.prompt}"

Git repository context:
- Current branch: ${gitContext.currentBranch}
- Local branches: ${gitContext.branches.join(", ")}
- Remote branches: ${gitContext.remoteBranches.join(", ")}
- Recent commits:
${gitContext.recentCommits}

${options.base ? `User specified base: ${options.base}` : "User did not specify a base ref"}
${options.head ? `User specified head: ${options.head}` : "User did not specify a head ref"}

Based on the user's prompt and the git context, determine:
1. What base ref should we compare from?
2. What head ref should we compare to?

Common patterns:
- If user says "what changed" or "my changes" without specifying, use master/main as base and HEAD as head
- If user mentions a branch name, that's likely the base
- If user says "explain diff against X", X is the base
- HEAD typically represents the current working state
- If comparing branches, user likely wants to see changes in current branch vs another

Choose refs that best match the user's intent.`;

  let base = options.base;
  let head = options.head;

  try {
    const result = await generateObject({
      model,
      prompt: inferencePrompt,
      schema: InferParamsSchema,
    });
    base = base || result.object.base;
    head = head || result.object.head;
  } catch (error: any) {
    console.warn(
      "LLM inference failed, using rule-based fallback:",
      error.message,
    );

    // Simple fallback rules
    if (!base) {
      // Check for common branch mentions in prompt
      const masterMatch = options.prompt.match(
        /\b(master|main|origin\/master|origin\/main|develop|trunk)\b/i,
      );
      if (masterMatch) {
        base = masterMatch[1];
      } else {
        // Detect which default branch exists
        try {
          execSync("git rev-parse --verify main", {
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
          });
          base = "main";
        } catch {
          base = "master";
        }
      }
    }

    if (!head) {
      head = "HEAD";
    }
  }

  return { cwd, base, head };
}
