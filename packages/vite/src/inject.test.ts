import { describe, expect, it } from "vitest";
import { injectKasComponents } from "./inject.js";

describe("KAS component injection", () => {
  it("adds only the unimported host components used by TSX", () => {
    const source = `import { createSignal } from "solid-js";\nconst App = () => <Column><Text>Hello</Text><Button /></Column>;`;
    const result = injectKasComponents(source);

    expect(result.injected).toEqual(["Column", "Text", "Button"]);
    expect(result.code.startsWith('import { Column, Text, Button } from "@kas/solid";')).toBe(true);
  });

  it("leaves an explicitly imported component untouched", () => {
    const source = `import { Column } from "@kas/solid";\nconst App = () => <Column><Text /></Column>;`;
    const result = injectKasComponents(source);

    expect(result.injected).toEqual(["Text"]);
    expect(result.code).toBe(`import { Text } from "@kas/solid";\n${source}`);
  });

  it("does not inject components that only occur in strings", () => {
    const source = `const label = "<Column>";\nexport default label;`;
    expect(injectKasComponents(source)).toEqual({ code: source, injected: [] });
  });
});
