#!/usr/bin/env bun
import { Command } from "commander";
import ora from "ora";
import { normalizeRequest } from "./intent";
import { getGitDiff } from "./git-diff";
import { planSections } from "./section-planner";
import type { ExplainResult } from "./types";

const program = new Command();

program
  .name("yeet-explain")
  .description("Generate tutorial sections for a git diff")
  .requiredOption("-p, --prompt <text>", "Prompt describing what to explain")
  .requiredOption("-c, --cwd <path>", "Repository path")
  .requiredOption("-b, --base <ref>", "Base git ref")
  .requiredOption("-h, --head <ref>", "Head git ref")
  .option("--include <path>", "Optional path filter")
  .option("--json", "Output raw JSON", false);

program.action(async (options) => {
  const spinner = ora();
  try {
    const intent = normalizeRequest({
      prompt: options.prompt,
      cwd: options.cwd,
      base: options.base,
      head: options.head,
      includePath: options.include,
    });

    spinner.start("Fetching git diff");
    const diffs = await getGitDiff({
      cwd: intent.cwd,
      base: intent.base,
      head: intent.head,
      includePath: intent.includePath,
    });
    spinner.succeed(`Loaded ${diffs.length} diff hunks`);

    spinner.start("Planning tutorial");
    const sections = await planSections(intent, diffs);
    spinner.succeed(`Generated ${sections.length} sections`);

    const result: ExplainResult = {
      intent,
      diffs,
      sections,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\nTutorial for ${intent.base}..${intent.head} (${intent.cwd})`);
    for (const section of sections) {
      const diff = diffs.find((d) => d.id === section.diffId);
      console.log(`\n=== ${section.title} ===`);
      if (section.tags?.length) {
        console.log(`[tags] ${section.tags.join(", ")}`);
      }
      console.log(section.explanation);
      if (diff) {
        console.log(`\nDiff: ${diff.filePath}`);
        for (const line of diff.lines.slice(0, 20)) {
          const prefix =
            line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
          console.log(`${prefix}${line.content}`);
        }
        if (diff.lines.length > 20) {
          console.log("... (truncated)");
        }
      }
    }
  } catch (error: any) {
    spinner.fail(error.message || String(error));
    process.exitCode = 1;
  }
});

await program.parseAsync();
