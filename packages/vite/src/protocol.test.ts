import { once } from "node:events";
import { createConnection } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModuleGraphMessage,
  decodeJsonLine,
  encodeJsonLine,
  openLoopbackJsonlServer,
} from "./protocol.js";

describe("loopback JSON-lines protocol", () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
  });

  it("round trips one JSON value per line", () => {
    const value = { type: "ready", protocolVersion: 1 };
    expect(decodeJsonLine(encodeJsonLine(value))).toEqual(value);
  });

  it("binds to loopback and broadcasts graph messages", async () => {
    const inbound: unknown[] = [];
    const server = await openLoopbackJsonlServer({
      onMessage: (message) => inbound.push(message),
    });
    closeServer = server.close;

    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThan(0);

    const socket = createConnection({ host: server.host, port: server.port });
    await once(socket, "connect");
    socket.write(encodeJsonLine({ type: "ready", protocolVersion: 1 }));

    await vi.waitFor(() => expect(inbound).toEqual([{ type: "ready", protocolVersion: 1 }]));

    const chunks: string[] = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => chunks.push(chunk));
    const message = createModuleGraphMessage({
      generation: 3,
      entry: "/src/bootstrap.tsx",
      modules: {
        "/src/bootstrap.tsx": {
          id: "/src/bootstrap.tsx",
          code: "export {};",
          importedIds: [],
        },
      },
    });
    server.send(message);
    await vi.waitFor(() => expect(chunks.join("")).toContain('"type":"module_graph"'));
    expect(JSON.parse(chunks.join("").trim())).toEqual(message);
    socket.destroy();
  });
});
