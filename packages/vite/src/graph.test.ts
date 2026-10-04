import { describe, expect, it, vi } from "vitest";
import { collectClientModuleGraph, stripNativeIncompatibleHmr } from "./graph.js";
import { createModuleGraphMessage, encodeJsonLine } from "./protocol.js";

interface FakeModuleNode {
  url: string;
  importedModules?: Set<FakeModuleNode>;
}

interface FakeTransformResult {
  code: string;
  deps?: string[];
  dynamicDeps?: string[];
}

function fakeModule(url: string, importedModules: FakeModuleNode[] = []): FakeModuleNode {
  return {
    url,
    importedModules: new Set(importedModules),
  };
}

describe("transformed client graph serialization", () => {
  it("removes browser HMR glue from native module source", () => {
    const code = [
      'import { createHotContext } from "/@vite/client";import.meta.hot = createHotContext("/src/Main.tsx");',
      "export const value = 1;",
      'if (import.meta.hot) { import.meta.hot.accept(() => ({ brace: "}" })); }',
      'export const sourceText = "if (import.meta.hot) { keep this text }";',
    ].join("\n");

    expect(stripNativeIncompatibleHmr(code)).toBe(
      '\nexport const value = 1;\n\nexport const sourceText = "if (import.meta.hot) { keep this text }";',
    );
  });

  it("serializes transformed modules, normalized edges, and no browser client or asset modules", async () => {
    const entry = fakeModule("/src/bootstrap.tsx");
    const child = fakeModule("/src/components/child.tsx");
    const lazy = fakeModule("/src/lazy.ts");
    const shared = fakeModule("/src/shared.ts");
    const viteClient = fakeModule("/@vite/client");
    const asset = fakeModule("/src/logo.svg");

    entry.importedModules = new Set([child, viteClient]);
    child.importedModules = new Set([asset]);

    const transforms = new Map<string, FakeTransformResult>([
      [
        "/src/bootstrap.tsx",
        {
          code: "export { App } from './components/child.tsx';",
          deps: ["./components/child.tsx", "/@vite/client"],
          dynamicDeps: ["./lazy.ts"],
        },
      ],
      [
        "/src/components/child.tsx",
        {
          code: "export const App = () => 'child';",
          deps: ["../shared.ts"],
        },
      ],
      ["/src/lazy.ts", { code: "export const lazy = true;" }],
      ["/src/shared.ts", { code: "export const shared = true;" }],
    ]);
    const nodes = new Map<string, FakeModuleNode>([
      [entry.url, entry],
      [child.url, child],
      [lazy.url, lazy],
      [shared.url, shared],
      [viteClient.url, viteClient],
      [asset.url, asset],
    ]);
    const fallbackTransform = vi.fn(async () => null);
    const environment = {
      moduleGraph: {
        ensureEntryFromUrl: vi.fn(async () => entry),
        getModuleByUrl: vi.fn((url: string) => nodes.get(url)),
      },
      transformRequest: vi.fn(async (url: string) => transforms.get(url) ?? null),
    };

    const graph = await collectClientModuleGraph(
      {
        environments: { client: environment },
        transformRequest: fallbackTransform,
      },
      { entry: entry.url, generation: 4 },
    );

    const serialized = JSON.parse(
      encodeJsonLine(createModuleGraphMessage(graph)).trim(),
    ) as unknown;

    expect(serialized).toEqual({
      type: "module_graph",
      graph: {
        version: 1,
        generation: 4,
        entry: "/src/bootstrap.tsx",
        modules: {
          "/src/bootstrap.tsx": {
            id: "/src/bootstrap.tsx",
            code: "export { App } from './components/child.tsx';",
            importedIds: ["/src/components/child.tsx", "/src/lazy.ts"],
          },
          "/src/components/child.tsx": {
            id: "/src/components/child.tsx",
            code: "export const App = () => 'child';",
            importedIds: ["/src/shared.ts"],
          },
          "/src/lazy.ts": {
            id: "/src/lazy.ts",
            code: "export const lazy = true;",
            importedIds: [],
          },
          "/src/shared.ts": {
            id: "/src/shared.ts",
            code: "export const shared = true;",
            importedIds: [],
          },
        },
      },
    });
    expect(environment.transformRequest).toHaveBeenCalledTimes(4);
    expect(fallbackTransform).not.toHaveBeenCalled();
  });
});
