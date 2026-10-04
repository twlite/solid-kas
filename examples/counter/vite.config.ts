import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { kas } from "@kas/vite";

// This native app does not use Vite's browser-oriented interactive shortcuts.
// Disabling TTY shortcut mode lets Windows deliver Ctrl+C as SIGINT instead of
// treating it as raw input alongside commands such as "r + Enter".
process.env.CI = "1";

export default defineConfig({
  plugins: [
    kas({
      appName: "calculator",
      nativeDir: "../..",
      nativeBinaryName: "kas-runtime",
      outputFileName: "calculator.exe",
    }),
    solid({
      solid: {
        generate: "universal",
        moduleName: "@kas/solid",
      },
    }),
  ],
});
