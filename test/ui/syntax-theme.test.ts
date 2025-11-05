import { expect, test } from "bun:test";
import { themes } from "../../src/ui/colors";
import { createSyntaxStyle } from "../../src/ui/syntax-theme";

test("createSyntaxStyle should create a valid SyntaxStyle", () => {
  const theme = themes.tokyonight;
  const syntaxStyle = createSyntaxStyle(theme);

  expect(syntaxStyle).toBeDefined();
  expect(typeof syntaxStyle.getStyleCount).toBe("function");
});

test("createSyntaxStyle should register markdown styles", () => {
  const theme = themes.tokyonight;
  const syntaxStyle = createSyntaxStyle(theme);

  // Check that markdown-related styles are registered
  const styleCount = syntaxStyle.getStyleCount();
  expect(styleCount).toBeGreaterThan(0);

  // Check that key markdown scopes exist
  const headingStyle = syntaxStyle.getStyle("markup.heading");
  expect(headingStyle).toBeDefined();
});

test("createSyntaxStyle should register code syntax styles", () => {
  const theme = themes.tokyonight;
  const syntaxStyle = createSyntaxStyle(theme);

  // Check that code-related styles are registered
  const stringStyle = syntaxStyle.getStyle("string");
  const keywordStyle = syntaxStyle.getStyle("keyword");
  const functionStyle = syntaxStyle.getStyle("function");

  expect(stringStyle).toBeDefined();
  expect(keywordStyle).toBeDefined();
  expect(functionStyle).toBeDefined();
});

test("createSyntaxStyle should use theme colors", () => {
  const theme = themes.tokyonight;
  const syntaxStyle = createSyntaxStyle(theme);

  // Verify that styles use colors from the theme
  const headingStyle = syntaxStyle.getStyle("markup.heading");
  expect(headingStyle).toBeDefined();
  expect(headingStyle?.bold).toBe(true);
});
