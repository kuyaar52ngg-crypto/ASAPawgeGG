// Bundles the MCP server into dist/ (ESM, Node >= 22). Workspace packages (@asap/shared, TS sources) are inlined;
// the MCP SDK and zod stay external and are resolved from node_modules at runtime.
import { build } from "esbuild";

await build({
  entryPoints: { http: "src/http.ts", stdio: "src/stdio.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"],
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
