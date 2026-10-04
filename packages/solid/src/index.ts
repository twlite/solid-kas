import { createRenderer } from "solid-js/universal";
import type { JSX } from "solid-js";

export const KasElementKind = {
  Column: 0,
  Label: 1,
  Text: 1,
  Button: 2
} as const;

export type KasElementKind = (typeof KasElementKind)[keyof typeof KasElementKind];
export type KasElementTag = "Column" | "Text" | "Label" | "Button";
export type KasClickHandler = (...args: any[]) => unknown;
export type KasDispatch = (callbackId: number, ...args: unknown[]) => unknown;

export const NO_CALLBACK_ID = 0;

/**
 * The native bridge is intentionally small. The snake_case and node-suffixed
 * method names are accepted at runtime for native bridge compatibility, while
 * the camelCase names are the public contract used by this package.
 */
export interface KasHost {
  createElement?: (kind: KasElementKind) => number;
  create_element?: (kind: KasElementKind) => number;
  createNode?: (kind: KasElementKind) => number;
  create_node?: (kind: KasElementKind) => number;
  create_element_node?: (kind: KasElementKind) => number;
  createText?: (value: string) => number;
  createTextNode?: (value: string) => number;
  create_text?: (value: string) => number;
  create_text_node?: (value: string) => number;
  insert?: (parent: number, node: number, anchor: number | null) => void;
  insertNode?: (parent: number, node: number, anchor: number | null) => void;
  insert_node?: (parent: number, node: number, anchor: number | null) => void;
  insertBefore?: (parent: number, node: number, anchor: number | null) => void;
  insert_before?: (parent: number, node: number, anchor: number | null) => void;
  remove?: (parent: number, node: number) => void;
  removeNode?: (parent: number, node: number) => void;
  remove_node?: (parent: number, node: number) => void;
  setText?: (node: number, value: string) => void;
  replaceText?: (node: number, value: string) => void;
  set_text?: (node: number, value: string) => void;
  replace_text?: (node: number, value: string) => void;
  setOnClick?: (node: number, callbackId: number) => void;
  setClick?: (node: number, callbackId: number) => void;
  setClickCallback?: (node: number, callbackId: number) => void;
  set_on_click?: (node: number, callbackId: number) => void;
  set_click?: (node: number, callbackId: number) => void;
  set_click_callback?: (node: number, callbackId: number) => void;
  dispose?: (node: number) => void;
  disposeNode?: (node: number) => void;
  disposeSubtree?: (node: number) => void;
  dispose_subtree?: (node: number) => void;
  dispose_node?: (node: number) => void;
  setProperty?: (node: number, name: string, value: unknown) => void;
  set_property?: (node: number, name: string, value: unknown) => void;
  root?: number | (() => number);
  rootHandle?: number | (() => number);
  root_handle?: number | (() => number);
  getRoot?: () => number;
  getRootHandle?: () => number;
  get_root?: () => number;
  get_root_handle?: () => number;
}

export type KasNodeKind = "root" | "element" | "text";

export interface KasNode {
  readonly handle: number;
  readonly id: number;
  readonly kind: KasNodeKind;
  readonly elementKind?: KasElementKind;
  parent: KasNode | undefined;
  children: KasNode[];
  disposed: boolean;
}

export interface KasRootNode extends KasNode {
  readonly kind: "root";
  readonly elementKind?: undefined;
}

export interface KasElementNode extends KasNode {
  readonly kind: "element";
  readonly elementKind: KasElementKind;
}

export interface KasTextNode extends KasNode {
  readonly kind: "text";
  readonly elementKind?: undefined;
}

export interface ColumnProps {
  children?: JSX.Element;
}

export interface TextProps {
  children?: JSX.Element;
}

export interface ButtonProps extends ColumnProps {
  onClick?: KasClickHandler;
}

type HostRecord = Record<string, unknown>;
type HostFunction = (...args: unknown[]) => unknown;

