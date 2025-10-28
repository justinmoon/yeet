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
      pattern: "createUI",
      path: "src/ui.ts",
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
});
