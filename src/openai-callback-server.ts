/**
 * Local callback server for OpenAI OAuth flow
 * Listens on localhost:1455 to capture the OAuth redirect
 */

const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";

export interface CallbackServerResult {
  code: string;
  state: string;
}

export interface CallbackServer {
  port: number;
  close: () => void;
  waitForCallback: (
    expectedState: string,
  ) => Promise<CallbackServerResult | null>;
}

/**
 * Start a local HTTP server to capture OAuth callback
 */
export async function startCallbackServer(): Promise<CallbackServer> {
  let resolveCallback: ((result: CallbackServerResult | null) => void) | null =
    null;
  let expectedState = "";
  let server: ReturnType<typeof Bun.serve> | null = null;

  server = Bun.serve({
    port: CALLBACK_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === CALLBACK_PATH) {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (code && state) {
          // Success! Return a nice HTML page and resolve the promise
          const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      text-align: center;
      max-width: 400px;
    }
    .checkmark {
      font-size: 4rem;
      color: #4ade80;
      margin-bottom: 1rem;
    }
    h1 {
      color: #1f2937;
      margin: 0 0 1rem 0;
      font-size: 1.5rem;
    }
    p {
      color: #6b7280;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Authentication Successful!</h1>
    <p>You can now close this window and return to your terminal.</p>
  </div>
</body>
</html>`;

          // Resolve the promise with the code and state
          if (resolveCallback) {
            resolveCallback({ code, state });
            resolveCallback = null;
          }

          return new Response(html, {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Missing parameters
        return new Response("Missing code or state parameters", {
          status: 400,
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    port: CALLBACK_PORT,
    close: () => {
      if (server) {
        server.stop();
        server = null;
      }
      if (resolveCallback) {
        resolveCallback(null);
        resolveCallback = null;
      }
    },
    waitForCallback: (state: string): Promise<CallbackServerResult | null> => {
      expectedState = state;
      return new Promise((resolve) => {
        resolveCallback = resolve;

        // Timeout after 5 minutes
        setTimeout(
          () => {
            if (resolveCallback) {
              resolveCallback(null);
              resolveCallback = null;
            }
          },
          5 * 60 * 1000,
        );
      });
    },
  };
}
