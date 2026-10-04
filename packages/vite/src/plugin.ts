import { access, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { collectClientModuleGraph } from "./graph.js";
import { injectKasComponents } from "./inject.js";
import { detectMode } from "./mode.js";
import {
  copyStandaloneBinary,
  defaultNativeDirectory,
  resolveNativeBinary,
  runCargoRelease,
  spawnCachedNativeBinary,
  type SpawnCommand,
} from "./commands.js";
import {
  createModuleGraphMessage,
  isNativeToHostMessage,
  openLoopbackJsonlServer,
  type LoopbackJsonlServer,
  type NativeToHostMessage,
} from "./protocol.js";
import type { KasOptions, KasRuntime, ResolvedKasOptions } from "./types.js";

interface RuntimeState {
  protocol?: LoopbackJsonlServer<ReturnType<typeof createModuleGraphMessage>>;
  child?: ChildProcess;
  address?: string;
  generation: number;
  graphPromise?: Promise<void>;
  graphDirty?: boolean;
  waitingForHttpServer?: boolean;
  server?: ViteDevServer;
}

function normalizeEntry(entry: string): string {
  return entry.startsWith("/") ? entry : `/${entry}`;
}

function nativeOutputName(options: KasOptions): string {
  if (options.outputFileName) {
    return options.outputFileName;
  }
  return `${options.appName ?? "kas-app"}${process.platform === "win32" ? ".exe" : ""}`;
}

function resolveOptions(options: KasOptions, root: string): ResolvedKasOptions {
  return {
    entry: normalizeEntry(options.entry ?? "/src/bootstrap.tsx"),
    nativeDir: options.nativeDir ? resolve(root, options.nativeDir) : defaultNativeDirectory(root),
    nativeBinary: options.nativeBinary,
    nativeBinaryName: options.nativeBinaryName,
    cargo: options.cargo ?? "cargo",
    payloadFileName: options.payloadFileName ?? "kas-payload.js",
    outputFileName: nativeOutputName(options),
    devPort: options.devPort ?? 0,
    nativeArgs: [...(options.nativeArgs ?? [])],
  };
}

class DevRuntime implements KasRuntime {
  protocol?: LoopbackJsonlServer<ReturnType<typeof createModuleGraphMessage>>;
  child?: ChildProcess;
  address = "";
  private readonly state: RuntimeState;
  private readonly options: ResolvedKasOptions;
  private readonly spawnCommand?: SpawnCommand;

  constructor(options: ResolvedKasOptions, spawnCommand?: SpawnCommand) {
    this.options = options;
    this.spawnCommand = spawnCommand;
    this.state = { generation: 0 };
  }

  get socket() {
    if (!this.protocol) {
      throw new Error("The KAS development protocol has not started");
    }
    return this.protocol.server;
  }

  async start(server: ViteDevServer): Promise<void> {
    this.state.server = server;
    this.protocol = await openLoopbackJsonlServer<unknown, ReturnType<typeof createModuleGraphMessage>>({
      port: this.options.devPort,
      onMessage: (message) => this.handleNativeMessage(message),
      onClient: () => {
        this.sendGraphWhenReady(server);
      },
    });
    this.state.protocol = this.protocol;
    this.address = this.protocol.address;
    const spawned = await spawnCachedNativeBinary({
      native: this.options,
      socketAddress: this.address,
      mode: "debug",
      entry: this.options.entry,
      spawnCommand: this.spawnCommand,
    });
    this.child = spawned.child;
    this.state.child = spawned.child;
    this.child.once("error", (error) => {
      console.error(`[kas] native host error: ${error.message}`);
    });
    this.child.once("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGTERM") {
        console.error(`[kas] native host exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`);
      }
    });

    // Vite initializes the client environment while starting its HTTP server.
    // Waiting for graph transformation inside configureServer deadlocks that
    // startup, so the first graph is queued for the listening event.
    this.sendGraphWhenReady(server);
  }

  private sendGraphWhenReady(server: ViteDevServer): void {
    const httpServer = server.httpServer;
    if (!httpServer || httpServer.listening) {
      void this.sendGraph(server).catch((error: unknown) => {
        console.error(`[kas] failed to collect Vite module graph: ${String(error)}`);
      });
      return;
    }
    if (this.state.waitingForHttpServer) {
      return;
    }
    this.state.waitingForHttpServer = true;
    httpServer.once("listening", () => {
      this.state.waitingForHttpServer = false;
      this.sendGraphWhenReady(server);
    });
  }

  private handleNativeMessage(value: unknown): void {
    if (!isNativeToHostMessage(value)) {
      return;
    }
    const message = value as NativeToHostMessage;
    if (message.type === "log" && message.message) {
      const level = message.level ?? "info";
      const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      logger(`[kas] ${message.message}`);
    }
    if (message.type === "error") {
      console.error(`[kas] native host error: ${message.message}`);
    }
    if (message.type === "ready" && this.state.server) {
      this.sendGraphWhenReady(this.state.server);
    }
  }

  async sendGraph(server: ViteDevServer): Promise<void> {
    if (!this.protocol) {
      return;
    }
    this.state.graphDirty = true;
    if (this.state.graphPromise) {
      await this.state.graphPromise;
      return;
    }
    const graphPromise = (async () => {
      while (this.state.graphDirty) {
        this.state.graphDirty = false;
        const generation = ++this.state.generation;
        const graph = await collectClientModuleGraph(server, {
          entry: this.options.entry,
          generation,
        });
        this.protocol?.send(createModuleGraphMessage(graph));
      }
    })();
    this.state.graphPromise = graphPromise;
    try {
      await graphPromise;
    } finally {
      if (this.state.graphPromise === graphPromise) {
        this.state.graphPromise = undefined;
      }
    }
    if (this.state.graphDirty) {
      await this.sendGraph(server);
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child && !child.killed) {
      child.kill();
    }
    await this.protocol?.close();
    this.child = undefined;
    this.protocol = undefined;
    this.state.child = undefined;
    this.state.protocol = undefined;
  }
}

