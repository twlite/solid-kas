import type { ModuleGraphPayload, TransformedModule } from "./protocol.js";
import { DEV_PROTOCOL_VERSION, DEFAULT_ENTRY } from "./protocol.js";

interface ImportedModuleNode {
  url?: string | null;
  id?: string | null;
  file?: string | null;
  importedModules?: Set<ImportedModuleNode>;
  transformResult?: { code?: string; deps?: string[]; dynamicDeps?: string[] } | null;
}

interface ClientEnvironment {
  moduleGraph: {
    ensureEntryFromUrl(url: string): Promise<ImportedModuleNode>;
    getModuleByUrl?(url: string): ImportedModuleNode | undefined | Promise<ImportedModuleNode | undefined>;
    getModuleById?(id: string): ImportedModuleNode | undefined | Promise<ImportedModuleNode | undefined>;
  };
  transformRequest(url: string): Promise<{ code?: string; deps?: string[]; dynamicDeps?: string[] } | null>;
}

interface GraphServer {
  environments?: { client?: ClientEnvironment };
  transformRequest?(url: string): Promise<{ code?: string; deps?: string[]; dynamicDeps?: string[] } | null>;
  moduleGraph?: ClientEnvironment["moduleGraph"];
}

const NON_CODE_EXTENSIONS = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|mp4|webm|wav|mp3)(?:\?|$)/i;

function maskNonCode(source: string): string {
  const output = [...source];
  let state: "code" | "single" | "double" | "template" | "lineComment" | "blockComment" = "code";
  let escaped = false;

  for (let index = 0; index < output.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (character === "/" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "lineComment";
      } else if (character === "/" && next === "*") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "blockComment";
      } else if (character === "'") {
        output[index] = " ";
        state = "single";
      } else if (character === '"') {
        output[index] = " ";
        state = "double";
      } else if (character === "`") {
        output[index] = " ";
        state = "template";
      }
      continue;
    }

    if (state === "lineComment") {
      if (character === "\n" || character === "\r") {
        state = "code";
      } else {
        output[index] = " ";
      }
      continue;
    }

    if (state === "blockComment") {
      if (character === "*" && next === "/") {
        output[index] = " ";
        output[index + 1] = " ";
        index += 1;
        state = "code";
      } else if (character !== "\n" && character !== "\r") {
        output[index] = " ";
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      output[index] = " ";
      continue;
    }
    if (character === "\\") {
      escaped = true;
      output[index] = " ";
      continue;
    }
    if (
      (state === "single" && character === "'") ||
      (state === "double" && character === '"') ||
      (state === "template" && character === "`")
    ) {
      output[index] = " ";
      state = "code";
      continue;
    }
    if (character !== "\n" && character !== "\r") {
      output[index] = " ";
    }
  }

  return output.join("");
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  let state: "code" | "single" | "double" | "template" | "lineComment" | "blockComment" = "code";
  let escaped = false;

  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (character === "/" && next === "/") {
        state = "lineComment";
        index += 1;
      } else if (character === "/" && next === "*") {
        state = "blockComment";
        index += 1;
      } else if (character === "'") {
        state = "single";
      } else if (character === '"') {
        state = "double";
      } else if (character === "`") {
        state = "template";
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
      continue;
    }

    if (state === "lineComment") {
      if (character === "\n" || character === "\r") {
        state = "code";
      }
      continue;
    }

    if (state === "blockComment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (
      (state === "single" && character === "'") ||
      (state === "double" && character === '"') ||
      (state === "template" && character === "`")
    ) {
      state = "code";
    }
  }

  return -1;
}

/**
 * Vite adds browser HMR statements to client transforms. The native runtime
 * owns reloads and deliberately does not load the browser client, so remove
 * those statements while preserving the transformed application module.
 */
