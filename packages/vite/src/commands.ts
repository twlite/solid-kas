import { access, copyFile, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedKasOptions } from "./types.js";

export interface SpawnCommandOptions {
  file: string;
  args?: string[];
  options?: SpawnOptions;
}

export type SpawnCommand = (file: string, args?: readonly string[], options?: SpawnOptions) => ChildProcess;

function defaultSpawnCommand(file: string, args?: readonly string[], options?: SpawnOptions): ChildProcess {
  const normalizedArgs = args ? [...args] : [];
  return options ? spawn(file, normalizedArgs, options) : spawn(file, normalizedArgs);
}

export interface CargoReleaseOptions {
  cargo: string;
  nativeDir: string;
  payloadPath: string;
  env?: NodeJS.ProcessEnv;
  spawnCommand?: SpawnCommand;
}

export interface NativeBinarySearchOptions {
  nativeDir: string;
  mode: "debug" | "release";
  binaryPath?: string;
  binaryName?: string;
}

function executableCandidates(name: string): string[] {
  return process.platform === "win32" ? [name, `${name}.exe`] : [name, `${name}.exe`];
}

async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function cargoPackageName(manifest: string): string | undefined {
  const packageSection = manifest.match(/\[package\]([\s\S]*?)(?:\n\[|$)/i)?.[1];
  return packageSection?.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1];
}

export async function discoverNativeBinaryName(nativeDir: string): Promise<string | undefined> {
  const manifests = [
    join(nativeDir, "Cargo.toml"),
    join(nativeDir, "runtime", "Cargo.toml"),
    join(nativeDir, "..", "Cargo.toml"),
  ];
  for (const manifestPath of manifests) {
    try {
      const manifest = await readFile(manifestPath, "utf8");
      const name = cargoPackageName(manifest);
      if (name) {
        return name;
      }
    } catch {
      // Keep searching the supported workspace manifest locations.
    }
  }
  return undefined;
}

export async function resolveNativeBinary(options: NativeBinarySearchOptions): Promise<string> {
  const { nativeDir, mode } = options;
  const configured = options.binaryPath ?? process.env.KAS_NATIVE_BINARY;
  const discoveredName = options.binaryName ?? (await discoverNativeBinaryName(nativeDir));
  const names = [
    ...(configured ? [configured] : []),
    ...(discoveredName ? executableCandidates(discoveredName) : []),
    ...executableCandidates("kas-runtime"),
    ...executableCandidates("kas-host"),
    ...executableCandidates("solid-kas"),
    ...executableCandidates("kas"),
  ];

  const relativeCandidates = names.map((candidate) => {
    if (isAbsolute(candidate)) {
      return [candidate];
    }
    if (candidate.includes(sep) || candidate.includes("/") || candidate.includes("\\")) {
      return [resolve(nativeDir, candidate)];
    }
    return [
      join(nativeDir, "target", mode, candidate),
      join(nativeDir, "runtime", "target", mode, candidate),
      join(nativeDir, "..", "target", mode, candidate),
    ];
  });

  const seen = new Set<string>();
  const candidates = relativeCandidates.flat();
  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      if (await isFile(normalized)) {
        return normalized;
      }
    }
  }

  const display = candidates.map((candidate) => resolve(candidate)).join(", ");
  throw new Error(
    `No cached ${mode} KAS native binary was found. Checked: ${display}. Run pnpm bootstrap before starting Vite.`,
  );
}

export async function spawnCachedNativeBinary(
  options: {
    native: ResolvedKasOptions;
    socketAddress: string;
    mode: "debug" | "release";
    entry: string;
    env?: NodeJS.ProcessEnv;
    spawnCommand?: SpawnCommand;
  },
): Promise<{ path: string; child: ChildProcess }> {
  const path = await resolveNativeBinary({
    nativeDir: options.native.nativeDir,
    mode: options.mode,
    binaryPath: options.native.nativeBinary,
    binaryName: options.native.nativeBinaryName,
  });
  const command = options.spawnCommand ?? defaultSpawnCommand;
  const child = command(path, options.native.nativeArgs, {
    cwd: options.native.nativeDir,
    env: {
      ...process.env,
      ...options.env,
      KAS_MODE: options.mode,
      KAS_DEV_SOCKET: options.socketAddress,
      KAS_ENTRY_MODULE: options.entry,
      KAS_PROTOCOL_VERSION: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  return { path, child };
}

export function runSpawnedCommand(
  command: SpawnCommandOptions,
  spawnCommand: SpawnCommand = defaultSpawnCommand,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCommand(command.file, command.args, command.options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`${command.file} ${command.args?.join(" ") ?? ""} failed with ${status}`.trim()));
    });
  });
}

/**
 * The payload path is provided through named environment variables so native
 * build.rs implementations can consume the stable primary name while older
 * prototype code can use the aliases.
 */
export async function runCargoRelease(options: CargoReleaseOptions): Promise<void> {
  const payloadPath = resolve(options.payloadPath);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    KAS_PAYLOAD_PATH: payloadPath,
    KAS_PAYLOAD: payloadPath,
    KAS_JS_PAYLOAD: payloadPath,
  };
  await runSpawnedCommand(
    {
      file: options.cargo,
      args: ["build", "--release"],
      options: {
        cwd: options.nativeDir,
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    },
    options.spawnCommand,
  );
}

export async function copyStandaloneBinary(
  nativeBinaryPath: string,
  outputDirectory: string,
  outputFileName: string,
): Promise<string> {
  const destination = resolve(outputDirectory, outputFileName);
  await copyFile(nativeBinaryPath, destination);
  return destination;
}

export function defaultNativeDirectory(projectRoot: string): string {
  return resolve(projectRoot, "native");
}

export function packageDirectory(): string {
  return dirname(fileURLToPath(import.meta.url));
}
