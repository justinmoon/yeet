/**
 * API server for executing agent workflows
 * Provides SSE endpoint for real-time state updates
 */

import { file } from "bun";

const PORT = 3457; // Different port from vite dev server

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // SSE endpoint for executing workflows
    if (url.pathname === "/api/execute") {
      const task = url.searchParams.get("task");
      if (!task) {
        return new Response("Missing task parameter", { status: 400 });
      }

      // Set up SSE headers
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          const send = (data: any) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          };

          try {
            // Import agent machine and run workflow
            const { agentMachine } = await import("../src/agent-machine.ts");
            const { createActor } = await import("xstate");

            console.log(
              `[API] Starting execution for task: ${task.substring(0, 50)}...`,
            );

            send({ type: "started", task });

            // Create actor with proper input
            const actor = createActor(agentMachine, {
              input: {
                workingDirectory: process.cwd(),
                maxSteps: 50,
              },
            });

            // Track completion
            let completed = false;

            // Subscribe to state changes and handle completion
            const subscription = actor.subscribe((state) => {
              if (completed) return;

              // Handle nested states - extract the deepest state name
              const stateValue = state.value;
              const currentState =
                typeof stateValue === "object"
                  ? Object.keys(stateValue)[0] +
                    "." +
                    (stateValue as any)[Object.keys(stateValue)[0]]
                  : String(stateValue);

              console.log(`[API] State transition: ${currentState}`);

              try {
                send({
                  type: "state",
                  state: currentState,
                  context: {
                    step: state.context.currentStep,
                    maxSteps: state.context.maxSteps,
                  },
                });

                // Send tool call info when in executingTool state
                if (
                  state.matches({ running: "executingTool" }) &&
                  state.context.pendingToolCall
                ) {
                  send({
                    type: "tool",
                    tool: state.context.pendingToolCall.name,
                    args: JSON.stringify(
                      state.context.pendingToolCall.args,
                    ).substring(0, 100),
                  });
                }

                // Check for completion
                if (state.matches("idle") && state.context.currentStep > 0) {
                  completed = true;
                  console.log("[API] Execution complete");
                  send({ type: "done" });
                  subscription.unsubscribe(); // Unsubscribe first
                  actor.stop();
                  controller.close();
                } else if (state.matches("error")) {
                  completed = true;
                  console.log("[API] Execution failed");
                  send({ type: "error", error: "Agent encountered an error" });
                  subscription.unsubscribe(); // Unsubscribe first
                  actor.stop();
                  controller.close();
                }
              } catch (err) {
                console.error("[API] Error sending state:", err);
                if (!completed) {
                  completed = true;
                  try {
                    subscription.unsubscribe();
                  } catch (e) {}
                  actor.stop();
                  try {
                    controller.close();
                  } catch (e) {}
                }
              }
            });

            // Start the actor
            actor.start();
            console.log("[API] Actor started");

            // Send initial user message
            console.log("[API] Sending USER_MESSAGE event");
            actor.send({ type: "USER_MESSAGE", content: task });
          } catch (error: any) {
            send({ type: "error", error: error.message || String(error) });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 API server running at http://localhost:${PORT}`);
console.log(
  `   SSE endpoint: http://localhost:${PORT}/api/execute?task=<task>`,
);
