import { createTwoFilesPatch } from "diff";

/**
 * Generate a unified diff for a file mutation.
 * Mirrors opencode's "before vs after" snapshot behavior.
 */
export function createFileDiff(
  path: string,
  beforeContent: string,
  afterContent: string,
): string {
  const patch = createTwoFilesPatch(
    path,
    path,
    beforeContent ?? "",
    afterContent ?? "",
    undefined,
    undefined,
    { context: 3 },
  );
  // createTwoFilesPatch always ends with a newline - trim to avoid double spacing
  return patch.trimEnd();
}
