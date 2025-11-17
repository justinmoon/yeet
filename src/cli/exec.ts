#!/usr/bin/env bun
import { Command } from "commander";
import type { AgentEvent } from "../agent";
import { runAgent } from "../agent";
import { loadConfig } from "../config";
import { loadAgentFixture } from "../fixtures/agent-fixture";

interface ExecOptions {
  json: boolean;
  fixture?: string;
  maxSteps?: string;
}

async function streamLiveEvents(
  prompt: string,
  options: ExecOptions,
  emit: (event: AgentEvent) => Promise<void>,
): Promise<void> {
  const config = await loadConfig();
  const messages = [{ role: "user" as const, content: prompt }];
  const maxSteps = options.maxSteps ? Number(options.maxSteps) : undefined;

  for await (const event of runAgent(messages, config, undefined, maxSteps)) {
    await emit(event);
  }
}

async function runWithOptions(prompt: string, options: ExecOptions) {
  const useFixtures =
    Boolean(options.fixture) || process.env.CI_AGENT_FIXTURES === "1";
  const fixtureName = options.fixture || "hello-world";
  const emit = async (event: AgentEvent) => {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }

    switch (event.type) {
      case "text":
        process.stdout.write(event.content || "");
        break;
      case "tool":
        console.log(`🔧 Tool: ${event.name} ${JSON.stringify(event.args)}`);
        break;
      case "tool-result":
        console.log(`✅ Tool result: ${JSON.stringify(event.result)}`);
        break;
      case "done": {
        const summary =
          event.result?.summary ||
          event.content ||
          "Deterministic run complete.";
        console.log(`\n✅ ${summary}`);
        break;
      }
      case "error":
        console.error(`❌ Error: ${event.error}`);
        process.exitCode = 1;
        break;
    }
  };

  if (useFixtures) {
    for await (const event of loadAgentFixture(fixtureName)) {
      await emit(event);
    }
  } else {
    await streamLiveEvents(prompt, options, emit);
  }
}

export async function runExecCLI(argv: string[]) {
  const program = new Command();
  program
    .name("yeet exec")
    .argument("[prompt...]", "Task prompt", [])
    .option("-j, --json", "Emit JSON event stream", false)
    .option("-f, --fixture <name>", "Use a deterministic fixture stream")
    .option("--max-steps <n>", "Override max step budget");

  program.action(async (promptWords: string[], opts: ExecOptions) => {
    const prompt = promptWords.join(" ").trim() || "Hello world";
    await runWithOptions(prompt, opts);
  });

  await program.parseAsync(["node", "yeet-exec", ...argv]);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  runExecCLI(args).catch((error) => {
    console.error("yeet exec failed:", error);
    process.exit(1);
  });
}
