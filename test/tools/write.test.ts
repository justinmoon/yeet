// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, readFile, rm } from "fs/promises";
import { write } from "../../src/tools/write";

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "yeet-test-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("tool.write", () => {
  test("write new file", async () => {
    const testFile = join(testDir, "new.txt");
    const result = await write.execute(
      {
        path: testFile,
        content: "New content",
      },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("New content");
  });

  test("overwrite existing file", async () => {
    const testFile = join(testDir, "overwrite.txt");

    await write.execute({ path: testFile, content: "First" }, {} as any);
    const result = await write.execute(
      { path: testFile, content: "Second" },
      {} as any,
    );

    expect(result.success).toBe(true);
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("Second");
  });

  test("write multiline content", async () => {
    const testFile = join(testDir, "multiline.txt");
    const content = "Line 1\nLine 2\nLine 3";

    const result = await write.execute({ path: testFile, content }, {} as any);

    expect(result.success).toBe(true);
    const readContent = await readFile(testFile, "utf-8");
    expect(readContent).toBe(content);
  });

  test("write unicode content", async () => {
    const testFile = join(testDir, "unicode.txt");
    const content = "Hello 世界 🌍";

    const result = await write.execute({ path: testFile, content }, {} as any);

    expect(result.success).toBe(true);
    const readContent = await readFile(testFile, "utf-8");
    expect(readContent).toBe(content);
  });

  test("write extended unicode characters", async () => {
    const testFile = join(testDir, "extended-unicode.txt");
    const content =
      "Arabic: مرحبا\nCyrillic: Привет\nEmoji: 🎉🚀💻\nMath: ∑∫∂∇\nCJK: 日本語 中文 한국어";

    const result = await write.execute({ path: testFile, content }, {} as any);

    expect(result.success).toBe(true);
    const readContent = await readFile(testFile, "utf-8");
    expect(readContent).toBe(content);
    expect(readContent).toContain("مرحبا");
    expect(readContent).toContain("Привет");
    expect(readContent).toContain("🎉🚀💻");
    expect(readContent).toContain("∑∫∂∇");
    expect(readContent).toContain("日本語");
  });

  test("write large file (>50k characters)", async () => {
    const testFile = join(testDir, "large-write.txt");
    const line = "This is a line of text for a large file write test.\n";
    const content = line.repeat(1000); // ~50k characters

    const result = await write.execute({ path: testFile, content }, {} as any);

    expect(result.success).toBe(true);
    const readContent = await readFile(testFile, "utf-8");
    expect(readContent.length).toBeGreaterThan(50000);
    expect(readContent).toBe(content);
  });

  test("write empty file", async () => {
    const testFile = join(testDir, "empty.txt");
    const result = await write.execute(
      { path: testFile, content: "" },
      {} as any,
    );

    expect(result.success).toBe(true);
    const readContent = await readFile(testFile, "utf-8");
    expect(readContent).toBe("");
  });
});
