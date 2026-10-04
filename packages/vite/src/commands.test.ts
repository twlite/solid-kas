import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyStandaloneBinary,
  resolveNativeBinary,
  runCargoRelease,
  spawnCachedNativeBinary,
} from "./commands.js";
import type { ResolvedKasOptions } from "./types.js";

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}

const nativeOptions: ResolvedKasOptions = {
  entry: "/src/bootstrap.tsx",
  nativeDir: "",
  cargo: "cargo",
  payloadFileName: "kas-payload.js",
  outputFileName: "counter.exe",
  devPort: 0,
  nativeArgs: [],
};

describe("native command orchestration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("resolves an already cached debug binary without invoking Cargo", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-vite-"));
    temporaryDirectories.push(root);
    const nativeDir = join(root, "native");
    await mkdir(join(nativeDir, "target", "debug"), { recursive: true });
    const binary = join(nativeDir, "target", "debug", "kas-host.exe");
    await writeFile(binary, "cached binary");

    const observed: { file: string; args: readonly string[]; options?: SpawnOptions }[] = [];
    const child = fakeChild();
    const result = await spawnCachedNativeBinary({
      native: { ...nativeOptions, nativeDir },
      socketAddress: "127.0.0.1:34567",
      mode: "debug",
      entry: "/src/bootstrap.tsx",
      spawnCommand: (file, args, options) => {
        observed.push({ file, args: args ?? [], options });
        return child;
      },
    });

    expect(result.path).toBe(binary);
    expect(observed).toHaveLength(1);
    expect(observed[0]?.file).toBe(binary);
    expect(observed[0]?.args).toEqual([]);
    expect(observed[0]?.options?.env?.KAS_DEV_SOCKET).toBe("127.0.0.1:34567");
    expect(observed[0]?.options?.env?.KAS_ENTRY_MODULE).toBe("/src/bootstrap.tsx");
  });

  it("runs release Cargo with the emitted payload path in the environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-vite-"));
    temporaryDirectories.push(root);
    const payloadPath = join(root, "dist", "kas-payload.js");
    const observed: { file: string; args: readonly string[]; options?: SpawnOptions }[] = [];

    await runCargoRelease({
      cargo: "cargo",
      nativeDir: join(root, "native"),
      payloadPath,
      spawnCommand: (file, args, options) => {
        observed.push({ file, args: args ?? [], options });
        const child = fakeChild();
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      },
    });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.file).toBe("cargo");
    expect(observed[0]?.args).toEqual(["build", "--release"]);
    expect(observed[0]?.options?.cwd).toBe(join(root, "native"));
    expect(observed[0]?.options?.env?.KAS_PAYLOAD_PATH).toBe(payloadPath);
  });

  it("copies the release executable to the requested dist filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-vite-"));
    temporaryDirectories.push(root);
    const source = join(root, "kas-host.exe");
    const output = join(root, "dist");
    await mkdir(output, { recursive: true });
    await writeFile(source, "standalone executable");

    const destination = await copyStandaloneBinary(source, output, "counter.exe");
    expect(destination).toBe(join(output, "counter.exe"));
  });

  it("fails with a bootstrap hint when the native binary is not cached", async () => {
    const root = await mkdtemp(join(tmpdir(), "kas-vite-"));
    temporaryDirectories.push(root);
    await expect(
      resolveNativeBinary({ nativeDir: root, mode: "debug", binaryName: "missing-host" }),
    ).rejects.toThrow("Run pnpm bootstrap");
  });
});
