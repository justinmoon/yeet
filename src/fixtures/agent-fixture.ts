import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import type { AgentEvent } from "../agent";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/agent",
);

export async function* loadAgentFixture(
  fixtureName: string,
): AsyncGenerator<AgentEvent> {
  const fixturePath = path.join(FIXTURE_DIR, `${fixtureName}.jsonl`);
  const content = await fs.readFile(fixturePath, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    yield JSON.parse(line) as AgentEvent;
  }
}
