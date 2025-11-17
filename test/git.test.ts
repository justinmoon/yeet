import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ensureGitRepo,
  getGitDiff,
  resolveDefaultBaseRef,
} from "../src/explain/git-diff";

const execAsync = promisify(exec);

let testRepoDir: string;

beforeEach(async () => {
  testRepoDir = await mkdtemp(join(tmpdir(), "yeet-git-test-"));
});

afterEach(async () => {
  await rm(testRepoDir, { recursive: true, force: true });
});

describe("Git integration", () => {
  test("detect non-git directory", async () => {
    await expect(ensureGitRepo(testRepoDir)).rejects.toThrow(
      "not a git repository",
    );
  });

  test("handle empty repository gracefully", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Empty repo should have .git directory
    await ensureGitRepo(testRepoDir);
    // If we reach here, it passed - no exception
    expect(true).toBe(true);
  });

  test("get diff from simple commit", async () => {
    // Initialize repo
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create initial commit
    await writeFile(join(testRepoDir, "file1.txt"), "Initial content");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial commit'", { cwd: testRepoDir });

    // Create second commit with changes
    await writeFile(join(testRepoDir, "file1.txt"), "Modified content");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Update file1'", { cwd: testRepoDir });

    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~1",
      head: "HEAD",
    });

    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0].filePath).toContain("file1.txt");
  });

  test("handle repository with unstaged changes", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create initial commit
    await writeFile(join(testRepoDir, "file1.txt"), "Initial");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Create unstaged changes
    await writeFile(join(testRepoDir, "file1.txt"), "Unstaged changes");

    // Getting diff between commits should still work
    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD",
      head: "HEAD",
    });

    // No diff between HEAD and HEAD
    expect(diffs.length).toBe(0);
  });

  test("resolve default base ref in repo with master", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create master branch
    await writeFile(join(testRepoDir, "file1.txt"), "Initial");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Should resolve to a valid ref
    const baseRef = await resolveDefaultBaseRef(testRepoDir);
    expect(baseRef).toBeDefined();
    expect(typeof baseRef).toBe("string");
  });

  test("diff with path filter", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create directories first
    await execAsync(`mkdir -p ${join(testRepoDir, "src")}`, {
      cwd: testRepoDir,
    });
    await execAsync(`mkdir -p ${join(testRepoDir, "docs")}`, {
      cwd: testRepoDir,
    });

    // Create initial commit with multiple files
    await writeFile(join(testRepoDir, "src", "file1.ts"), "code1");
    await writeFile(join(testRepoDir, "docs", "readme.md"), "docs");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Modify both files
    await writeFile(join(testRepoDir, "src", "file1.ts"), "code1 modified");
    await writeFile(join(testRepoDir, "docs", "readme.md"), "docs modified");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Update both'", { cwd: testRepoDir });

    // Get diff for only src directory
    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~1",
      head: "HEAD",
      includePath: "src",
    });

    expect(diffs.length).toBeGreaterThan(0);
    // All diffs should be from src directory
    for (const diff of diffs) {
      expect(diff.filePath).toMatch(/src/);
    }
  });

  test("handle multiple commits with complex history", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create a chain of commits
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(testRepoDir, `file${i}.txt`), `Content ${i}`);
      await execAsync("git add .", { cwd: testRepoDir });
      await execAsync(`git commit -m 'Commit ${i}'`, { cwd: testRepoDir });
    }

    // Get diff across multiple commits
    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~4",
      head: "HEAD",
    });

    expect(diffs.length).toBeGreaterThan(0);
    // Should include changes from multiple commits (may be 4 or 5 depending on git diff behavior)
    expect(diffs.length).toBeGreaterThanOrEqual(4);
  });

  test("respect max files limit", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create initial commit
    await writeFile(join(testRepoDir, "initial.txt"), "init");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Create many files
    for (let i = 1; i <= 60; i++) {
      await writeFile(join(testRepoDir, `file${i}.txt`), `Content ${i}`);
    }
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Add many files'", { cwd: testRepoDir });

    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~1",
      head: "HEAD",
      maxFiles: 50, // Default limit
    });

    // Should respect max files limit
    expect(diffs.length).toBeLessThanOrEqual(50);
  });

  test("parse diff with context lines", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create a file with multiple lines
    const initialContent = Array.from(
      { length: 20 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");
    await writeFile(join(testRepoDir, "multiline.txt"), initialContent);
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Modify a line in the middle
    const modifiedContent = initialContent.replace(
      "Line 10",
      "Line 10 MODIFIED",
    );
    await writeFile(join(testRepoDir, "multiline.txt"), modifiedContent);
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Modify line 10'", { cwd: testRepoDir });

    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~1",
      head: "HEAD",
      contextLines: 5, // Should include 5 lines of context
    });

    expect(diffs.length).toBeGreaterThan(0);
    const firstDiff = diffs[0];
    expect(firstDiff.lines.length).toBeGreaterThan(1); // Should have context lines
  });

  test("handle binary files gracefully", async () => {
    await execAsync("git init", { cwd: testRepoDir });
    await execAsync("git config user.email 'test@example.com'", {
      cwd: testRepoDir,
    });
    await execAsync("git config user.name 'Test User'", { cwd: testRepoDir });

    // Create initial commit
    await writeFile(join(testRepoDir, "text.txt"), "text");
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Initial'", { cwd: testRepoDir });

    // Add a binary file
    const binaryData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await writeFile(join(testRepoDir, "image.bin"), binaryData);
    await execAsync("git add .", { cwd: testRepoDir });
    await execAsync("git commit -m 'Add binary'", { cwd: testRepoDir });

    // Should handle binary files without crashing
    const diffs = await getGitDiff({
      cwd: testRepoDir,
      base: "HEAD~1",
      head: "HEAD",
    });

    // Git might show binary files differently
    expect(diffs).toBeDefined();
  });
});
