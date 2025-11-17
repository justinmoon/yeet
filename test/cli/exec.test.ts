import { expect, test } from "bun:test";

async function runExec(args: string[]) {
  const proc = Bun.spawn(["bun", "run", "src/index.ts", "exec", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CI_AGENT_FIXTURES: "1",
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout!).text(),
    new Response(proc.stderr!).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test("yeet exec emits deterministic fixture events as JSON", async () => {
  const result = await runExec(["--fixture", "hello-world", "--json", "smoke"]);
  expect(result.exitCode).toBe(0);

  const lines = result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  expect(lines.length).toBeGreaterThan(0);

  const events = lines.map((line) => JSON.parse(line));
  expect(events[0]).toMatchObject({
    type: "text",
  });
  expect(events.at(-1)).toMatchObject({
    type: "done",
    summary: "Completed deterministic smoke run.",
  });
});

test("yeet exec fixture emits human friendly output", async () => {
  const result = await runExec(["--fixture", "hello-world", "demo"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("🤖 Starting Yeet CLI smoke run");
  expect(result.stdout).toContain("Yeet is alive!");
  expect(result.stdout).toContain("Deterministic run complete");
});
