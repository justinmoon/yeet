import type { MessageContent } from "../agent";
import { handleMapleSetup, handleOAuthCodeInput } from "../commands";
import type { Config } from "../config";
import { logger } from "../logger";
import { getActiveModel } from "../models/registry";
import { handleMessage, saveCurrentSession, updateTokenCount } from "./backend";
import type { UIAdapter } from "./interface";

interface WebSocketMessage {
  type: "input" | "command" | "paste-image";
  data: string;
  imageData?: { mimeType: string; data: string };
}

export class WebAdapter implements UIAdapter {
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }> = [];
  imageAttachments: Array<{ mimeType: string; data: string; name?: string }> =
    [];
  currentTokens = 0;
  currentSessionId: string | null = null;
  pendingMapleSetup?: { modelId: string };
  pendingOAuthSetup?: {
    verifier: string;
    provider?: "anthropic" | "openai";
    state?: string;
  };
  isGenerating = false;
  abortController: AbortController | null = null;

  private config: Config;
  private server?: any;
  private ws?: any;
  private port: number;

  constructor(config: Config, port = 8765) {
    this.config = config;
    this.port = port;
  }

  async start(): Promise<void> {
    const self = this;

    this.server = Bun.serve({
      port: this.port,
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
          return new Response(self.getHTML(), {
            headers: { "Content-Type": "text/html" },
          });
        }

        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          logger.info("WebSocket client connected");
          self.ws = ws;

          // Send initial status
          const { id: modelId, info: modelInfo } = getActiveModel(self.config);
          const modelDisplay = modelInfo
            ? `${modelInfo.name} (${self.config.activeProvider})`
            : modelId || "Unknown model";

          ws.send(
            JSON.stringify({
              type: "status",
              data: `${modelDisplay} | 0/${modelInfo?.contextWindow || "?"} (0%)`,
            }),
          );

          ws.send(
            JSON.stringify({
              type: "output",
              data: "Yeet web UI started. Type your message and press Enter.\n\n",
            }),
          );
        },
        async message(ws, message) {
          try {
            const msg: WebSocketMessage = JSON.parse(message as string);

            if (msg.type === "paste-image" && msg.imageData) {
              self.imageAttachments.push(msg.imageData);
              self.updateAttachmentIndicator();
              logger.info("Image pasted via web", {
                count: self.imageAttachments.length,
              });
              return;
            }

            if (msg.type === "input") {
              const text = msg.data.trim();
              if (!text) return;

              if (self.pendingOAuthSetup) {
                const { verifier } = self.pendingOAuthSetup;
                self.pendingOAuthSetup = undefined;
                await handleOAuthCodeInput(text, verifier, self, self.config);
              } else if (self.pendingMapleSetup) {
                const apiKey = text;
                const modelId = self.pendingMapleSetup.modelId;
                self.pendingMapleSetup = undefined;
                await handleMapleSetup(apiKey, modelId, self, self.config);
              } else {
                await handleMessage(text, self, self.config);
              }
            }
          } catch (error: any) {
            logger.error("WebSocket message error", { error: error.message });
          }
        },
        close() {
          logger.info("WebSocket client disconnected");
          self.ws = undefined;
        },
      },
    });

    logger.info("Web server started", { port: this.port });
    console.log(`\n🌐 Web UI available at http://localhost:${this.port}\n`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
  }

  onUserInput(_callback: (message: string) => Promise<void>): void {
    // Not needed for WebSocket-based implementation
  }

  onCommand(
    _callback: (command: string, args: string[]) => Promise<void>,
  ): void {
    // Not needed for WebSocket-based implementation
  }

  appendOutput(text: string): void {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "output", data: text }));
    }
  }

  addMessagePart(part: import("./interface").MessagePart): void {
    // Web adapter doesn't use message parts yet
    // Just append as text for now
    this.appendOutput(part.content);
  }

  clearOutput(): void {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "clear-output" }));
    }
  }

  setStatus(text: string): void {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "status", data: text }));
    }
  }

  clearInput(): void {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "clear-input" }));
    }
  }

  clearAttachments(): void {
    this.imageAttachments = [];
    this.updateAttachmentIndicator();
  }

  updateTokenCount(): void {
    updateTokenCount(this, this.config);
  }

  saveCurrentSession(): void {
    saveCurrentSession(this, this.config);
  }

  private updateAttachmentIndicator(): void {
    const { id: modelId, info: modelInfo } = getActiveModel(this.config);
    const modelName = modelInfo?.name || modelId || "Unknown model";
    const maxContext = modelInfo?.contextWindow || "?";

    if (this.imageAttachments.length > 0) {
      this.setStatus(
        `${modelName} | ${this.currentTokens > 0 ? `${this.currentTokens}/${maxContext}` : "0/?"} | 📎 ${this.imageAttachments.length} image(s)`,
      );
    } else {
      this.updateTokenCount();
    }
  }

  private getHTML(): string {
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
    }
    #terminal {
      height: 100vh;
      width: 100vw;
    }
    .xterm {
      height: 100%;
      padding: 0;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script>
    // Initialize xterm to match TUI appearance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#0000ff',
        black: '#000000',
        red: '#ff0000',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0000ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#808080',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#0000ff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff'
      },
      scrollback: 10000,
      convertEol: false,
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

    // WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(\`\${protocol}//\${window.location.host}/ws\`);

    let inputBuffer = '';
    let cursorPos = 0;

    ws.onopen = () => {
      console.log('Connected to Yeet');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'status') {
        // Status updates handled via ANSI codes in output
      } else if (msg.type === 'clear-input') {
        inputBuffer = '';
        cursorPos = 0;
      } else if (msg.type === 'clear-output') {
        term.clear();
      } else if (msg.type === 'render') {
        // Full TUI render from server
        term.write(msg.data);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      term.write('\\r\\n\\r\\n\\x1b[31m❌ Connection lost. Please refresh the page.\\x1b[0m\\r\\n');
    };

    // Handle keyboard input
    term.onKey(({ key, domEvent }) => {
      const ev = domEvent;
      const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

      if (ev.keyCode === 13) { // Enter
        if (ev.shiftKey) {
          // Shift+Enter - newline
          inputBuffer += '\\n';
          cursorPos++;
        } else {
          // Send message
          if (inputBuffer.trim()) {
            ws.send(JSON.stringify({ type: 'input', data: inputBuffer }));
            inputBuffer = '';
            cursorPos = 0;
          }
        }
      } else if (ev.keyCode === 8) { // Backspace
        if (cursorPos > 0) {
          inputBuffer = inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
          cursorPos--;
        }
      } else if (ev.keyCode === 46) { // Delete
        if (cursorPos < inputBuffer.length) {
          inputBuffer = inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
        }
      } else if (ev.keyCode === 37) { // Left arrow
        if (cursorPos > 0) cursorPos--;
      } else if (ev.keyCode === 39) { // Right arrow
        if (cursorPos < inputBuffer.length) cursorPos++;
      } else if (ev.keyCode === 86 && ev.ctrlKey) { // Ctrl+V
        // Image paste - trigger paste event
        navigator.clipboard.read().then(clipboardItems => {
          for (const item of clipboardItems) {
            for (const type of item.types) {
              if (type.startsWith('image/')) {
                item.getType(type).then(blob => {
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    ws.send(JSON.stringify({
                      type: 'paste-image',
                      imageData: {
                        mimeType: blob.type,
                        data: base64
                      }
                    }));
                  };
                  reader.readAsDataURL(blob);
                });
              }
            }
          }
        }).catch(err => {
          console.log('Clipboard access denied:', err);
        });
      } else if (printable) {
        inputBuffer = inputBuffer.slice(0, cursorPos) + key + inputBuffer.slice(cursorPos);
        cursorPos++;
      }
    });

    // Handle paste
    term.onData((data) => {
      // Let onKey handle everything
    });
  </script>
</body>
</html>`;
  }
}

export async function createWebAdapter(
  config: Config,
  port?: number,
): Promise<UIAdapter> {
  const adapter = new WebAdapter(config, port);
  await adapter.start();
  return adapter;
}
