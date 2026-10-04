# solid-kas prototype architecture

## Fixed versions and boundaries

- KAS 0.17.0 with `kas-widgets` 0.17.1 and the software renderer.
- rquickjs 0.14.0 with its ES module loader.
- SolidJS 1.9.15 and `solid-js/universal` through a renderer owned by `@kas/solid`.
- Vite 8.3.2 and `vite-plugin-solid` 2.11.14. Node is tooling only.
- The application process contains KAS, QuickJS, the Solid reactive graph, the widget model, and callbacks. There is no browser, DOM, WebView, Node process, frontend/backend split, or application IPC layer.

## Runtime design

Solid's universal renderer represents nodes as small JavaScript objects containing safe numeric handles. Rust owns the authoritative handle arena. The host surface is limited to creating elements and text, inserting and removing nodes, setting text, setting click callback identifiers, and disposing subtrees. JavaScript functions never cross the FFI boundary. `@kas/solid` keeps functions in a JavaScript callback table and Rust stores only callback numbers.

The Rust adapter maps the three host kinds to real KAS widgets: `Column<Vec<Box<dyn Widget>>>`, `Label`, and `Button`. Structural changes rebuild only the small adapted KAS subtree inside the existing top-level window. Button activation is delivered as a KAS message, invokes the matching Solid callback synchronously in QuickJS, and applies all resulting host changes before the handler returns.

The QuickJS context is owned by the KAS GUI thread. A reload first calls the previous Solid root disposer, clears handles and callbacks, then creates a fresh context and evaluates the new entry module. HMR intentionally loses application state but keeps the OS process and KAS window.

## Development design

`kas()` opens a loopback-only development socket and launches a previously cached generic native binary. Normal `vite` startup and TSX edits never invoke Cargo. `pnpm bootstrap` is the explicit one-time native build.

The plugin uses Vite's client environment transform and module graph to collect the transformed ES modules reachable from `/src/bootstrap.tsx`. It serializes that graph to the live native process. rquickjs resolves the transformed module identifiers directly. The graph contains no `/@vite/client`; reload ownership stays in the KAS plugin and native host.

Vite's stock ModuleRunner cannot be embedded unchanged because its evaluator is JavaScript based and assumes an async evaluator contract. Reimplementing that runner inside QuickJS would be larger and less stable than this prototype. The graph snapshot transport uses the same Vite transforms and dependency graph while keeping the native loader small.

## Production design

`vite build` emits one ES module bundle, then the KAS plugin invokes `cargo build --release` with the emitted payload path. `build.rs` embeds that payload into the executable. The plugin copies the final host executable into `dist`. Running that executable requires neither Vite, Node, nor the source tree.

## Safety and scope

No Rust `unsafe` is required by this workspace. Handles are validated for existence, kind, parentage, and cycles. Reload disposal drops the previous QuickJS context and callback table. The prototype intentionally implements only Column, Text, Button, text content, children, and `onClick`.
