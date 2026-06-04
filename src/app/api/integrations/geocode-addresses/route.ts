/**
 * Inbound integration endpoint: batch geocode addresses without creating route runs.
 *
 * POST /api/integrations/geocode-addresses
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { ApiError } from "@/lib/http/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import { parseGeocodeAddressesPayload } from "@/lib/integration/parseGeocodeAddressesPayload";
import {
  geocodeAddressesBatch,
  GEOCODE_RATE_LIMIT_RETRY_SECONDS,
} from "@/lib/integration/geocodeAddressesBatch";
import {
  estimateGeocodeAddressGoogleApiCost,
  geocodeAddressBudgetViolations,
  logGoogleApiCostEstimate,
  GOOGLE_API_BUDGET_EXCEEDED_CODE,
} from "@/lib/integration/googleApiBudget";

export const dynamic = "force-dynamic";

const INTEGRATION_RATE_LIMIT_WINDOW_MS = 60_000;
const INTEGRATION_RATE_LIMIT_MAX = 20;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  try {
    requireIntegrationAuth(req);

    assertRateLimit({
      key: `integration-geocode-addresses:${clientIp(req)}`,
      windowMs: INTEGRATION_RATE_LIMIT_WINDOW_MS,
      maxRequests: INTEGRATION_RATE_LIMIT_MAX,
    });

    const body = await req.json().catch(() => null);
    const parsed = parseGeocodeAddressesPayload(body);

    if (parsed.errors.length > 0) {
      return json(
        {
          error: "Validation failed",
          code: "VALIDATION_ERROR",
          errors: parsed.errors,
        },
        { status: 400 }
      );
    }

    const googleCostEstimate = estimateGeocodeAddressGoogleApiCost(
      parsed.payload!.addresses.length
    );
    const budgetIssues = geocodeAddressBudgetViolations(googleCostEstimate);
    if (budgetIssues.length > 0) {
      return json(
        {
          error: "Google API budget exceeded",
          code: GOOGLE_API_BUDGET_EXCEEDED_CODE,
          errors: budgetIssues,
          google_cost_estimate: googleCostEstimate,
        },
        { status: 422 }
      );
    }

    logGoogleApiCostEstimate({
      event: "integration_geocode_addresses_google_cost_estimate",
      estimate: googleCostEstimate,
      idempotency_key: parsed.payload!.idempotency_key,
    });

    const response = await geocodeAddressesBatch(parsed.payload!.addresses);
    return json({ ...response, google_cost_estimate: googleCostEstimate });
  } catch (err) {
    if (err instanceof ApiError && err.code === "RATE_LIMITED") {
      return json(
        {
          error: err.message,
          code: err.code,
          retry_after_seconds: GEOCODE_RATE_LIMIT_RETRY_SECONDS,
        },
        {
          status: 429,
          headers: { "Retry-After": String(GEOCODE_RATE_LIMIT_RETRY_SECONDS) },
        }
      );
    }
    return handleApiError(err);
  }
}
