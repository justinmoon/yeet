// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { edit } from "../../src/tools/edit";

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "yeet-test-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("tool.edit", () => {
  test("edit existing text", async () => {
    const testFile = join(testDir, "edit.txt");
    await writeFile(testFile, "Hello, World!");

    const result = await edit.execute(
      {
        path: testFile,
        oldText: "World",
        newText: "Yeet",
      },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("Hello, Yeet!");
  });

  test("edit with non-existent text", async () => {
    const testFile = join(testDir, "edit2.txt");
    await writeFile(testFile, "Hello, World!");

    const result = await edit.execute(
      {
        path: testFile,
        oldText: "NonExistent",
        newText: "Something",
      },
      {} as any,
    );

    expect(result.error).toBeTruthy();
    expect(result.error).toContain("Could not find text");
  });

  test("edit non-existent file", async () => {
    const result = await edit.execute(
      {
        path: join(testDir, "nonexistent.txt"),
        oldText: "old",
        newText: "new",
      },
      {} as any,
    );

    expect(result.error).toBeTruthy();
    expect(result.error).toContain("Failed to edit");
  });

  test("edit multiline content", async () => {
    const testFile = join(testDir, "multiline.txt");
    const original = "Line 1\nLine 2\nLine 3";
    await writeFile(testFile, original);

    const result = await edit.execute(
      {
        path: testFile,
        oldText: "Line 2",
        newText: "Modified Line",
      },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("Line 1\nModified Line\nLine 3");
  });

  test("edit large diff (>5k characters)", async () => {
    const testFile = join(testDir, "large-diff.txt");

    // Generate a 10k character file with repeating pattern
    const linePattern =
      "This is a line of text that will be repeated many times to create a large file.\n";
    const repeatCount = Math.ceil(10000 / linePattern.length);
    const largeContent = linePattern.repeat(repeatCount);
    const targetLine =
      "This is a line of text that will be repeated many times to create a large file.";
    const replacementLine = "THIS LINE HAS BEEN MODIFIED IN A LARGE FILE";

    await writeFile(testFile, largeContent);

    const result = await edit.execute(
      {
        path: testFile,
        oldText: targetLine,
        newText: replacementLine,
      },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toContain(replacementLine);
    expect(content.length).toBeGreaterThan(5000);
  });

  test("edit very large streaming patch (>20k characters)", async () => {
    const testFile = join(testDir, "very-large.txt");

    // Create a realistic code-like structure
    const generateFunction = (index: number) => `
function processData${index}(input: string): string {
  // Process the input data
  const result = input.trim().toLowerCase();
  if (result.length === 0) {
    return "empty";
  }
  return result;
}
`;

    const functions = Array.from({ length: 100 }, (_, i) =>
      generateFunction(i),
    ).join("\n");
    await writeFile(testFile, functions);

    // Replace a function in the middle
    const oldFunc = generateFunction(50);
    const newFunc = `
function processData50(input: string): string {
  // ENHANCED: Process with validation
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Input cannot be empty");
  }
  return trimmed.toLowerCase();
}
`;

    const result = await edit.execute(
      {
        path: testFile,
        oldText: oldFunc,
        newText: newFunc,
      },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("ENHANCED: Process with validation");
    expect(content).toContain("throw new Error");
    expect(content.length).toBeGreaterThan(15000);
  });
});
