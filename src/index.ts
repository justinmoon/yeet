#!/usr/bin/env bun
import "../solid-preload";
import { loadConfig } from "./config";
import { logger } from "./logger";
import { createTUISolidAdapter } from "./ui/tui-solid-adapter";

const args = process.argv.slice(2);

// Check for explain subcommand
if (args[0] === "explain") {
  // Import and run explain CLI
  const { Command } = await import("commander");
  const ora = (await import("ora")).default;
  const { getGitDiff } = await import("./explain/git-diff");
  const { createStubExplainResult } = await import("./explain/index");
  const { normalizeRequest } = await import("./explain/intent");
  const { planSections } = await import("./explain/section-planner");
  const { inferGitParams } = await import("./explain/infer-params");

  const program = new Command();

  // Remove "explain" from args and pass remaining args to commander
  process.argv = process.argv.slice(0, 2).concat(args.slice(1));

  program
    .name("yeet explain")
    .description("Generate tutorial sections for a git diff")
    .requiredOption("-p, --prompt <text>", "Prompt describing what to explain")
    .option("-c, --cwd <path>", "Repository path (defaults to current directory)")
    .option("-b, --base <ref>", "Base git ref (defaults to main/master)")
    .option("-h, --head <ref>", "Head git ref (defaults to HEAD)")
    .option("--include <path>", "Optional path filter")
    .option("--json", "Output raw JSON", false)
    .option("--stub", "Use stub tutorial content", false);

  program.action(async (options) => {
    const spinner = ora();
    const useStub =
      Boolean(options.stub) || process.env.YEET_EXPLAIN_STUB === "1";

    try {
      // Infer missing git parameters
      const inferredParams = await inferGitParams({
        prompt: options.prompt,
        cwd: options.cwd,
        base: options.base,
        head: options.head,
      });

      const intent = normalizeRequest({
        prompt: options.prompt,
        cwd: inferredParams.cwd,
        base: inferredParams.base,
        head: inferredParams.head,
        includePath: options.include,
      });

      let result: any;

      if (useStub) {
        spinner.start("Preparing stub tutorial");
        result = createStubExplainResult(intent);
        spinner.succeed(`Prepared ${result.sections.length} stub section(s)`);
      } else {
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

        result = {
          intent,
          diffs,
          sections,
        };
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`
Tutorial for ${result.intent.base}..${result.intent.head} (${result.intent.cwd})`);
      for (const section of result.sections) {
        const diff = result.diffs.find((d: any) => d.id === section.diffId);
        console.log(`
=== ${section.title} ===`);
        if (section.tags?.length) {
          console.log(`[tags] ${section.tags.join(", ")}`);
        }
        console.log(section.explanation);
        if (diff) {
          console.log(`
Diff: ${diff.filePath}`);
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
      if (error.stack) {
        console.error(error.stack);
      }
      if (error.cause) {
        console.error("Cause:", error.cause);
      }
      process.exitCode = 1;
    }
  });

  await program.parseAsync();
} else if (args.includes("--orchestrate") || args.includes("orchestrate")) {
  // Remove the orchestrate flag/command
  const orchestrateArgs = args.filter(
    (arg) => arg !== "--orchestrate" && arg !== "orchestrate",
  );

  // Import and run orchestrator CLI
  const { runOrchestratorCLI } = await import("./orchestrator/cli");
  await runOrchestratorCLI(orchestrateArgs);
} else {
  // Run normal TUI
  try {
    logger.info("Yeet TUI starting");

    const config = await loadConfig();
    logger.info("Config loaded", { activeProvider: config.activeProvider });

    const ui = await createTUISolidAdapter(config);

    // Keep process alive
    process.on("SIGINT", async () => {
      await ui.stop();
      await logger.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error("Failed to start yeet TUI", {
      error: error.message,
      stack: error.stack,
    });
    console.error(`Failed to start yeet TUI: ${error.message}`);
    await logger.close();
    process.exit(1);
  }
}
