#!/usr/bin/env bun
import { spawn } from "bun";
import { logger } from "./logger";

async function main() {
  try {
    logger.info("Yeet Web UI (streaming mode) starting");

    const port = Number(process.env.PORT) || 8765;

    const server = Bun.serve({
      port,
      async fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade
        if (url.pathname === "/ws") {
          const upgraded = server.upgrade(req);
          if (upgraded) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // Serve HTML page
        if (url.pathname === "/") {
          return new Response(getHTML(), {
            headers: { "Content-Type": "text/html" },
          });
        }

        return new Response("Not found", { status: 404 });
      },
      websocket: {
        async open(ws) {
          logger.info("WebSocket client connected, spawning TUI");

          // Spawn the TUI process
          const tuiProcess = spawn({
            cmd: ["bun", "run", "src/tui.ts"],
            cwd: process.cwd(),
            env: {
              ...process.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });

          // Store process on ws for cleanup
          (ws as any).tuiProcess = tuiProcess;

          // Forward stdout to WebSocket
          const readStdout = async () => {
            const reader = tuiProcess.stdout.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const text = new TextDecoder().decode(value);
                try {
                  ws.send(text);
                } catch (err) {
                  logger.error("Error sending output to WebSocket", {
                    error: err,
                  });
                  break;
                }
              }
            } catch (err) {
              logger.error("Error reading stdout", { error: err });
            } finally {
              reader.releaseLock();
            }
          };

          // Forward stderr to console
          const readStderr = async () => {
            const reader = tuiProcess.stderr.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = new TextDecoder().decode(value);
                console.error("TUI stderr:", text);
              }
            } catch (err) {
              // Ignore
            } finally {
              reader.releaseLock();
            }
          };

          // Start reading output
          readStdout();
          readStderr();

          // Wait for process to exit
          tuiProcess.exited.then((exitCode) => {
            logger.info("TUI process exited", { exitCode });
            try {
              ws.close();
            } catch (err) {
              // Already closed
            }
          });
        },
        message(ws, message) {
          const tuiProcess = (ws as any).tuiProcess;
          if (!tuiProcess || !tuiProcess.stdin) return;

          // Check if it's a control message (resize)
          try {
            const msg = JSON.parse(message as string);
            if (msg.type === "resize") {
              // Terminal resize not supported without PTY, ignore
              return;
            }
          } catch {
            // Not JSON, treat as terminal input
          }

          // Forward input to TUI stdin using Bun's write method
          try {
            tuiProcess.stdin.write(message as string);
          } catch (err) {
            logger.error("Error writing to TUI stdin", { error: err });
          }
        },
        close(ws) {
          logger.info("WebSocket client disconnected");
          const tuiProcess = (ws as any).tuiProcess;
          if (tuiProcess) {
            tuiProcess.kill();
          }
        },
      },
    });

    logger.info("Web server (PTY mode) started", { port });
    console.log(`\n🌐 Web UI available at http://localhost:${port}\n`);
    console.log("This runs the actual TUI in a terminal session.\n");

    // Keep the process running
    await new Promise(() => {});
  } catch (error: any) {
    logger.error("Failed to start yeet Web UI (PTY)", {
      error: error.message,
      stack: error.stack,
    });
    console.error(`Failed to start yeet Web UI (PTY): ${error.message}`);
    await logger.close();
    process.exit(1);
  }
}

function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yeet</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #000;
      color: #fff;
      height: 100vh;
      overflow: hidden;
      font-family: monospace;
    }
    #terminal {
      height: 100vh;
      width: 100vw;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script>
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000,
      allowProposedApi: true
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    // Handle window resize
    window.addEventListener('resize', () => {
      fitAddon.fit();
    });

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(\`\${protocol}//\${window.location.host}/ws\`);

    ws.onopen = () => {
      console.log('Connected to Yeet PTY');
      
      // Send terminal size
      ws.send(JSON.stringify({
        type: 'resize',
        cols: term.cols,
        rows: term.rows
      }));
    };

    ws.onmessage = (event) => {
      // Write PTY output directly to terminal
      term.write(event.data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      term.write('\\r\\n\\r\\n\\x1b[31m❌ Connection lost. Please refresh the page.\\x1b[0m\\r\\n');
    };

    // Forward terminal input to PTY
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols,
          rows
        }));
      }
    });
  </script>
</body>
</html>`;
}

main();
