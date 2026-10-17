import { NextResponse } from "next/server";
import { buildOpenApi } from "@/server/api-v1/openapi";
import { baseUrl } from "@/server/api-v1/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/openapi.json — public OpenAPI 3.1 document. */
export function GET(): NextResponse {
  return NextResponse.json(buildOpenApi(baseUrl()), { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}
