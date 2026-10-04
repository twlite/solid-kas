import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { kas } from "@kas/vite";

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
