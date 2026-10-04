import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createKasPlugin } from "./plugin.js";

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.kill = () => true;
  return child;
}

describe("KAS plugin orchestration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("configures one ES payload and copies the release host after Cargo", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-plugin-"));
    temporaryDirectories.push(root);
    const nativeDir = join(root, "native");
    const outputDir = join(root, "dist");
    const binary = join(root, "target", "release", "kas-runtime.exe");
    await mkdir(join(root, "target", "release"), { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(binary, "native release");
    await writeFile(join(outputDir, "kas-payload.js"), "export {};\n");

    const observed: { file: string; args: readonly string[]; options?: SpawnOptions }[] = [];
    const plugin = createKasPlugin({
      nativeDir,
      nativeBinaryName: "kas-runtime",
      outputFileName: "counter.exe",
      spawnCommand: (file, args, options) => {
        observed.push({ file, args: args ?? [], options });
        const child = fakeChild();
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      },
    });

    const configResult = (plugin.config as any)({ root }, { command: "build", mode: "production" });
    expect(configResult).toMatchObject({
      build: {
        rolldownOptions: {
          output: {
            format: "es",
            codeSplitting: false,
            entryFileNames: "kas-payload.js",
          },
        },
      },
    });

    (plugin.configResolved as any)({ root, build: { outDir: "dist" } });
    await (plugin.writeBundle as any).call(plugin);
    await (plugin.writeBundle as any).call(plugin);

    expect(observed).toHaveLength(1);
    expect(observed[0]?.file).toBe("cargo");
    expect(observed[0]?.args).toEqual(["build", "--release"]);
    expect(observed[0]?.options?.cwd).toBe(nativeDir);
    expect(observed[0]?.options?.env?.KAS_PAYLOAD_PATH).toBe(join(outputDir, "kas-payload.js"));
    await expect(readFile(join(outputDir, "counter.exe"), "utf8")).resolves.toBe("native release");
    await expect(access(join(outputDir, "kas-payload.js"))).rejects.toThrow();
  });

  it("keeps the development host alive until the Vite HTTP server closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-dev-plugin-"));
    temporaryDirectories.push(root);
    const binary = join(root, "kas-runtime.exe");
    await writeFile(binary, "cached debug host");

    let killCount = 0;
    const child = fakeChild();
    child.kill = () => {
      killCount += 1;
      return true;
    };
    const plugin = createKasPlugin({
      nativeBinary: binary,
      spawnCommand: () => child,
    });

    (plugin.config as any)({ root }, { command: "serve", mode: "development" });
    const httpServer = Object.assign(new EventEmitter(), { listening: false });
    const server = { httpServer } as any;

    const configureServer = plugin.configureServer as any;
    expect(await configureServer.call(plugin, server)).toBeUndefined();
    expect(plugin.getRuntime()).toBeDefined();
    expect(killCount).toBe(0);

    httpServer.emit("close");
    expect(killCount).toBe(1);
    expect(plugin.getRuntime()).toBeUndefined();
  });
});
