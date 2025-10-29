/**
 * Concurrent workflow runner
 * 
 * Actually executes parallel workflows
 */

import type { ParallelWorkflow } from "./concurrent";
import { ConcurrentOrchestrator } from "./concurrent";
import { buildWorkerPrompt } from "./prompts";
import { runAgent } from "../agent";
import type { Config } from "../config";

export interface ConcurrentWorkflowResult {
  completedStages: Set<string>;
  stageResults: Record<string, any>;
  stageTiming: Record<string, { start: number; end?: number }>;
  totalTime: number;
  history: Array<{
    type: "start" | "complete" | "transition";
    stage: string;
    timestamp: number;
    reason?: string;
  }>;
}

/**
 * Run a workflow with parallel stage execution
 */
export async function runParallelWorkflow(
  workflow: ParallelWorkflow,
  task: string,
  config: Config,
): Promise<ConcurrentWorkflowResult> {
  const orchestrator = new ConcurrentOrchestrator(workflow);
  const startTime = Date.now();

  console.log(`\n🚀 Starting parallel workflow: ${workflow.name}`);
  console.log(`📝 Task: ${task}\n`);

  // Track running stage promises
  const runningStages = new Map<string, Promise<any>>();

  while (!orchestrator.isComplete()) {
    // Visualize current state
    console.log(orchestrator.visualizeState());

    // Get stages that can run now
    const runnableStages = orchestrator.getRunnableStages();

    // Start all runnable stages
    for (const stageName of runnableStages) {
      console.log(`\n▶️  Starting stage: ${stageName}`);
      orchestrator.startStage(stageName);

      // Launch stage execution (non-blocking)
      const promise = executeStage(
        workflow,
        stageName,
        task,
        orchestrator.getState().stageResults,
        config,
      );

      runningStages.set(stageName, promise);
    }

    // Wait for at least one stage to complete
    if (runningStages.size > 0) {
      const completed = await Promise.race(
        Array.from(runningStages.entries()).map(
          async ([name, promise]) => {
            const result = await promise;
            return { name, result };
          },
        ),
      );

      console.log(`\n✓ Stage completed: ${completed.name}`);

      // Remove from running
      runningStages.delete(completed.name);

      // Mark as complete and get next stages
      const nextStages = orchestrator.completeStage(
        completed.name,
        completed.result,
      );

      console.log(
        `   Next stages: ${nextStages.length > 0 ? nextStages.join(", ") : "none"}`,
      );
    }

    // Small delay to avoid tight loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const totalTime = Date.now() - startTime;

  console.log("\n✅ Workflow complete!");
  console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s\n`);

  // Show timing analysis
  console.log("Timing Analysis:");
  const state = orchestrator.getState();
  Object.entries(state.stageTiming).forEach(([stage, timing]) => {
    const duration = timing.end && timing.start ? timing.end - timing.start : 0;
    console.log(`  ${stage}: ${(duration / 1000).toFixed(1)}s`);
  });

  // Calculate potential speedup
  const sequentialTime = Object.values(state.stageTiming).reduce(
    (sum, t) => sum + (t.end && t.start ? t.end - t.start : 0),
    0,
  );
  const speedup = sequentialTime / totalTime;
  console.log(
    `\n📊 Speedup: ${speedup.toFixed(2)}x (sequential would take ${(sequentialTime / 1000).toFixed(1)}s)`,
  );

  return {
    completedStages: state.completedStages,
    stageResults: state.stageResults,
    stageTiming: state.stageTiming,
    totalTime,
    history: state.history,
  };
}

/**
 * Execute a single stage (worker agent)
 */
async function executeStage(
  workflow: ParallelWorkflow,
  stageName: string,
  task: string,
  previousResults: Record<string, any>,
  config: Config,
): Promise<any> {
  const stage = workflow.stages[stageName];

  // Build prompt for this stage
  const prompt = buildWorkerPrompt(
    stageName,
    `${task}\n\nFocus on: ${stage.goal}`,
    stage.goal,
    stage.tools,
    previousResults,
  );

  const messages = [{ role: "user" as const, content: prompt }];

  let results: any = null;

  // Run worker agent
  for await (const event of runAgent(messages, config)) {
    if (event.type === "text") {
      // Could stream to separate output per stage
      // For now, just accumulate
    }

    if (event.type === "tool-result") {
      const result = event.result;

      if (result?.action === "report") {
        results = {
          findings: result.findings,
          recommendation: result.recommendation,
        };
        break;
      }
    }

    if (event.type === "done") {
      if (!results) {
        results = {
          findings: `Stage ${stageName} completed`,
          recommendation: undefined,
        };
      }
    }

    if (event.type === "error") {
      throw new Error(`Stage ${stageName} failed: ${event.error}`);
    }
  }

  return results || { findings: `Stage ${stageName} completed with no results` };
}
