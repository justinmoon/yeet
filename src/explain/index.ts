import { getGitDiff, resolveDefaultBaseRef } from "./git-diff";
import { normalizeRequest } from "./intent";
import { planSections } from "./section-planner";
import type { ExplainRequest, ExplainResult } from "./types";

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

export { resolveDefaultBaseRef } from "./git-diff";
