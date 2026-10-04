import type { KasMode } from "./types.js";

/**
 * Vite passes the command to the config hook, so command is the source of
 * truth. NODE_ENV is deliberately not used because it is often "development"
 * while running a production build.
 */
export function detectMode(command: string | undefined): KasMode {
  return command === "build" ? "build" : "serve";
}

export function isDevelopmentMode(command: string | undefined): boolean {
  return detectMode(command) === "serve";
}

export function isProductionMode(command: string | undefined): boolean {
  return detectMode(command) === "build";
}
