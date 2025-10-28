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

            // Create actor - agentMachine already has initial context
            const actor = createActor(agentMachine);

            // Subscribe to state changes
            actor.subscribe((state) => {
              console.log(`[API] State transition: ${String(state.value)}`);
              send({
                type: "state",
                state: String(state.value),
                context: {
                  step: state.context.currentStep,
                  maxSteps: state.context.maxSteps,
                },
              });

              // Send tool call info when in executingTool state
              if (
                state.matches("executingTool") &&
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
            });

            // Start the actor
            actor.start();
            console.log("[API] Actor started");

            // Send initial user message
            console.log("[API] Sending USER_MESSAGE event");
            actor.send({ type: "USER_MESSAGE", content: task });

            // Wait for completion or error
            await new Promise<void>((resolve) => {
              const checkDone = () => {
                const snapshot = actor.getSnapshot();
                if (
                  snapshot.matches("idle") &&
                  snapshot.context.currentStep > 0
                ) {
                  send({ type: "done" });
                  resolve();
                } else if (snapshot.matches("error")) {
                  send({ type: "error", error: "Agent encountered an error" });
                  resolve();
                } else {
                  setTimeout(checkDone, 100);
                }
              };
              checkDone();
            });

            controller.close();
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
