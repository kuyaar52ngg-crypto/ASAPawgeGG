import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { extractKey, KeyVerifier } from "./auth";
import { resolveApiBase, resolvePort, SERVER_NAME, SERVER_VERSION } from "./config";
import { createServer } from "./server";

const MAX_BODY = 1_000_000;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("too_large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Caller address for per-caller rate limiting upstream: last X-Forwarded-For entry (appended by our reverse proxy), else the socket peer. */
export function callerIp(req: IncomingMessage): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  const raw = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").map((s) => s.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress;
  return raw && /^[0-9a-fA-F:.]{2,45}$/.test(raw) ? raw : undefined;
}

export function createHttpApp(apiBase = resolveApiBase()) {
  const verifier = new KeyVerifier(apiBase);

  return createHttpServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/health") return send(res, 200, { status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
    if (path !== "/mcp") return send(res, 404, { error: "not_found" });
    // stateless transport: only POST carries JSON-RPC; no server-initiated streams (GET) and no sessions (DELETE)
    if (req.method !== "POST") return send(res, 405, rpcError(-32000, "Method not allowed. Use POST /mcp (Streamable HTTP, stateless)."), { allow: "POST" });

    const auth = await verifier.verify(extractKey(req.headers), callerIp(req));
    if (!auth.ok) {
      return send(res, auth.status === 502 ? 502 : auth.status, rpcError(-32001, auth.message), auth.status === 401 ? { "www-authenticate": 'Bearer realm="asapawge-mcp"' } : {});
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      return send(res, (e as Error).message === "too_large" ? 413 : 400, rpcError(-32700, "Invalid JSON body"));
    }

    // a fresh server + transport per request: tools are scoped to THIS caller's key and nothing is shared between callers
    const server = createServer(auth.client, auth.me);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      console.error("[mcp] request failed:", (e as Error).message);
      if (!res.headersSent) send(res, 500, rpcError(-32603, "Internal error"));
    }
  });
}

if (import.meta.main ?? process.argv[1]?.match(/(?:^|[\\/])http\.(?:ts|js)$/)) {
  const port = resolvePort();
  createHttpApp().listen(port, () => console.log(`[mcp] Streamable HTTP listening on :${port}/mcp -> ${resolveApiBase()}`));
}
