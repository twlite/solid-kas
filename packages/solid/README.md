# @kas/solid

`@kas/solid` is the SolidJS universal renderer for the KAS widget host. It
supports `Column`, `Text`, `Button`, text children, and `Button` `onClick`
callbacks.

The native side provides a global `__kas` host with these operations:

- `createElement(kind)`
- `createText(value)`
- `insert(parent, node, anchor)`
- `remove(parent, node)`
- `setText(node, value)`
- `setOnClick(node, callbackId)`
- `dispose(node)`

The default root handle is zero. A host can expose a different root with a
numeric `root` property or `getRoot()` method. Callback identifiers start at
one, and zero clears a button callback. Native activation calls the global
`__kas_dispatch(id, ...args)` function synchronously.
