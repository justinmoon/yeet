import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "gui",
  server: {
    port: 3456,
    proxy: {
      "/api": {
        target: "http://localhost:3457",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist/gui",
  },
});
