import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { extractKey, KeyVerifier } from "./auth";
import { resolveApiBase } from "./config";
import { createServer } from "./server";

/** stdio entry (Claude Desktop & co): the API key comes from ASAP_API_KEY; stdout is reserved for the protocol, logs go to stderr. */
const key = extractKey({ authorization: `Bearer ${process.env.ASAP_API_KEY ?? ""}` });
const auth = await new KeyVerifier(resolveApiBase()).verify(key);
if (!auth.ok) {
  console.error(`[asapawge-mcp] ${auth.message}${key ? "" : " (переменная окружения ASAP_API_KEY не задана или имеет неверный формат)"}`);
  process.exit(1);
}
await createServer(auth.client, auth.me).connect(new StdioServerTransport());
console.error(`[asapawge-mcp] ready as ${auth.me.role} (${auth.me.scopes.length} scopes)`);
