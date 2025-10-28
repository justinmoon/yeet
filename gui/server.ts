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

            // Create actor
            const actor = createActor(agentMachine, {
              input: {
                currentSnapshot: { treeHash: "", timestamp: Date.now() },
                snapshotHistory: [],
                messages: [{ role: "user", content: task }],
                currentResponse: "",
                toolHistory: [],
                currentStep: 0,
                maxSteps: 10,
                workingDirectory: process.cwd(),
              },
            });

            // Subscribe to state changes
            actor.subscribe((state) => {
              send({
                type: "state",
                state: state.value,
                context: {
                  step: state.context.currentStep,
                  maxSteps: state.context.maxSteps,
                },
              });
            });

            // Start the actor
            actor.start();

            // Send initial user message
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
