import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = (name: string): string => fileURLToPath(new URL(`./tests/stubs/${name}.ts`, import.meta.url));

// pi provides these host packages at runtime and they are optional peer
// dependencies, so tests alias them to tiny local stubs instead of installing
// the whole coding agent.
export default defineConfig({
  resolve: {
    alias: {
      "@mariozechner/pi-tui": stub("pi-tui"),
      "@sinclair/typebox": stub("typebox"),
    },
  },
});
