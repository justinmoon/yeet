import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: "gui",
  server: {
    port: 3456,
  },
  build: {
    outDir: "../dist/gui",
  },
});
