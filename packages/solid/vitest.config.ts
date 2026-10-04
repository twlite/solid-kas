import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const solidRuntime = require.resolve("solid-js/dist/solid.js");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^solid-js$/,
        replacement: resolve(packageDirectory, solidRuntime)
      }
    ],
    conditions: ["browser"]
  },
  test: {
    environment: "node",
    server: {
      deps: {
        inline: ["solid-js"]
      }
    }
  }
});
