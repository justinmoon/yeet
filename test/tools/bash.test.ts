// @ts-nocheck - AI SDK v5 types are complex, but runtime works correctly
import { describe, expect, test } from "bun:test";
import { bash } from "../../src/tools/bash";

describe("tool.bash", () => {
  test("basic command execution", async () => {
    const result = await bash.execute({ command: "echo 'test'" }, {} as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test");
  });

  test("command with error", async () => {
    const result = await bash.execute(
      { command: "ls /nonexistent" },
      {} as any,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBeTruthy();
  });

  test("command that outputs to stderr", async () => {
    const result = await bash.execute(
      { command: "echo 'error' >&2" },
      {} as any,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("error");
  });

  test("pwd command", async () => {
    const result = await bash.execute({ command: "pwd" }, {} as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  });
});
