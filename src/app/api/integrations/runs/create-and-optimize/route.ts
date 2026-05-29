/**
 * Inbound machine-to-machine endpoint: create + optimize a single delivery run.
 *
 * POST /api/integrations/runs/create-and-optimize
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import { createAndOptimizeIntegrationRun } from "@/lib/integration/createAndOptimizeIntegrationRun";
import type { IncomingBody } from "@/lib/integration/parseRunPayload";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    requireIntegrationAuth(req);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `integration-create-optimize:${ip}`,
      windowMs: 60_000,
      maxRequests: 20,
    });

    const origin = req.nextUrl.origin;
    const body = (await req.json().catch(() => null)) as IncomingBody | null;
    if (!body || typeof body !== "object") {
      return json(
        { error: "Invalid JSON body", code: "BAD_REQUEST", validation_errors: [] },
        { status: 400 }
      );
    }

    const result = await createAndOptimizeIntegrationRun(body, { origin });
    return json(result.body, { status: result.httpStatus });
  } catch (err) {
    return handleApiError(err);
  }
}
