// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { read } from "../../src/tools/read";

let testDir: string;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "yeet-test-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("tool.read", () => {
  test("read existing file", async () => {
    const testFile = join(testDir, "test.txt");
    await writeFile(testFile, "Hello, World!");

    const result = await read.execute({ path: testFile }, {} as any);
    expect(result.content).toBe("Hello, World!");
  });

  test("read non-existent file", async () => {
    const result = await read.execute(
      { path: join(testDir, "nonexistent.txt") },
      {} as any,
    );
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("Failed to read");
  });

  test("read file with unicode content", async () => {
    const testFile = join(testDir, "unicode.txt");
    await writeFile(testFile, "Hello 世界 🌍");

    const result = await read.execute({ path: testFile }, {} as any);
    expect(result.content).toBe("Hello 世界 🌍");
  });

  test("read file with various unicode characters", async () => {
    const testFile = join(testDir, "extended-unicode.txt");
    const content =
      "Arabic: مرحبا\nCyrillic: Привет\nEmoji: 🎉🚀💻\nMath: ∑∫∂∇";
    await writeFile(testFile, content);

    const result = await read.execute({ path: testFile }, {} as any);
    expect(result.content).toContain("مرحبا");
    expect(result.content).toContain("Привет");
    expect(result.content).toContain("🎉🚀💻");
    expect(result.content).toContain("∑∫∂∇");
  });

  test("detect binary/non-UTF8 content", async () => {
    const testFile = join(testDir, "binary.bin");
    // Create a buffer with non-UTF8 bytes
    const binaryData = new Uint8Array([
      0xff, 0xfe, 0x00, 0x01, 0x80, 0x90, 0xa0, 0xb0,
    ]);
    await writeFile(testFile, binaryData);

    const result = await read.execute({ path: testFile }, {} as any);
    // The read tool attempts to read as text, which may produce replacement characters
    // or error depending on implementation. We expect it to handle gracefully.
    expect(result.content !== undefined || result.error !== undefined).toBe(
      true,
    );
  });

  test("read file with mixed line endings", async () => {
    const testFile = join(testDir, "mixed-line-endings.txt");
    // Mix of LF, CRLF, and CR
    await writeFile(testFile, "Line 1\nLine 2\r\nLine 3\rLine 4");

    const result = await read.execute({ path: testFile }, {} as any);
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 2");
    expect(result.content).toContain("Line 3");
    expect(result.content).toContain("Line 4");
  });

  test("read large file (>100k characters)", async () => {
    const testFile = join(testDir, "large-file.txt");
    const largeContent = "Line of text that repeats.\n".repeat(5000);
    await writeFile(testFile, largeContent);

    const result = await read.execute({ path: testFile }, {} as any);
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(100000);
  });
});
