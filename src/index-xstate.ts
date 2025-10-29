/**
 * XState-based agent entry point
 */

import { createActor } from "xstate";
import { agentMachine } from "./agent-machine";

async function main() {
  const workingDir = process.cwd();

  // Create agent actor
  const actor = createActor(agentMachine, {
    input: {
      workingDirectory: workingDir,
      maxSteps: 10,
      // Not using initialMessage, will send USER_MESSAGE event instead
    },
  });

  // Subscribe to state changes for debugging
  actor.subscribe((state) => {
    console.log("\n=== State Changed ===");
    console.log("Current state:", state.value);
    console.log("Context:", {
      step: state.context.currentStep,
      snapshot: state.context.currentSnapshot.treeHash.substring(0, 8),
      response: state.context.currentResponse.substring(0, 50),
    });
  });

  // Start the machine
  actor.start();

  // Send a test message
  actor.send({
    type: "USER_MESSAGE",
    content: "Write a fizzbuzz.ts file that prints fizzbuzz from 1 to 100",
  });

  // Wait for completion
  await new Promise((resolve) => {
    const checkDone = setInterval(() => {
      if (actor.getSnapshot().value === "idle") {
        clearInterval(checkDone);
        resolve(null);
      }
    }, 100);
  });

  console.log("\n=== Final State ===");
  console.log("Messages:", actor.getSnapshot().context.messages);
  console.log("Tool history:", actor.getSnapshot().context.toolHistory);
  console.log(
    "Snapshots:",
    actor.getSnapshot().context.snapshotHistory.map((s) => s.treeHash),
  );

  actor.stop();
}

main().catch(console.error);
