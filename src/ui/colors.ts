/**
 * Color system using @opentui's fg() function with RGB colors.
 * @opentui doesn't support terminal-native ANSI colors, only RGB.
 * Themes match ~/configs/themes (tokyonight, nord, catppuccin-macchiato, everforest-dark)
 */
import { type TextChunk, bold, dim, fg, t } from "@opentui/core";

// Re-export for convenience
export { bold, dim, fg, t };

export interface Theme {
  name: string;
  background: string;
  foreground: string;
  userBlue: string;
  successGreen: string;
  errorRed: string;
  warningYellow: string;
  toolMagenta: string;
}

export const themes: Record<string, Theme> = {
  tokyonight: {
    name: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#c0caf5",
    userBlue: "#7aa2f7",
    successGreen: "#9ece6a",
    errorRed: "#f7768e",
    warningYellow: "#e0af68",
    toolMagenta: "#bb9af7",
  },
  nord: {
    name: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    userBlue: "#81a1c1",
    successGreen: "#a3be8c",
    errorRed: "#bf616a",
    warningYellow: "#ebcb8b",
    toolMagenta: "#b48ead",
  },
  catppuccin: {
    name: "Catppuccin Macchiato",
    background: "#24273a",
    foreground: "#cad3f5",
    userBlue: "#8aadf4",
    successGreen: "#a6da95",
    errorRed: "#ed8796",
    warningYellow: "#eed49f",
    toolMagenta: "#f5bde6",
  },
  everforest: {
    name: "Everforest Dark",
    background: "#2f383e",
    foreground: "#d3c6aa",
    userBlue: "#7fbbb3",
    successGreen: "#a7c080",
    errorRed: "#e67e80",
    warningYellow: "#dbbc7f",
    toolMagenta: "#d699b6",
  },
};

export const themeNames = Object.keys(themes);

// Current active theme
let currentTheme: Theme = themes.tokyonight;

/**
 * Set the active theme
 */
export function setTheme(themeName: string): Theme {
  if (themes[themeName]) {
    currentTheme = themes[themeName];
  }
  return currentTheme;
}

/**
 * Get the current theme
 */
export function getCurrentTheme(): Theme {
  return currentTheme;
}

/**
 * Cycle to the next theme
 */
export function cycleTheme(): Theme {
  const currentIndex = themeNames.indexOf(
    Object.keys(themes).find((k) => themes[k] === currentTheme) || "tokyonight",
  );
  const nextIndex = (currentIndex + 1) % themeNames.length;
  return setTheme(themeNames[nextIndex]);
}

/**
 * Semantic styled text builders for UI elements.
 * These return TextChunk which can be embedded in template literals.
 * Colors adapt to the current theme dynamically.
 */
export const semantic = {
  // User input - bold blue (dynamically accesses current theme)
  userPrefix: (text: string) => bold(fg(getCurrentTheme().userBlue)(text)),

  // Assistant - dimmed
  assistantPrefix: (text: string) => dim(text),

  // Tool calls - magenta (dynamically accesses current theme)
  tool: (text: string) => fg(getCurrentTheme().toolMagenta)(text),

  // Status indicators (dynamically access current theme)
  success: (text: string) => fg(getCurrentTheme().successGreen)(text),
  error: (text: string) => fg(getCurrentTheme().errorRed)(text),
  warning: (text: string) => fg(getCurrentTheme().warningYellow)(text),
};

/**
 * Create a box decoration for tool calls.
 * Returns a formatted string with box characters.
 */
export function createBox(content: string, width = 60): string {
  const contentLines = content
    .split("\n")
    .map((line) => `│ ${line}`)
    .join("\n");

  const bottomBorder = "└" + "─".repeat(width - 1);

  return `${contentLines}\n${bottomBorder}`;
}

/**
 * Create the top border for a tool box
 */
export function createBoxTop(): string {
  return `┌─ `;
}

export function createBoxTopEnd(titleWidth = 10, totalWidth = 60): string {
  const padding = "─".repeat(Math.max(0, totalWidth - titleWidth - 4));
  return ` ${padding}`;
}
