import { afterEach, beforeEach, expect, test } from "bun:test";
import { runAgent } from "../src/agent";
import { loadConfig } from "../src/config";

const ORIGINALS = {
  CI_AGENT_FIXTURES: process.env.CI_AGENT_FIXTURES,
  YEET_PROVIDER: process.env.YEET_PROVIDER,
  YEET_AGENT_FIXTURE: process.env.YEET_AGENT_FIXTURE,
};

beforeEach(() => {
  process.env.CI_AGENT_FIXTURES = "1";
  process.env.YEET_PROVIDER = "fake";
  process.env.YEET_AGENT_FIXTURE = "hello-world";
});

afterEach(() => {
  process.env.CI_AGENT_FIXTURES = ORIGINALS.CI_AGENT_FIXTURES;
  process.env.YEET_PROVIDER = ORIGINALS.YEET_PROVIDER;
  process.env.YEET_AGENT_FIXTURE = ORIGINALS.YEET_AGENT_FIXTURE;
});

test("runAgent streams fixture events when fake provider enabled", async () => {
  const config = await loadConfig();
  const events = [];
  for await (const event of runAgent(
    [{ role: "user" as const, content: "Fixture smoke prompt" }],
    config,
  )) {
    events.push(event);
  }

  expect(events.length).toBeGreaterThan(0);
  expect(events[0]?.type).toBe("text");
  expect(events.at(-1)).toMatchObject({
    type: "done",
    summary: "Completed deterministic smoke run.",
  });
});
