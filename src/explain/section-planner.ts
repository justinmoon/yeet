import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { createExplainModel } from "./model";
import type { DiffSection, ExplainIntent, TutorialSection } from "./types";

const SectionSchema = z.object({
  title: z.string().min(1),
  diffId: z.string().min(1),
  explanation: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

const PlannerSchema = z.object({
  sections: z.array(SectionSchema),
});

function buildPlannerPrompt(
  intent: ExplainIntent,
  diffs: DiffSection[],
): string {
  const diffSummary = diffs
    .map(
      (diff) =>
        `ID: ${diff.id}\nFile: ${diff.filePath}\nHeader: ${diff.header}\nSample:\n${diff.lines
          .slice(0, 5)
          .map(
            (line) =>
              `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.content}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

  return `You are a senior engineer preparing a tutorial for a teammate.
We are reviewing git changes from ${intent.base}..${intent.head} in ${intent.cwd}${
    intent.includePath ? ` (restricted to ${intent.includePath})` : ""
  }.

User prompt:
"""${intent.prompt}"""

Diff summaries:
${diffSummary}

Use the diff summaries with their IDs to plan ordered tutorial sections.
Each section must reference exactly one diffId from the provided list.
Return JSON only matching { "sections": [ { "title", "diffId", "explanation", "tags"? } ] }.
Focus on clarity, motivations, risks, and testing implications.
If a diff is not relevant, omit it.
`;
}

export async function planSections(
  intent: ExplainIntent,
  diffs: DiffSection[],
): Promise<TutorialSection[]> {
  if (diffs.length === 0) {
    return [];
  }

  const model = await createExplainModel();
  const prompt = buildPlannerPrompt(intent, diffs);

  let result;
  try {
    result = await generateObject({
      model,
      prompt,
      schema: PlannerSchema,
    });
  } catch (error: any) {
    console.warn("Structured output failed, using text generation fallback");
    const { generateText } = await import("ai");
    const textResult = await generateText({
      model,
      prompt:
        prompt +
        '\n\nRespond with JSON only matching this schema: {"sections": [{"title": "...", "diffId": "...", "explanation": "...", "tags": ["..."]}]}',
    });
    const parsed = JSON.parse(
      textResult.text.replace(/```json\n?|\n?```/g, "").trim(),
    );
    result = { object: parsed };
  }

  return result.object.sections.map((section) => ({
    id: randomUUID(),
    title: section.title,
    explanation: section.explanation,
    diffId: section.diffId,
    tags: section.tags,
  }));
}
