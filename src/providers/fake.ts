import type { AgentEvent } from "../agent";
import { loadAgentFixture } from "../fixtures/agent-fixture";

export interface FakeProviderOptions {
  fixture?: string;
  delayMs?: number;
}

export async function* streamFakeProvider(
  options: FakeProviderOptions = {},
): AsyncGenerator<AgentEvent> {
  const fixture = options.fixture ?? "hello-world";
  const delay = options.delayMs ?? 0;

  for await (const event of loadAgentFixture(fixture)) {
    yield event;

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