export function stripNativeIncompatibleHmr(code: string): string {
  let result = code;
  const importPattern = /(?:^|[;\n])\s*import\s+(?:[^;]*?\sfrom\s+)?["']\/@vite\/client["'];?/g;
  const maskedImports = maskNonCode(result);
  const importRanges: Array<[number, number]> = [];
  for (const match of result.matchAll(importPattern)) {
    const importOffset = match[0].search(/\bimport\b/);
    if (importOffset < 0) {
      continue;
    }
    const start = (match.index ?? 0) + importOffset;
    if (maskedImports.slice(start, start + "import".length) === "import") {
      importRanges.push([start, (match.index ?? 0) + match[0].length]);
    }
  }
  for (const [start, end] of importRanges.reverse()) {
    result = `${result.slice(0, start)}${result.slice(end)}`;
  }

  while (true) {
    const assignment = /import\.meta\.hot\s*=\s*[^;]+;?/.exec(maskNonCode(result));
    if (!assignment || assignment.index === undefined) {
      break;
    }
    result = `${result.slice(0, assignment.index)}${result.slice(assignment.index + assignment[0].length)}`;
  }

  while (true) {
    const masked = maskNonCode(result);
    const condition = /if\s*\(\s*import\.meta\.hot\s*\)\s*\{/.exec(masked);
    if (!condition || condition.index === undefined) {
      break;
    }
    const open = masked.indexOf("{", condition.index);
    const close = matchingBrace(result, open);
    if (close < 0) {
      break;
    }
    result = `${result.slice(0, condition.index)}${result.slice(close + 1)}`;
  }

  return result;
}

export function isGraphModuleId(id: string): boolean {
  if (!id || id.startsWith("\0")) {
    return false;
  }
  if (id.includes("/@vite/client") || id === "/@vite/client") {
    return false;
  }
  return !NON_CODE_EXTENSIONS.test(id);
}

function moduleId(node: ImportedModuleNode, fallback: string): string {
  return node.url ?? node.id ?? node.file ?? fallback;
}

function normalizeDependencyId(id: string, importer: string): string {
  if (id.startsWith("/@vite/")) {
    return id;
  }
  if (id.startsWith(".") && importer.startsWith("/")) {
    const base = importer.slice(0, importer.lastIndexOf("/") + 1);
    const segments = `${base}${id}`.split("/");
    const normalized: string[] = [];
    for (const segment of segments) {
      if (!segment || segment === ".") {
        continue;
      }
      if (segment === "..") {
        normalized.pop();
      } else {
        normalized.push(segment);
      }
    }
    return `/${normalized.join("/")}`;
  }
  return id;
}

async function transformedCode(
  environment: ClientEnvironment,
  server: GraphServer,
  id: string,
  node: ImportedModuleNode,
): Promise<{ code: string; deps: string[] }> {
  const result = (await environment.transformRequest(id)) ?? node.transformResult ?? null;
  if (!result?.code) {
    const fallback = server.transformRequest ? await server.transformRequest(id) : null;
    if (!fallback?.code) {
      throw new Error(`Vite did not produce transformed JavaScript for ${id}`);
    }
    return {
      code: stripNativeIncompatibleHmr(fallback.code),
      deps: [...(fallback.deps ?? []), ...(fallback.dynamicDeps ?? [])],
    };
  }
  return {
    code: stripNativeIncompatibleHmr(result.code),
    deps: [...(result.deps ?? []), ...(result.dynamicDeps ?? [])],
  };
}

function dependencyNodes(node: ImportedModuleNode): ImportedModuleNode[] {
  return node.importedModules ? [...node.importedModules] : [];
}

export interface CollectGraphOptions {
  entry?: string;
  generation?: number;
}

/**
 * Collects the transformed client environment graph. No server transform
 * shortcut is used when the Vite environment API is available, which keeps
 * the graph identical to what Vite serves to a client request.
 */
export async function collectClientModuleGraph(
  server: GraphServer,
  options: CollectGraphOptions = {},
): Promise<ModuleGraphPayload> {
  const entry = options.entry ?? DEFAULT_ENTRY;
  const environment = server.environments?.client;
  if (!environment) {
    throw new Error("The Vite client environment is not available");
  }

  const root = await environment.moduleGraph.ensureEntryFromUrl(entry);
  const modules: Record<string, TransformedModule> = {};
  const visited = new Set<string>();
  const pending: Array<{ id: string; node: ImportedModuleNode }> = [{ id: entry, node: root }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    const id = moduleId(current.node, current.id);
    if (!isGraphModuleId(id) || visited.has(id)) {
      continue;
    }
    visited.add(id);

    const transformed = await transformedCode(environment, server, id, current.node);
    const imported = new Set<string>();
    for (const child of dependencyNodes(current.node)) {
      const childId = moduleId(child, "");
      if (isGraphModuleId(childId)) {
        imported.add(childId);
        pending.push({ id: childId, node: child });
      }
    }
    for (const dep of transformed.deps) {
      const dependencyId = normalizeDependencyId(dep, id);
      if (!isGraphModuleId(dependencyId)) {
        continue;
      }
      imported.add(dependencyId);
      const byUrl = environment.moduleGraph.getModuleByUrl?.(dependencyId);
      const child = (await Promise.resolve(byUrl)) ??
        (await Promise.resolve(environment.moduleGraph.getModuleById?.(dependencyId)));
      if (child) {
        pending.push({ id: dependencyId, node: child });
      }
    }

    modules[id] = {
      id,
      code: transformed.code,
      importedIds: [...imported].sort(),
    };
  }

  if (!modules[entry]) {
    const entryId = moduleId(root, entry);
    if (!modules[entryId]) {
      throw new Error(`The KAS entry module ${entry} was not included in the client graph`);
    }
  }

  return {
    version: DEV_PROTOCOL_VERSION,
    generation: options.generation ?? 0,
    entry,
    modules,
  };
}
