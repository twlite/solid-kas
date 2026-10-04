const COMPONENTS = ["Column", "Row", "Text", "Button"] as const;
const COMPONENT_IMPORT_SOURCE = "@kas/solid";

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

function hasComponentImport(source: string, component: string): boolean {
  const importPattern = new RegExp(
    `(?:import[\\s\\S]*?from[\\s\\S]*?['\"]${COMPONENT_IMPORT_SOURCE.replace("/", "\\/")}['\"]|import[\\s\\S]*?['\"]${COMPONENT_IMPORT_SOURCE.replace("/", "\\/")}['\"])`,
  );
  if (!importPattern.test(source)) {
    return false;
  }

  const sourceImportPattern = new RegExp(
    `import[\\s\\S]*?\\{[\\s\\S]*?\\b${component}\\b[\\s\\S]*?\\}[\\s\\S]*?from[\\s\\S]*?['\"]${COMPONENT_IMPORT_SOURCE.replace("/", "\\/")}['\"]`,
  );
  const namespacePattern = new RegExp(
    `import[\\s\\S]*?\\*\\s+as\\s+${component}\\b[\\s\\S]*?from[\\s\\S]*?['\"]${COMPONENT_IMPORT_SOURCE.replace("/", "\\/")}['\"]`,
  );
  return sourceImportPattern.test(source) || namespacePattern.test(source);
}

function usesJsxComponent(source: string, component: string): boolean {
  return new RegExp(`<${component}(?=[\\s/>])`).test(maskNonCode(source));
}

/**
 * Main.tsx intentionally keeps the small example syntax readable and does
 * not import the host components. This transform supplies those imports
 * before vite-plugin-solid processes the TSX.
 */
export function injectKasComponents(source: string): { code: string; injected: string[] } {
  const injected = COMPONENTS.filter(
    (component) => usesJsxComponent(source, component) && !hasComponentImport(source, component),
  );
  if (injected.length === 0) {
    return { code: source, injected: [] };
  }

  const importStatement = `import { ${injected.join(", ")} } from "${COMPONENT_IMPORT_SOURCE}";\n`;
  return { code: `${importStatement}${source}`, injected: [...injected] };
}
