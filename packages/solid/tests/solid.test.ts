import { createComponent, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Button,
  Column,
  Text,
  __kas_dispatch,
  callbackCount,
  createRootNode,
  removeNode,
  render,
  renderer,
  resetKasState,
  setKasHost,
  type KasElementKind,
  type KasNode
} from "../src/index";

type FakeRecord = {
  kind: "root" | "element" | "text";
  elementKind?: KasElementKind;
  text?: string;
  parent: number | null;
  children: number[];
  callbackId: number;
  disposed: boolean;
};

class FakeKasHost {
  readonly root = 0;
  readonly records = new Map<number, FakeRecord>([
    [0, { kind: "root", parent: null, children: [], callbackId: 0, disposed: false }]
  ]);
  readonly disposed: number[] = [];
  private nextHandle = 1;

  createElement(elementKind: KasElementKind): number {
    const handle = this.nextHandle++;
    this.records.set(handle, {
      kind: "element",
      elementKind,
      parent: null,
      children: [],
      callbackId: 0,
      disposed: false
    });
    return handle;
  }

  createText(text: string): number {
    const handle = this.nextHandle++;
    this.records.set(handle, {
      kind: "text",
      text,
      parent: null,
      children: [],
      callbackId: 0,
      disposed: false
    });
    return handle;
  }

  insert(parentHandle: number, nodeHandle: number, anchor: number | null): void {
    const parent = this.record(parentHandle);
    const node = this.record(nodeHandle);
    if (node.parent !== null) {
      const oldParent = this.record(node.parent);
      oldParent.children = oldParent.children.filter(child => child !== nodeHandle);
    }
    const index = anchor === null ? parent.children.length : parent.children.indexOf(anchor);
    if (index < 0) {
      throw new Error("fake anchor is not a child");
    }
    parent.children.splice(index, 0, nodeHandle);
    node.parent = parentHandle;
  }

  remove(parentHandle: number, nodeHandle: number): void {
    const parent = this.record(parentHandle);
    parent.children = parent.children.filter(child => child !== nodeHandle);
    this.record(nodeHandle).parent = null;
  }

  setText(nodeHandle: number, text: string): void {
    this.record(nodeHandle).text = text;
  }

  setOnClick(nodeHandle: number, callbackId: number): void {
    this.record(nodeHandle).callbackId = callbackId;
  }

  dispose(nodeHandle: number): void {
    const node = this.record(nodeHandle);
    for (const child of [...node.children]) {
      this.dispose(child);
    }
    node.children = [];
    node.disposed = true;
    if (node.parent !== null) {
      const parent = this.record(node.parent);
      parent.children = parent.children.filter(child => child !== nodeHandle);
      node.parent = null;
    }
    this.disposed.push(nodeHandle);
  }

  private record(handle: number): FakeRecord {
    const record = this.records.get(handle);
    if (record === undefined) {
      throw new Error(`unknown fake handle ${handle}`);
    }
    return record;
  }
}

let host: FakeKasHost;

beforeEach(() => {
  host = new FakeKasHost();
  setKasHost(host);
  resetKasState();
});

afterEach(() => {
  resetKasState();
  setKasHost(undefined);
});

function recordFor(node: KasNode): FakeRecord {
  const record = host.records.get(node.handle);
  if (record === undefined) {
    throw new Error(`missing fake record ${node.handle}`);
  }
  return record;
}

describe("@kas/solid", () => {
  it("mounts Column, Text, and Button through the numeric host", () => {
    let clicked = 0;
    let button: KasNode | undefined;

    const dispose = render(() => {
      const text = createComponent(Text, { children: "hello" });
      const buttonValue = createComponent(Button, {
        children: "press",
        onClick: () => {
          clicked += 1;
        }
      });
      button = buttonValue as unknown as KasNode;
      return createComponent(Column, { children: [text, buttonValue] });
    });

    const root = host.records.get(host.root);
    expect(root?.children).toHaveLength(1);
    const column = root === undefined ? undefined : host.records.get(root.children[0]);
    const columnHandle = root?.children[0];
    expect(column?.elementKind).toBe(0);
    expect(column?.children).toHaveLength(2);
    expect(button).toBeDefined();
    const buttonRecord = recordFor(button as KasNode);
    expect(buttonRecord.elementKind).toBe(2);
    expect(buttonRecord.callbackId).toBeGreaterThan(0);

    const labelHandle = column?.children[0];
    const label = labelHandle === undefined ? undefined : host.records.get(labelHandle);
    const textHandle = label?.children[0];
    expect(textHandle).toBeDefined();
    expect(host.records.get(textHandle as number)?.text).toBe("hello");

    __kas_dispatch(buttonRecord.callbackId);
    expect(clicked).toBe(1);

    dispose();
    expect(host.records.get(host.root)?.children).toHaveLength(0);
    expect(columnHandle).toBeDefined();
    expect(host.records.get(columnHandle as number)?.disposed).toBe(true);
    expect(callbackCount()).toBe(0);
    __kas_dispatch(buttonRecord.callbackId);
    expect(clicked).toBe(1);

    dispose();
    expect(host.disposed.filter(handle => handle === columnHandle)).toHaveLength(1);
  });

  it("updates text and callback IDs through Solid effects", () => {
    const [value, setValue] = createSignal("one");
    const [handler, setHandler] = createSignal<() => void>(() => undefined);
    let text: KasNode | undefined;
    let button: KasNode | undefined;

    const dispose = render(() => {
      const textValue = createComponent(Text, { get children() { return value(); } });
      const buttonValue = createComponent(Button, {
        children: "run",
        get onClick() {
          return handler();
        }
      });
      text = textValue as unknown as KasNode;
      button = buttonValue as unknown as KasNode;
      return createComponent(Column, { children: [textValue, buttonValue] });
    });

    const label = recordFor(text as KasNode);
    const textHandle = label.children[0];
    expect(host.records.get(textHandle)?.text).toBe("one");
    setValue("two");
    expect(host.records.get(textHandle)?.text).toBe("two");

    const firstCallbackId = recordFor(button as KasNode).callbackId;
    let calls = 0;
    setHandler(() => () => {
      calls += 1;
    });
    const secondCallbackId = recordFor(button as KasNode).callbackId;
    expect(secondCallbackId).not.toBe(firstCallbackId);
    expect(callbackCount()).toBe(1);
    __kas_dispatch(firstCallbackId);
    expect(calls).toBe(0);
    __kas_dispatch(secondCallbackId);
    expect(calls).toBe(1);

    dispose();
  });

  it("maintains shadow parent and child relations for moves", () => {
    const parent = renderer.createElement("Column");
    const first = renderer.createElement("Text");
    const second = renderer.createElement("Text");

    renderer.insertNode(parent, first);
    renderer.insertNode(parent, second);
    expect(first.parent).toBe(parent);
    expect(parent.children).toEqual([first, second]);

    renderer.insertNode(parent, second, first);
    expect(parent.children).toEqual([second, first]);
    expect(() => renderer.insertNode(first, parent)).toThrow(/cycle/);

    removeNode(parent, second);
    expect(second.disposed).toBe(true);
    expect(second.parent).toBeUndefined();
    expect(parent.children).toEqual([first]);
  });
});
