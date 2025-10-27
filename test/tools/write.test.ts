// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { write } from "../../src/tools/write"
import { mkdtemp, rm, readFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

let testDir: string

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "yeet-test-"))
})

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe("tool.write", () => {
  test("write new file", async () => {
    const testFile = join(testDir, "new.txt")
    const result = await write.execute(
      {
        path: testFile,
        content: "New content",
      },
      {} as any
    )

    expect(result.success).toBe(true)
    const content = await readFile(testFile, "utf-8")
    expect(content).toBe("New content")
  })

  test("overwrite existing file", async () => {
    const testFile = join(testDir, "overwrite.txt")

    await write.execute({ path: testFile, content: "First" }, {} as any)
    const result = await write.execute({ path: testFile, content: "Second" }, {} as any)

    expect(result.success).toBe(true)
    const content = await readFile(testFile, "utf-8")
    expect(content).toBe("Second")
  })

  test("write multiline content", async () => {
    const testFile = join(testDir, "multiline.txt")
    const content = "Line 1\nLine 2\nLine 3"

    const result = await write.execute({ path: testFile, content }, {} as any)

    expect(result.success).toBe(true)
    const readContent = await readFile(testFile, "utf-8")
    expect(readContent).toBe(content)
  })

  test("write unicode content", async () => {
    const testFile = join(testDir, "unicode.txt")
    const content = "Hello 世界 🌍"

    const result = await write.execute({ path: testFile, content }, {} as any)

    expect(result.success).toBe(true)
    const readContent = await readFile(testFile, "utf-8")
    expect(readContent).toBe(content)
  })
})
