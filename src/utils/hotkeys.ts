export interface HotkeyEventLike {
  name?: string;
  key?: string;
  code?: string;
  ctrl?: boolean;
  ctrlKey?: boolean;
  meta?: boolean;
  metaKey?: boolean;
  alt?: boolean;
  altKey?: boolean;
  shift?: boolean;
  shiftKey?: boolean;
}

export interface HotkeyDescriptor {
  combo: string;
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  cmdOrCtrl: boolean;
}

const MODIFIER_ORDER = ["cmdorctrl", "meta", "ctrl", "alt", "shift"] as const;
const MODIFIER_SET = new Set(MODIFIER_ORDER);

function normalizeSegment(segment: string): string {
  switch (segment.toLowerCase()) {
    case "cmd":
    case "command":
    case "meta":
      return "meta";
    case "cmdorctrl":
    case "cmdctrl":
    case "cmd/ctrl":
    case "super":
      return "cmdorctrl";
    case "control":
    case "ctrl":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    default:
      return segment.toLowerCase();
  }
}

function orderedModifiers(mods: string[]): string[] {
  const unique = Array.from(new Set(mods));
  return unique.sort(
    (a, b) => MODIFIER_ORDER.indexOf(a as any) - MODIFIER_ORDER.indexOf(b as any),
  );
}

/**
 * Normalize a user-provided combo string into canonical order.
 * Returns empty string when the combo is invalid.
 */
export function normalizeHotkeyCombo(combo: string): string {
  if (!combo || typeof combo !== "string") {
    return "";
  }

  const segments = combo
    .split("+")
    .map((segment) => normalizeSegment(segment.trim()))
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return "";
  }

  const modifiers: string[] = [];
  let key: string | null = null;

  for (const segment of segments) {
    if (MODIFIER_SET.has(segment as any)) {
      modifiers.push(segment);
    } else if (!key) {
      key = segment;
    } else {
      key = segment;
    }
  }

  if (!key) {
    key = modifiers.pop() ?? "";
  }

  if (!key) {
    return "";
  }

  const normalizedModifiers = orderedModifiers(
    modifiers.filter((segment) => segment !== key),
  );
  const parts = [...normalizedModifiers, key];
  return parts.join("+");
}

function resolveEventKey(event: HotkeyEventLike): string {
  const raw = event.name || event.key || event.code || "";
  if (!raw) return "";
  let normalized = raw.toLowerCase();
  if (normalized.startsWith("key")) {
    normalized = normalized.slice(3);
  }
  return normalized;
}

function resolveModifier(
  primary?: boolean,
  secondary?: boolean,
): boolean {
  if (typeof primary === "boolean") {
    return primary;
  }
  if (typeof secondary === "boolean") {
    return secondary;
  }
  return false;
}

export function parseHotkeyCombo(combo: string): HotkeyDescriptor | null {
  const normalized = normalizeHotkeyCombo(combo);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split("+");
  let key: string | null = null;
  let cmdOrCtrl = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;

  for (const part of parts) {
    if (part === "cmdorctrl") {
      cmdOrCtrl = true;
    } else if (part === "ctrl") {
      ctrl = true;
    } else if (part === "meta") {
      meta = true;
    } else if (part === "alt") {
      alt = true;
    } else if (part === "shift") {
      shift = true;
    } else {
      key = part;
    }
  }

  if (!key) {
    return null;
  }

  return {
    combo: normalized,
    key,
    ctrl,
    meta,
    alt,
    shift,
    cmdOrCtrl,
  };
}

export function matchHotkeyEvent(
  descriptor: HotkeyDescriptor,
  event: HotkeyEventLike,
): boolean {
  const eventKey = resolveEventKey(event);
  if (!eventKey) return false;

  const keyMatches =
    descriptor.key === eventKey ||
    (descriptor.key === "enter" &&
      (eventKey === "return" || eventKey === "enter"));

  if (!keyMatches) {
    return false;
  }

  const ctrlActive = resolveModifier(event.ctrl, event.ctrlKey);
  const metaActive = resolveModifier(event.meta, event.metaKey);
  const altActive = resolveModifier(event.alt, event.altKey);
  const shiftActive = resolveModifier(event.shift, event.shiftKey);

  if (descriptor.cmdOrCtrl) {
    if (!ctrlActive && !metaActive) {
      return false;
    }
  } else if (descriptor.ctrl !== ctrlActive || descriptor.meta !== metaActive) {
    return false;
  }

  if (descriptor.alt !== altActive) return false;
  if (descriptor.shift !== shiftActive) return false;

  return true;
}
