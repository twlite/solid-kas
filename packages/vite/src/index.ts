import { kas, createKasPlugin } from "./plugin.js";

export { kas, createKasPlugin };
export { collectClientModuleGraph, isGraphModuleId } from "./graph.js";
export { injectKasComponents } from "./inject.js";
export { detectMode, isDevelopmentMode, isProductionMode } from "./mode.js";
export {
  createModuleGraphMessage,
  decodeJsonLine,
  encodeJsonLine,
  openLoopbackJsonlServer,
  DEV_PROTOCOL_VERSION,
  DEFAULT_ENTRY,
} from "./protocol.js";
export {
  copyStandaloneBinary,
  discoverNativeBinaryName,
  resolveNativeBinary,
  runCargoRelease,
  runSpawnedCommand,
  spawnCachedNativeBinary,
} from "./commands.js";
export type * from "./protocol.js";
export type * from "./types.js";
export type { CreateKasPluginOptions } from "./plugin.js";
export default kas;
