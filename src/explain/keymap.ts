import type { KeyEvent } from "@opentui/core";

export type ExplainKeyAction =
  | "none"
  | "previous"
  | "next"
  | "close"
  | "submit";

function normalizeKey(
  event: Pick<KeyEvent, "name"> & { key?: string; code?: string },
): string {
  return (event.name || event.key || event.code || "").toLowerCase();
}

export function interpretExplainKey(
  event: Pick<KeyEvent, "name"> & { key?: string; code?: string },
): ExplainKeyAction {
  const key = normalizeKey(event);

  switch (key) {
    case "escape":
    case "q":
      return "close";
    case "left":
    case "arrowleft":
    case "up":
    case "arrowup":
    case "p":
    case "k":
      return "previous";
    case "right":
    case "arrowright":
    case "down":
    case "arrowdown":
    case "n":
    case "j":
      return "next";
    case "return":
    case "enter":
      return "submit";
    default:
      return "none";
  }
}
