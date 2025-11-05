/**
 * Syntax styling system for code and markdown rendering
 * Uses @opentui/core's SyntaxStyle with tree-sitter
 */
import { RGBA, SyntaxStyle } from "@opentui/core";
import type { Theme } from "./colors";

/**
 * Create a SyntaxStyle instance from a yeet theme
 * This maps yeet's theme colors to tree-sitter syntax scopes
 */
export function createSyntaxStyle(theme: Theme): SyntaxStyle {
  return SyntaxStyle.fromTheme([
    // Comments
    {
      scope: ["comment"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        italic: true,
        dim: true,
      },
    },
    {
      scope: ["comment.documentation"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        italic: true,
        dim: true,
      },
    },

    // Markdown headings
    {
      scope: [
        "markup.heading",
        "markup.heading.1",
        "markup.heading.2",
        "markup.heading.3",
        "markup.heading.4",
        "markup.heading.5",
        "markup.heading.6",
      ],
      style: {
        foreground: RGBA.fromHex(theme.userBlue),
        bold: true,
      },
    },

    // Markdown text formatting
    {
      scope: ["markup.bold", "markup.strong"],
      style: {
        foreground: RGBA.fromHex(theme.warningYellow),
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: RGBA.fromHex(theme.toolMagenta),
        italic: true,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        dim: true,
      },
    },

    // Markdown lists
    {
      scope: ["markup.list"],
      style: {
        foreground: RGBA.fromHex(theme.successGreen),
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: RGBA.fromHex(theme.successGreen),
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        dim: true,
      },
    },

    // Markdown code
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: RGBA.fromHex(theme.toolMagenta),
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: RGBA.fromHex(theme.toolMagenta),
        background: RGBA.fromHex(theme.background),
      },
    },

    // Markdown links
    {
      scope: ["markup.link"],
      style: {
        foreground: RGBA.fromHex(theme.userBlue),
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: RGBA.fromHex(theme.userBlue),
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: RGBA.fromHex(theme.userBlue),
        underline: true,
      },
    },

    // Markdown quotes
    {
      scope: ["markup.quote"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        italic: true,
        dim: true,
      },
    },
    {
      scope: ["punctuation.special"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        dim: true,
      },
    },

    // Code syntax highlighting (for code blocks)
    {
      scope: ["string", "symbol"],
      style: {
        foreground: RGBA.fromHex(theme.successGreen),
      },
    },
    {
      scope: ["number", "boolean"],
      style: {
        foreground: RGBA.fromHex(theme.warningYellow),
      },
    },
    {
      scope: [
        "keyword",
        "keyword.return",
        "keyword.conditional",
        "keyword.repeat",
      ],
      style: {
        foreground: RGBA.fromHex(theme.errorRed),
        italic: true,
      },
    },
    {
      scope: ["function", "function.method", "function.call"],
      style: {
        foreground: RGBA.fromHex(theme.userBlue),
      },
    },
    {
      scope: ["variable", "variable.parameter"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
      },
    },
    {
      scope: ["type", "type.builtin"],
      style: {
        foreground: RGBA.fromHex(theme.warningYellow),
      },
    },
    {
      scope: ["operator", "keyword.operator"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
      },
    },
    {
      scope: ["punctuation", "punctuation.bracket", "punctuation.delimiter"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        dim: true,
      },
    },
    {
      scope: ["constant", "constant.builtin"],
      style: {
        foreground: RGBA.fromHex(theme.warningYellow),
      },
    },

    // Special handling for concealed syntax
    {
      scope: ["conceal"],
      style: {
        foreground: RGBA.fromHex(theme.foreground),
        dim: true,
      },
    },
  ]);
}
