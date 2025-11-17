#!/usr/bin/env bun
import { streamFakeProvider } from "../src/providers/fake";

const port = Number(process.env.FAKE_PROVIDER_PORT || 4783);

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/api/execute") {
      const fixture =
        url.searchParams.get("fixture") ||
        process.env.YEET_AGENT_FIXTURE ||
        "hello-world";

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const event of streamFakeProvider({ fixture })) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            }
            controller.close();
          } catch (error) {
            controller.error(error);
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

console.log(
  `[fake-provider] listening on http://localhost:${server.port} (fixture=${
    process.env.YEET_AGENT_FIXTURE || "hello-world"
  })`,
);

const shutdown = async () => {
  console.log("[fake-provider] shutting down");
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
