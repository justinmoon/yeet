import { cyan, dim, t, type StyledText } from "@opentui/core";

/**
 * Format an assistant response for the TUI's legacy text stream.
 * We indent multi-line responses so they stand out from user prompts.
 */
export function formatAssistantMessage(
  content: string,
): string | StyledText {
  const trimmed = (content ?? "").replace(/\s+$/g, "");
  if (!trimmed) {
    return "";
  }

  const indented = trimmed
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

  return t`${cyan("[yeet]")}\n${indented}\n\n`;
}

/**
 * Format tool output/events so they are easy to scan in the scrollback.
 */
export function formatToolMessage(
  toolName: string,
  content: string,
): string | StyledText {
  const header = toolName?.trim() || "tool";
  const body = (content ?? "").trimEnd();
  if (!body) {
    return t`${dim(`[${header}]`)}\n`;
  }

  const indented = body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

  return t`${dim(`[${header}]`)}\n${indented}\n`;
}
