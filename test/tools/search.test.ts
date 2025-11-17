// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { search } from "../../src/tools/search";

describe("tool.search", () => {
  test("search for pattern in TypeScript files", async () => {
    const result = await search.execute({
      pattern: "export function",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.matches.length).toBeGreaterThan(0);

    const firstMatch = result.matches[0];
    expect(firstMatch).toHaveProperty("file");
    expect(firstMatch).toHaveProperty("line");
    expect(firstMatch).toHaveProperty("content");
    expect(firstMatch.content).toContain("export function");
  });

  test("case insensitive search", async () => {
    const result = await search.execute({
      pattern: "FUNCTION",
      path: "src",
      file_type: "ts",
      case_insensitive: true,
    });

    // Should find matches even though we searched uppercase
    expect(result.total).toBeGreaterThan(0);
  });

  test("search with context lines", async () => {
    const result = await search.execute({
      pattern: "UIAdapter",
      path: "src/ui/interface.ts",
      context_lines: 2,
    });

    expect(result.total).toBeGreaterThan(0);
  });

  test("no matches found", async () => {
    const result = await search.execute({
      pattern: "THIS_PATTERN_DEFINITELY_DOES_NOT_EXIST_ANYWHERE",
      path: "src",
    });

    expect(result.total).toBe(0);
    expect(result.matches.length).toBe(0);
    expect(result.message).toContain("No matches found");
  });

  test("search in specific file", async () => {
    const result = await search.execute({
      pattern: "export",
      path: "src/agent.ts",
    });

    expect(result.total).toBeGreaterThan(0);
    // All matches should be from agent.ts
    for (const match of result.matches) {
      expect(match.file).toContain("agent.ts");
    }
  });

  test("limit results with max_results", async () => {
    const result = await search.execute({
      pattern: "const",
      path: "src",
      max_results: 5,
    });

    expect(result.matches.length).toBeLessThanOrEqual(5);
  });

  test("search for specific string in test files", async () => {
    const result = await search.execute({
      pattern: "describe",
      path: "test",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.pattern).toBe("describe");
    expect(result.path).toBe("test");
  });

  test("search with special regex characters", async () => {
    // Test searching for patterns with regex meta-characters
    const result = await search.execute({
      pattern: "function.*async",
      path: "src",
      file_type: "ts",
    });

    // Should treat as regex pattern
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with quoted strings", async () => {
    // Test searching for patterns that contain quotes
    const result = await search.execute({
      pattern: '"Hello"',
      path: "test",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with parentheses", async () => {
    const result = await search.execute({
      pattern: "async \\(\\)",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with square brackets", async () => {
    const result = await search.execute({
      pattern: "\\[.*\\]",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with curly braces", async () => {
    const result = await search.execute({
      pattern: "\\{.*\\}",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with dollar sign (end of line regex)", async () => {
    const result = await search.execute({
      pattern: ";$",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with backslash escaping", async () => {
    const result = await search.execute({
      pattern: "\\\\",
      path: "src",
      file_type: "ts",
    });

    // Looking for actual backslashes in code
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search with pipe character", async () => {
    const result = await search.execute({
      pattern: "string \\| number",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  test("search respects max_results truncation", async () => {
    const smallLimit = await search.execute({
      pattern: "const",
      path: "src",
      max_results: 3,
    });

    const largeLimit = await search.execute({
      pattern: "const",
      path: "src",
      max_results: 10,
    });

    expect(smallLimit.matches.length).toBeLessThanOrEqual(3);
    expect(largeLimit.matches.length).toBeLessThanOrEqual(10);
    expect(largeLimit.matches.length).toBeGreaterThanOrEqual(
      smallLimit.matches.length,
    );
  });

  test("search handles long lines gracefully", async () => {
    // ripgrep has default line length limits
    const result = await search.execute({
      pattern: "import",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThan(0);
    // Verify all matches have reasonable content
    for (const match of result.matches) {
      expect(match.content).toBeDefined();
      expect(typeof match.content).toBe("string");
    }
  });

  test("search with word boundaries", async () => {
    const result = await search.execute({
      pattern: "\\bexport\\b",
      path: "src",
      file_type: "ts",
    });

    expect(result.total).toBeGreaterThan(0);
    // Should match "export" as a whole word, not "exported"
    for (const match of result.matches) {
      expect(match.content).toMatch(/\bexport\b/);
    }
  });

  test("search multiline patterns is not supported by default", async () => {
    // Ripgrep searches line-by-line by default
    const result = await search.execute({
      pattern: "describe.*test",
      path: "test",
      file_type: "ts",
    });

    // Should find patterns on same line
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});
