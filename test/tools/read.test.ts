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
});