export interface CreateKasPluginOptions extends KasOptions {
  /** Test hook for command orchestration without starting a real process. */
  spawnCommand?: SpawnCommand;
}

export function createKasPlugin(options: CreateKasPluginOptions = {}): Plugin & {
  readonly kas: true;
  readonly getRuntime: () => KasRuntime | undefined;
} {
  let mode: "serve" | "build" = "serve";
  let config: ResolvedConfig | undefined;
  let resolved: ResolvedKasOptions | undefined;
  let runtime: DevRuntime | undefined;
  let releasePromise: Promise<void> | undefined;

  return {
    name: "kas",
    enforce: "pre",
    kas: true,
    getRuntime: () => runtime,

    config(configInput, env) {
      mode = detectMode(env.command);
      const root = resolve(configInput.root ?? process.cwd());
      resolved = resolveOptions(options, root);
      if (mode !== "build") {
        return undefined;
      }

      const input = resolve(root, resolved.entry.slice(1));
      return {
        build: {
          target: "es2022",
          rolldownOptions: {
            input,
            output: {
              format: "es",
              codeSplitting: false,
              entryFileNames: resolved.payloadFileName,
              chunkFileNames: "kas-[name]-[hash].js",
            },
          },
        },
      };
    },

    configResolved(resolvedConfig) {
      config = resolvedConfig;
      if (!resolved) {
        resolved = resolveOptions(options, resolvedConfig.root);
      }
    },

    transform(code, id) {
      if (id.includes("/node_modules/") || id.includes("\\node_modules\\")) {
        return undefined;
      }
      if (!/\.(?:tsx|jsx)$/.test(id)) {
        return undefined;
      }
      const result = injectKasComponents(code);
      return result.injected.length > 0 ? { code: result.code, map: null } : undefined;
    },

    async configureServer(server) {
      if (mode !== "serve" || !resolved) {
        return undefined;
      }
      const currentRuntime = new DevRuntime(resolved, options.spawnCommand);
      runtime = currentRuntime;
      try {
        await currentRuntime.start(server);
      } catch (error) {
        if (runtime === currentRuntime) {
          runtime = undefined;
        }
        await currentRuntime.close();
        throw error;
      }

      // Vite calls a function returned from configureServer immediately after
      // its internal middleware setup. That return value is not a server-close
      // hook, so closing the runtime from there terminates the host during
      // normal startup. Tie cleanup to the actual HTTP server lifecycle.
      const closeRuntime = () => {
        if (runtime !== currentRuntime) {
          return;
        }
        runtime = undefined;
        void currentRuntime.close().catch((error: unknown) => {
          console.error(`[kas] failed to close native host: ${String(error)}`);
        });
      };
      server.httpServer?.once("close", closeRuntime);
      return undefined;
    },

    async handleHotUpdate(context) {
      if (mode !== "serve" || !runtime) {
        return context.modules;
      }
      await runtime.sendGraph(context.server);
      // There is no browser HMR client. The native host owns reloads.
      return [];
    },

    async writeBundle() {
      if (mode !== "build" || !config || !resolved) {
        return;
      }
      if (releasePromise) {
        return releasePromise;
      }

      releasePromise = (async () => {
        const outDir = resolve(config.root, config.build.outDir);
        const payloadPath = resolve(outDir, resolved.payloadFileName);
        await mkdir(outDir, { recursive: true });

        // writeBundle runs after Rolldown has finished writing the output.
        // Fail before Cargo starts if a custom configuration removed the
        // expected entry chunk.
        try {
          await access(payloadPath);
        } catch {
          throw new Error(`KAS payload was not emitted at ${payloadPath}`);
        }

        const nativeDir = resolved.nativeDir;
        await runCargoRelease({
          cargo: resolved.cargo,
          nativeDir,
          payloadPath,
          spawnCommand: options.spawnCommand,
        });
        const nativeBinary = await resolveNativeBinary({
          nativeDir,
          mode: "release",
          binaryPath: resolved.nativeBinary,
          binaryName: resolved.nativeBinaryName,
        });
        await copyStandaloneBinary(nativeBinary, outDir, resolved.outputFileName);
        await unlink(payloadPath);
      })();

      return releasePromise;
    },
  };
}

export const kas = createKasPlugin;
