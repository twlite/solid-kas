import type { ChildProcess } from "node:child_process";
import type { Server as NetServer } from "node:net";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

export type KasMode = "serve" | "build";

export interface KasOptions {
  /** URL of the transformed module used as the native entry point. */
  entry?: string;
  /** Directory containing the native Cargo manifest. */
  nativeDir?: string;
  /** A fully qualified native executable path, or a path relative to nativeDir. */
  nativeBinary?: string;
  /** Name used when searching target/{debug,release}. */
  nativeBinaryName?: string;
  /** Cargo executable to invoke for production builds. */
  cargo?: string;
  /** Name of the JavaScript payload emitted into outDir. */
  payloadFileName?: string;
  /** Name of the standalone executable copied into outDir. */
  outputFileName?: string;
  /** Optional explicit application name used in the default output filename. */
  appName?: string;
  /** Override the default loopback socket port. Zero asks the OS for a free port. */
  devPort?: number;
  /** Native process arguments appended after the KAS environment is set. */
  nativeArgs?: string[];
}

export interface ResolvedKasOptions {
  entry: string;
  nativeDir: string;
  nativeBinary?: string;
  nativeBinaryName?: string;
  cargo: string;
  payloadFileName: string;
  outputFileName: string;
  devPort: number;
  nativeArgs: string[];
}

export interface KasConfig {
  command: "serve" | "build";
  root: string;
  outDir: string;
  nativeDir: string;
  entry: string;
}

export interface KasRuntime {
  readonly socket: NetServer;
  readonly address: string;
  readonly child?: ChildProcess;
  close(): Promise<void>;
}

export type KasPlugin = Plugin & {
  readonly kas?: true;
  readonly getRuntime?: () => KasRuntime | undefined;
};

export interface KasServerContext {
  server: ViteDevServer;
  config: ResolvedConfig;
}
