import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveBasePath } from "./scripts/resolve-base";

export default defineConfig({
  base: resolveBasePath(),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    target: "es2022",
    sourcemap: false
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
});
