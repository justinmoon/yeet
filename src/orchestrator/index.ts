/**
 * Main orchestrator loop for LLM-based workflow execution
 */

import { type AgentEvent, type MessageContent, runAgent } from "../agent";
import type { Config } from "../config";
import { logger } from "../logger";
import { buildOrchestratorPrompt, buildWorkerPrompt } from "./prompts";
import { type Workflow, WorkflowState } from "./state";

export interface WorkflowResult {
  result: Record<string, any>;
  history: string[];
  finalSummary?: string;
  transitionCount: number;
}

interface Message {
  role: "user" | "assistant";
  content: MessageContent;
}

/**
 * Run a complete workflow from start to finish
 */
export async function runWorkflow(
  workflow: Workflow,
  initialMessage: string,
  config: Config,
): Promise<WorkflowResult> {
  const state = new WorkflowState(workflow);
  const history: string[] = [];
  let finalSummary: string | undefined;

  logger.info("Starting workflow", {
    workflow: workflow.name,
    initialStage: state.getCurrentStage().name,
  });

  console.log(`\n🔄 Starting workflow: ${workflow.name}`);
  console.log(`📍 Initial stage: ${state.getCurrentStage().name}`);

  while (!state.isWorkflowComplete()) {
    const stage = state.getCurrentStage();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📌 Stage: ${stage.name}`);
    console.log(`🎯 Goal: ${stage.goal}`);
    console.log(`${"=".repeat(60)}\n`);

    // Build orchestrator prompt
    const prompt = buildOrchestratorPrompt(state);

    // Create messages for orchestrator
    const messages: Message[] = [
      { role: "user", content: initialMessage },
      { role: "user", content: prompt },
    ];

    let stageResult: any = null;
    let shouldDelegate = false;
    let delegateArgs: any = null;

    // Run orchestrator agent
    for await (const event of runAgent(messages, config)) {
      if (event.type === "text" && event.content) {
        process.stdout.write(event.content);
      }

      if (event.type === "tool") {
        logger.debug("Tool called", { tool: event.name, args: event.args });
      }

      if (event.type === "tool-result") {
        const result = event.result;

        // Check if this is a delegation request
        if (result?.action === "delegate") {
          shouldDelegate = true;
          delegateArgs = result;
          console.log("\n\n🤝 [Orchestrator delegating to worker...]");
          break; // Stop orchestrator, run worker
        }

        // Check if this is a transition request
        if (result?.action === "transition") {
          console.log(`\n\n➡️  [Transition: ${result.from} → ${result.to}]`);
          console.log(`   Reason: ${result.reason}`);

          history.push(`${result.from} → ${result.to}: ${result.reason}`);

          try {
            state.transitionTo(result.to, result.reason, stageResult);
          } catch (error: any) {
            logger.error("Invalid transition", {
              error: error.message,
              from: result.from,
              to: result.to,
            });
            console.error(`\n❌ Error: ${error.message}`);
            throw error;
          }
          break; // Move to next stage
        }

        // Check if workflow is complete
        if (result?.action === "complete") {
          finalSummary = result.summary;
          console.log("\n\n✅ [Workflow complete!]");
          state.getState().isComplete = true;
          break;
        }
      }

      if (event.type === "error") {
        logger.error("Agent error", { error: event.error });
        console.error(`\n❌ Agent error: ${event.error}`);
        throw new Error(`Agent error: ${event.error}`);
      }
    }

    // If orchestrator requested delegation, run worker
    if (shouldDelegate && delegateArgs) {
      const workerResult = await runWorker(
        delegateArgs.worker_type,
        delegateArgs.instructions,
        stage,
        state.getState().stageResults,
        config,
      );

      stageResult = workerResult;
      console.log("\n✓ [Worker completed. Results returned to orchestrator.]");

      // Add worker results back to orchestrator's context
      messages.push({
        role: "assistant",
        content: `I delegated to ${delegateArgs.worker_type} worker.`,
      });
      messages.push({
        role: "user",
        content: `Worker (${delegateArgs.worker_type}) completed with results:\n${JSON.stringify(workerResult, null, 2)}`,
      });

      // Continue orchestrator loop to get transition decision
      // Run orchestrator again to process worker results and decide transition
      for await (const event of runAgent(messages, config)) {
        if (event.type === "text" && event.content) {
          process.stdout.write(event.content);
        }

        if (event.type === "tool-result") {
          const result = event.result;

          // Check for transition
          if (result?.action === "transition") {
            console.log(`\n\n➡️  [Transition: ${result.from} → ${result.to}]`);
            console.log(`   Reason: ${result.reason}`);

            history.push(`${result.from} → ${result.to}: ${result.reason}`);

            try {
              state.transitionTo(result.to, result.reason, stageResult);
            } catch (error: any) {
              logger.error("Invalid transition", { error: error.message });
              console.error(`\n❌ Error: ${error.message}`);
              throw error;
            }
            break;
          }

          // Check for completion
          if (result?.action === "complete") {
            finalSummary = result.summary;
            console.log("\n\n✅ [Workflow complete!]");
            state.getState().isComplete = true;
            break;
          }
        }
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ Workflow Complete");
  console.log(`${"=".repeat(60)}`);

  return {
    result: state.getState().stageResults,
    history,
    finalSummary,
    transitionCount: state.getTransitionCount(),
  };
}

/**
 * Run a worker agent for a specific stage
 */
async function runWorker(
  workerType: string,
  instructions: string,
  stage: any,
  previousResults: any,
  config: Config,
): Promise<any> {
  logger.info("Starting worker", { workerType, stage: stage.name });

  console.log(`\n👷 [Worker: ${workerType}]`);
  console.log(`   Task: ${instructions}`);
  console.log(`   Tools: ${stage.tools.join(", ")}\n`);

  const prompt = buildWorkerPrompt(
    workerType,
    instructions,
    stage.goal,
    stage.tools,
    previousResults,
  );

  const messages: Message[] = [{ role: "user", content: prompt }];

  let results: any = null;

  // Create a custom config with only the tools for this stage
  const workerConfig = {
    ...config,
    // Worker has access to stage-specific tools plus report_results
  };

  for await (const event of runAgent(messages, workerConfig)) {
    if (event.type === "text" && event.content) {
      process.stdout.write(event.content);
    }

    if (event.type === "tool-result") {
      const result = event.result;

      // Check if worker is reporting results
      if (result?.action === "report") {
        results = {
          findings: result.findings,
          recommendation: result.recommendation,
        };
        break;
      }
    }

    if (event.type === "done") {
      // Worker finished without explicit report_results
      if (!results) {
        results = {
          findings: "Worker completed task without explicit results",
          recommendation: undefined,
        };
      }
    }

    if (event.type === "error") {
      logger.error("Worker error", { error: event.error, workerType });
      throw new Error(`Worker error: ${event.error}`);
    }
  }

  return results || { findings: "Worker completed with no explicit results" };
}
