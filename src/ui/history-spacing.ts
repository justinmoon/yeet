import type { StyledText } from "@opentui/core";
import type { UIAdapter } from "./interface";

export function appendHistoryEntry(
  ui: UIAdapter,
  _groupId: string,
  content: string | StyledText,
): void {
  ui.appendOutput(content);
}

export function resetHistorySpacing(_ui: UIAdapter): void {
  // no-op
}
