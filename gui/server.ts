/**
 * Simple Bun HTTP server for React Flow GUI
 */

import path from "node:path";
import { file } from "bun";

const PORT = 3456;
const GUI_DIR = import.meta.dir;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let filepath = url.pathname;

    // Default to index.html
    if (filepath === "/") {
      filepath = "/index.html";
    }

    // Serve static files from gui directory
    const fullPath = path.join(GUI_DIR, filepath);

    try {
      const fileContent = file(fullPath);
      const exists = await fileContent.exists();

      if (!exists) {
        return new Response("Not Found", { status: 404 });
      }

      // Determine content type
      const ext = path.extname(fullPath).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
      };

      const contentType = contentTypes[ext] || "application/octet-stream";

      return new Response(fileContent, {
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      console.error(`Error serving ${fullPath}:`, error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

console.log(`🚀 GUI Server running at http://localhost:${PORT}`);
console.log(`   Open in browser to view state machine visualization`);
