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
});
