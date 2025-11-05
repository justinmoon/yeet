import { randomUUID } from "node:crypto";
import { getGitDiff, resolveDefaultBaseRef } from "./git-diff";
import { normalizeRequest } from "./intent";
import { planSections } from "./section-planner";
import type {
  DiffLine,
  DiffSection,
  ExplainIntent,
  ExplainRequest,
  ExplainResult,
  TutorialSection,
} from "./types";

export async function explain(request: ExplainRequest): Promise<ExplainResult> {
  const intent = normalizeRequest(request);
  const diffs = await getGitDiff({
    cwd: intent.cwd,
    base: intent.base,
    head: intent.head,
    includePath: intent.includePath,
  });
  const sections = await planSections(intent, diffs);
  return { intent, diffs, sections };
}

export * from "./types";

export { getGitDiff, resolveDefaultBaseRef } from "./git-diff";
export { normalizeRequest } from "./intent";
export { planSections } from "./section-planner";

function createStubDiff(
  id: string,
  filePath: string,
  header: string,
  lines: DiffLine[],
): DiffSection {
  return {
    id,
    filePath,
    header,
    lines,
  };
}

function createStubSection(
  id: string,
  title: string,
  explanation: string,
  diffId: string,
  tags?: string[],
): TutorialSection {
  return {
    id,
    title,
    explanation,
    diffId,
    tags,
  };
}

export function createStubExplainResult(intent: ExplainIntent): ExplainResult {
  const diffIdA = randomUUID();
  const diffIdB = randomUUID();

  const diffs: DiffSection[] = [
    createStubDiff(diffIdA, "README.md", "@@ 25,7 25,12 @@", [
      {
        type: "context",
        content: "## Usage",
        oldLineNumber: 25,
        newLineNumber: 25,
      },
      {
        type: "add",
        content: './src/explain/cli.ts --prompt "Teach me the PTY changes"',
        oldLineNumber: null,
        newLineNumber: 32,
      },
      {
        type: "add",
        content: "--cwd ~/code/project --base main --head feature",
        oldLineNumber: null,
        newLineNumber: 33,
      },
      {
        type: "context",
        content: "```",
        oldLineNumber: 35,
        newLineNumber: 36,
      },
    ]),
    createStubDiff(diffIdB, "src/explain/cli.ts", "@@ 12,6 12,11 @@", [
      {
        type: "context",
        content: "program",
        oldLineNumber: 12,
        newLineNumber: 12,
      },
      {
        type: "add",
        content: '.option("--include <path>", "Optional path filter")',
        oldLineNumber: null,
        newLineNumber: 18,
      },
      {
        type: "context",
        content: '.option("--json", "Output raw JSON", false);',
        oldLineNumber: 19,
        newLineNumber: 20,
      },
    ]),
  ];

  const sections: TutorialSection[] = [
    createStubSection(
      randomUUID(),
      "Document the new explain CLI",
      "We add documentation for the explain CLI in README.md, showing how to call the command with base/head references. This keeps users informed about the feature we're testing.",
      diffIdA,
      ["docs", "readme"],
    ),
    createStubSection(
      randomUUID(),
      "Expose CLI options",
      "The CLI definition now declares the `--include` option as well as JSON output, ensuring the interface is discoverable. Verify that these options print in `--help`.",
      diffIdB,
      ["cli", "tooling"],
    ),
  ];

  return {
    intent,
    diffs,
    sections,
  };
}