const hostAliases = {
  createElement: ["createElement", "create_element", "createNode", "create_node", "create_element_node"],
  createText: ["createText", "createTextNode", "create_text", "create_text_node"],
  insert: ["insert", "insertNode", "insert_node", "insertBefore", "insert_before"],
  remove: ["remove", "removeNode", "remove_node"],
  setText: ["setText", "replaceText", "set_text", "replace_text"],
  setOnClick: ["setOnClick", "setClick", "setClickCallback", "set_on_click", "set_click", "set_click_callback"],
  dispose: ["dispose", "disposeNode", "disposeSubtree", "dispose_subtree", "dispose_node"],
  root: ["getRoot", "getRootHandle", "get_root", "get_root_handle"]
} as const;

const tagKinds: Record<string, KasElementKind> = {
  Column: KasElementKind.Column,
  column: KasElementKind.Column,
  Text: KasElementKind.Text,
  text: KasElementKind.Text,
  Label: KasElementKind.Label,
  label: KasElementKind.Label,
  Button: KasElementKind.Button,
  button: KasElementKind.Button
};

let callbackByNode = new WeakMap<KasNode, number>();
let nextCallbackId = 1;
const callbacks = new Map<number, KasClickHandler>();
const rootNodes = new WeakMap<object, Map<number, KasRootNode>>();

function getHostRecord(): HostRecord {
  const host = (globalThis as typeof globalThis & { __kas?: KasHost }).__kas;
  if (host === undefined || host === null || typeof host !== "object") {
    throw new Error("@kas/solid requires a global __kas host");
  }
  return host as HostRecord;
}

function findHostMethod(host: HostRecord, names: readonly string[]): HostFunction | undefined {
  for (const name of names) {
    const candidate = host[name];
    if (typeof candidate === "function") {
      return candidate as HostFunction;
    }
  }
  return undefined;
}

function requireHostMethod(key: keyof typeof hostAliases): HostFunction {
  const host = getHostRecord();
  const method = findHostMethod(host, hostAliases[key]);
  if (method === undefined) {
    throw new Error(`__kas host is missing ${key}`);
  }
  return method.bind(host);
}

