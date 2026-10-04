import { createServer, type AddressInfo, type Server, type Socket } from "node:net";

export const DEV_PROTOCOL_VERSION = 1;
export const DEFAULT_ENTRY = "/src/bootstrap.tsx";

export interface TransformedModule {
  id: string;
  code: string;
  importedIds: string[];
}

export interface ModuleGraphPayload {
  version: typeof DEV_PROTOCOL_VERSION;
  generation: number;
  entry: string;
  modules: Record<string, TransformedModule>;
}

export interface ModuleGraphMessage {
  type: "module_graph";
  graph: ModuleGraphPayload;
}

export interface ReadyMessage {
  type: "ready";
  protocolVersion?: number;
}

export interface LogMessage {
  type: "log";
  level?: "debug" | "info" | "warn" | "error";
  message?: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type HostToNativeMessage = ModuleGraphMessage;
export type NativeToHostMessage = ReadyMessage | LogMessage | ErrorMessage;

export type JsonLineListener<T> = (message: T, socket: Socket) => void;

export function encodeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function decodeJsonLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  return JSON.parse(trimmed) as unknown;
}

export function isNativeToHostMessage(value: unknown): value is NativeToHostMessage {
  if (!value || typeof value !== "object" || !("type" in value)) {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  if (type === "ready" || type === "log") {
    return true;
  }
  return type === "error" && typeof (value as { message?: unknown }).message === "string";
}

export interface LoopbackJsonlOptions<TInbound = unknown> {
  port?: number;
  onMessage?: JsonLineListener<TInbound>;
  onClient?: (socket: Socket) => void;
}

export interface LoopbackJsonlServer<TOutbound = unknown> {
  server: Server;
  host: "127.0.0.1";
  port: number;
  address: string;
  clients: ReadonlySet<Socket>;
  send(message: TOutbound): void;
  close(): Promise<void>;
}

function addressInfo(server: Server): AddressInfo {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The loopback protocol server did not receive a TCP address");
  }
  return address;
}

/**
 * Opens the host side of the development protocol. It binds only to the
 * IPv4 loopback address and keeps one JSON value per line on each connection.
 */
export async function openLoopbackJsonlServer<
  TInbound = unknown,
  TOutbound = unknown,
>(options: LoopbackJsonlOptions<TInbound> = {}): Promise<LoopbackJsonlServer<TOutbound>> {
  const server = createServer();
  const clients = new Set<Socket>();
  const buffers = new Map<Socket, string>();

  server.on("connection", (socket) => {
    clients.add(socket);
    buffers.set(socket, "");
    options.onClient?.(socket);

    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      const previous = buffers.get(socket) ?? "";
      const lines = `${previous}${chunk}`.split("\n");
      buffers.set(socket, lines.pop() ?? "");

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        let parsed: unknown;
        try {
          parsed = decodeJsonLine(line);
        } catch {
          socket.destroy(new Error("Invalid JSON line from native host"));
          return;
        }
        options.onMessage?.(parsed as TInbound, socket);
      }
    });

    const remove = () => {
      clients.delete(socket);
      buffers.delete(socket);
    };
    socket.on("close", remove);
    socket.on("error", remove);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port ?? 0, "127.0.0.1");
  });

  const { port } = addressInfo(server);
  const send = (message: TOutbound) => {
    const line = encodeJsonLine(message);
    for (const socket of clients) {
      if (!socket.destroyed && socket.writable) {
        socket.write(line);
      }
    }
  };

  return {
    server,
    host: "127.0.0.1",
    port,
    address: `127.0.0.1:${port}`,
    clients,
    send,
    close: async () => {
      for (const socket of clients) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function createModuleGraphMessage(
  graph: Omit<ModuleGraphPayload, "version">,
): ModuleGraphMessage {
  return {
    type: "module_graph",
    graph: {
      version: DEV_PROTOCOL_VERSION,
      ...graph,
    },
  };
}
