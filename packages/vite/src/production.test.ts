import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createKasPlugin } from "./plugin.js";

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

interface SpawnCall {
  file: string;
  args: readonly string[];
  options?: SpawnOptions;
  payloadExists: boolean;
}

interface ProductionFixture {
  outputDirectory: string;
  payloadPath: string;
  plugin: ReturnType<typeof createKasPlugin>;
  calls: SpawnCall[];
}

async function createProductionFixture(): Promise<ProductionFixture & { root: string }> {
  const root = await mkdtemp(join(tmpdir(), "kas-production-"));
  const nativeDirectory = join(root, "native");
  const outputDirectory = join(root, "dist");
  const payloadPath = join(outputDirectory, "kas-payload.js");
  const nativeBinary = join(root, "kas-runtime.bin");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(nativeBinary, "native release");

  const calls: SpawnCall[] = [];
  const plugin = createKasPlugin({
    nativeDir: nativeDirectory,
    nativeBinary,
    outputFileName: "counter.bin",
    spawnCommand: (file, args, options) => {
      calls.push({
        file,
        args: args ?? [],
        options,
        payloadExists: existsSync(payloadPath),
      });
      const child = fakeChild();
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    },
  });

  (plugin.config as any)({ root }, { command: "build", mode: "production" });
  (plugin.configResolved as any)({ root, build: { outDir: "dist" } });

  return { root, outputDirectory, payloadPath, plugin, calls };
}

describe("production command timing and one-shot behavior", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("starts Cargo from a post-output hook after the payload has been emitted", async () => {
    const fixture = await createProductionFixture();
    temporaryDirectories.push(fixture.root);
    await writeFile(fixture.payloadPath, "export {};\n");

    const writeBundle = fixture.plugin.writeBundle as any;
    expect(writeBundle).toBeTypeOf("function");
    await writeBundle.call(fixture.plugin, { dir: fixture.outputDirectory }, {});

    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]?.file).toBe("cargo");
    expect(fixture.calls[0]?.args).toEqual(["build", "--release"]);
    expect(fixture.calls[0]?.payloadExists).toBe(true);
    expect(fixture.calls[0]?.options?.env?.KAS_PAYLOAD_PATH).toBe(fixture.payloadPath);
    await expect(readFile(join(fixture.outputDirectory, "counter.bin"), "utf8")).resolves.toBe("native release");
    expect(existsSync(fixture.payloadPath)).toBe(false);
  });

  it("invokes the native release command only once for repeated production callbacks", async () => {
    const fixture = await createProductionFixture();
    temporaryDirectories.push(fixture.root);
    await writeFile(fixture.payloadPath, "export {};\n");

    const productionHook = (fixture.plugin.writeBundle ?? fixture.plugin.closeBundle) as any;
    expect(productionHook).toBeTypeOf("function");
    await productionHook.call(fixture.plugin, { dir: fixture.outputDirectory }, {});
    await productionHook.call(fixture.plugin, { dir: fixture.outputDirectory }, {});

    expect(fixture.calls).toHaveLength(1);
  });
});