function assertSafeHandle(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${source} must return a non-negative safe integer handle`);
  }
  return value;
}

function hostCreateElement(kind: KasElementKind): number {
  return assertSafeHandle(requireHostMethod("createElement")(kind), "__kas.createElement");
}

function hostCreateText(value: string | number): number {
  return assertSafeHandle(requireHostMethod("createText")(String(value)), "__kas.createText");
}

function hostInsert(parent: number, node: number, anchor: number | null): void {
  requireHostMethod("insert")(parent, node, anchor);
}

function hostRemove(parent: number, node: number): void {
  requireHostMethod("remove")(parent, node);
}

function hostSetText(node: number, value: string): void {
  const text = String(value);
  const host = getHostRecord();
  const method = findHostMethod(host, hostAliases.setText);
  if (method !== undefined) {
    method.call(host, node, text);
    return;
  }

  const setProperty = findHostMethod(host, ["setProperty", "set_property"]);
  if (setProperty !== undefined) {
    setProperty.call(host, node, "text", text);
    return;
  }

  throw new Error("__kas host is missing setText");
}

function hostSetOnClick(node: number, callbackId: number): void {
  const host = getHostRecord();
  const method = findHostMethod(host, hostAliases.setOnClick);
  if (method !== undefined) {
    method.call(host, node, callbackId);
    return;
  }

  const setProperty = findHostMethod(host, ["setProperty", "set_property"]);
  if (setProperty !== undefined) {
    setProperty.call(host, node, "onClick", callbackId);
    return;
  }

  throw new Error("__kas host is missing setOnClick");
}

function hostDispose(node: number): void {
  requireHostMethod("dispose")(node);
}

function readRootHandle(host: HostRecord): number {
  const method = findHostMethod(host, hostAliases.root);
  if (method !== undefined) {
    return assertSafeHandle(method.call(host), "__kas.getRoot");
  }

  for (const propertyName of ["root", "rootHandle", "root_handle"]) {
    const value = host[propertyName];
    if (typeof value === "function") {
      return assertSafeHandle((value as HostFunction).call(host), `__kas.${propertyName}`);
    }
    if (value !== undefined) {
      return assertSafeHandle(value, `__kas.${propertyName}`);
    }
  }

  // A host without an explicit root uses the reserved handle zero.
  return 0;
}

function makeRootNode(handle: number): KasRootNode {
  return {
    handle,
    id: handle,
    kind: "root",
    parent: undefined,
    children: [],
    disposed: false
  };
}

function makeElementNode(handle: number, elementKind: KasElementKind): KasElementNode {
  return {
    handle,
    id: handle,
    kind: "element",
    elementKind,
    parent: undefined,
    children: [],
    disposed: false
  };
}

function makeTextNode(handle: number): KasTextNode {
  return {
    handle,
    id: handle,
    kind: "text",
    parent: undefined,
    children: [],
    disposed: false
  };
}

function assertLive(node: KasNode, source: string): void {
  if (node === undefined || node === null || typeof node !== "object") {
    throw new TypeError(`${source} requires a KAS node`);
  }
  if (node.disposed) {
    throw new Error(`${source} cannot use a disposed KAS node`);
  }
}

function detachFromParent(node: KasNode): void {
  const parent = node.parent;
  if (parent === undefined) {
    return;
  }

  const index = parent.children.indexOf(node);
  if (index >= 0) {
    parent.children.splice(index, 1);
  }
  node.parent = undefined;
}

function isAncestor(node: KasNode, possibleAncestor: KasNode): boolean {
  let current: KasNode | undefined = node;
  while (current !== undefined) {
    if (current === possibleAncestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function insertNodeImpl(parent: KasNode, node: KasNode, anchor?: KasNode | null): void {
  assertLive(parent, "insertNode parent");
  assertLive(node, "insertNode node");
  if (parent.kind === "text") {
    throw new Error("text nodes cannot have children");
  }
  if (node.kind === "root") {
    throw new Error("root nodes cannot be inserted into another node");
  }
  if (isAncestor(parent, node)) {
    throw new Error("insertNode would create a cycle");
  }

  if (anchor !== undefined && anchor !== null) {
    assertLive(anchor, "insertNode anchor");
    if (anchor.parent !== parent) {
      throw new Error("insertNode anchor is not a child of the parent");
    }
    if (anchor === node) {
      return;
    }
  }

  hostInsert(parent.handle, node.handle, anchor?.handle ?? null);

  detachFromParent(node);
  const index = anchor === undefined || anchor === null ? parent.children.length : parent.children.indexOf(anchor);
  if (index < 0) {
    throw new Error("insertNode anchor disappeared from the parent shadow tree");
  }
  parent.children.splice(index, 0, node);
  node.parent = parent;
}

function clearNodeCallback(node: KasNode): void {
  const callbackId = callbackByNode.get(node);
  if (callbackId === undefined) {
    return;
  }
  callbackByNode.delete(node);
  callbacks.delete(callbackId);
}

function collectSubtree(node: KasNode): KasNode[] {
  const result: KasNode[] = [];
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      continue;
    }
    result.push(current);
    for (const child of current.children) {
      pending.push(child);
    }
  }
  return result;
}

function disposeSubtreeImpl(node: KasNode): void {
  if (node.disposed) {
    return;
  }

  detachFromParent(node);
  const subtree = collectSubtree(node);
  for (const current of subtree) {
    clearNodeCallback(current);
    current.parent = undefined;
    current.children.length = 0;
    current.disposed = true;
  }

  hostDispose(node.handle);
}

function removeNodeImpl(parent: KasNode, node: KasNode): void {
  assertLive(parent, "removeNode parent");
  assertLive(node, "removeNode node");
  if (node.parent !== parent) {
    throw new Error("removeNode node is not a child of the parent");
  }

  hostRemove(parent.handle, node.handle);
  detachFromParent(node);
  disposeSubtreeImpl(node);
}

function replaceTextImpl(textNode: KasNode, value: string): void {
  assertLive(textNode, "replaceText");
  if (textNode.kind !== "text") {
    throw new Error("replaceText requires a text node");
  }
  hostSetText(textNode.handle, value);
}

function setPropertyImpl<T>(node: KasNode, name: string, value: T): void {
  assertLive(node, "setProperty");
  if (name === "children" || name === "ref") {
    return;
  }

  if (name === "onClick" || name === "onclick" || name === "on:click") {
    if (value === undefined || value === null || value === false) {
      clearNodeCallback(node);
      hostSetOnClick(node.handle, NO_CALLBACK_ID);
      return;
    }
    if (typeof value !== "function") {
      clearNodeCallback(node);
      hostSetOnClick(node.handle, NO_CALLBACK_ID);
      throw new TypeError("Button onClick must be a function or null");
    }

    clearNodeCallback(node);

    if (nextCallbackId >= Number.MAX_SAFE_INTEGER) {
      throw new Error("@kas/solid callback ID table is exhausted");
    }
    const callbackId = nextCallbackId++;
    callbacks.set(callbackId, value as KasClickHandler);
    callbackByNode.set(node, callbackId);
    try {
      hostSetOnClick(node.handle, callbackId);
    } catch (error) {
      callbacks.delete(callbackId);
      callbackByNode.delete(node);
      throw error;
    }
    return;
  }

  throw new Error(`@kas/solid does not support the ${name} property`);
}

function createElementImpl(tag: string): KasElementNode {
  const elementKind = tagKinds[tag];
  if (elementKind === undefined) {
    throw new Error(`@kas/solid does not support the ${tag} element`);
  }
  return makeElementNode(hostCreateElement(elementKind), elementKind);
}

function createTextImpl(value: string): KasTextNode {
  return makeTextNode(hostCreateText(value));
}

const universalRenderer = createRenderer<KasNode>({
  createElement: createElementImpl,
  createTextNode: createTextImpl,
  replaceText: replaceTextImpl,
  isTextNode: node => node.kind === "text",
  setProperty: setPropertyImpl,
  insertNode: insertNodeImpl,
  removeNode: removeNodeImpl,
  getParentNode: node => node.parent,
  getFirstChild: node => node.children[0],
  getNextSibling: node => {
    const parent = node.parent;
    if (parent === undefined) {
      return undefined;
    }
    const index = parent.children.indexOf(node);
    return index >= 0 ? parent.children[index + 1] : undefined;
  }
});

export const renderer = Object.assign(universalRenderer, {
  removeNode: removeNodeImpl,
  disposeSubtree: (node: KasNode) => disposeSubtree(node)
});
export const createElement = universalRenderer.createElement;
export const createTextNode = universalRenderer.createTextNode;
export const insertNode = universalRenderer.insertNode;
export const removeNode = renderer.removeNode;
export const setProp = universalRenderer.setProp;
export const effect = universalRenderer.effect;
export const memo = universalRenderer.memo;
export const createComponent = universalRenderer.createComponent;
export const insert = universalRenderer.insert;
export const spread = universalRenderer.spread;
export const mergeProps = universalRenderer.mergeProps;
export const use = universalRenderer.use;

export function setKasHost(host: KasHost | undefined): void {
  (globalThis as typeof globalThis & { __kas?: KasHost }).__kas = host;
}

export function getKasHost(): KasHost {
  return getHostRecord() as KasHost;
}

export function createRootNode(handle?: number): KasRootNode {
  const host = getHostRecord();
  const resolvedHandle = handle === undefined ? readRootHandle(host) : assertSafeHandle(handle, "root handle");
  let handles = rootNodes.get(host);
  if (handles === undefined) {
    handles = new Map<number, KasRootNode>();
    rootNodes.set(host, handles);
  }

  const existing = handles.get(resolvedHandle);
  if (existing !== undefined && !existing.disposed) {
    return existing;
  }

  const root = makeRootNode(resolvedHandle);
  handles.set(resolvedHandle, root);
  return root;
}

export const createRoot = createRootNode;
export const getRoot = createRootNode;

export function disposeSubtree(node: KasNode): void {
  assertLive(node, "disposeSubtree");
  if (node.parent !== undefined) {
    hostRemove(node.parent.handle, node.handle);
    detachFromParent(node);
  }
  disposeSubtreeImpl(node);
}

export function callbackCount(): number {
  return callbacks.size;
}

export function clearCallbacks(): void {
  callbacks.clear();
  callbackByNode = new WeakMap<KasNode, number>();
}

export function resetKasState(): void {
  clearCallbacks();
}

type RenderValue = JSX.Element | KasNode | null | undefined;

function isKasNode(value: unknown): value is KasNode {
  return value !== null && typeof value === "object" && "handle" in value && "kind" in value;
}

export function render(code: () => JSX.Element, root?: KasNode | number): () => void;
export function render(code: () => KasNode | null | undefined, root?: KasNode | number): () => void;
export function render(code: () => RenderValue, root?: KasNode | number): () => void {
  const container = typeof root === "number" || root === undefined ? createRootNode(root) : root;
  assertLive(container, "render root");
  if (container.kind === "text") {
    throw new Error("render requires a root or element node");
  }

  const existingChildren = new Set(container.children);
  const mountedNodes = new Set<KasNode>();
  const reactiveDisposer = universalRenderer.render(() => {
    const value = code();
    if (isKasNode(value)) {
      mountedNodes.add(value);
    }
    return value as KasNode;
  }, container);
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;

    let disposeError: unknown;
    try {
      reactiveDisposer();
    } catch (error) {
      disposeError = error;
    }

    try {
      for (const child of container.children) {
        if (!existingChildren.has(child)) {
          mountedNodes.add(child);
        }
      }
      for (const mounted of mountedNodes) {
        if (mounted.disposed) {
          continue;
        }
        if (mounted.parent === container && !container.disposed) {
          removeNodeImpl(container, mounted);
        } else {
          disposeSubtreeImpl(mounted);
        }
      }
    } finally {
      if (disposeError !== undefined) {
        throw disposeError;
      }
    }
  };
}

export const mount = render;

export function __kas_dispatch(callbackId: number, ...args: unknown[]): unknown {
  if (!Number.isSafeInteger(callbackId) || callbackId <= NO_CALLBACK_ID) {
    return undefined;
  }
  const callback = callbacks.get(callbackId);
  return callback === undefined ? undefined : callback(...args);
}

(globalThis as typeof globalThis & {
  __kas_dispatch?: typeof __kas_dispatch;
}).__kas_dispatch = __kas_dispatch;

export function Column(props: ColumnProps): JSX.Element {
  const node = universalRenderer.createElement("Column");
  universalRenderer.spread(node, props);
  return node as unknown as JSX.Element;
}

export function Text(props: TextProps): JSX.Element {
  const node = universalRenderer.createElement("Text");
  universalRenderer.spread(node, props);
  return node as unknown as JSX.Element;
}

export function Button(props: ButtonProps): JSX.Element {
  const node = universalRenderer.createElement("Button");
  universalRenderer.spread(node, props);
  return node as unknown as JSX.Element;
}

export const Label = Text;

declare global {
  function __kas_dispatch(callbackId: number, ...args: unknown[]): unknown;
  var __kas_dispose: (() => void) | undefined;

  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      Column: ColumnProps;
      Text: TextProps;
      Button: ButtonProps;
    }
  }
}
