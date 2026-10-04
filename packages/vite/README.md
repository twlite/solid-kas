# @kas/vite

The `kas()` plugin connects Vite's client environment to a cached native KAS
host.

In serve mode it binds a TCP socket on `127.0.0.1`, starts the cached binary,
and passes these environment variables to it:

- `KAS_DEV_SOCKET`, in `host:port` form
- `KAS_ENTRY_MODULE`, normally `/src/bootstrap.tsx`
- `KAS_MODE=debug`
- `KAS_PROTOCOL_VERSION=1`

The native host may send a `ready` JSON line. The plugin sends a
`module_graph` line containing the transformed client modules. Each module is
keyed by its Vite URL and contains the transformed ES code and direct import
IDs. The `/@vite/client` module is intentionally excluded.

In build mode Vite emits `kas-payload.js`, then the plugin runs
`cargo build --release` in `native/` with `KAS_PAYLOAD_PATH`, `KAS_PAYLOAD`, and
`KAS_JS_PAYLOAD` set to the absolute payload path. The resulting release
binary is copied to `dist` under the configured output filename.
