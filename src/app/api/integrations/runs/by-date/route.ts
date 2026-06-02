/**
 * Inbound integration endpoint: read-only historical runs for one delivery date.
 *
 * GET /api/integrations/runs/by-date?date=YYYY-MM-DD
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import { parseRunsByDateQuery } from "@/lib/integration/parseRunsByDateQuery";
import { fetchRunsByDate } from "@/lib/integration/fetchRunsByDate";

export const dynamic = "force-dynamic";

const INTEGRATION_RATE_LIMIT_WINDOW_MS = 60_000;
const INTEGRATION_RATE_LIMIT_MAX = 30;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function GET(req: NextRequest) {
  try {
    requireIntegrationAuth(req);

    assertRateLimit({
      key: `integration-runs-by-date:${clientIp(req)}`,
      windowMs: INTEGRATION_RATE_LIMIT_WINDOW_MS,
      maxRequests: INTEGRATION_RATE_LIMIT_MAX,
    });

    const parsed = parseRunsByDateQuery(req.nextUrl.searchParams);
    const response = await fetchRunsByDate(parsed);
    return json(response);
  } catch (err) {
    return handleApiError(err);
  }
}
