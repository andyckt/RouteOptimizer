/**
 * Inbound integration endpoint: simulate optimize without persisting a run.
 *
 * POST /api/integrations/runs/optimize-preview
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 *
 * Validates, geocodes, and optimizes entirely in memory. No DeliveryRun is created.
 * No SMS, Kapioo sync, or dashboard entries.
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { ApiError } from "@/lib/http/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import {
  geocodeCustomersInMemory,
  computeOptimizedRouteForRun,
} from "@/lib/services/delivery-run-service";
import {
  buildPreviewRunResponse,
  buildIntegrationErrorResponse,
  type RunForResponse,
} from "@/lib/integration/buildRunIntegrationResponse";
import {
  collectPostGeocodeConstraintIssues,
  mapOptimizeErrorToIntegrationIssues,
  routeConstraintIssuesToValidationIssues,
} from "@/lib/integration/routeConstraints";
import {
  parseIntegrationRunPayload,
  type IncomingBody,
} from "@/lib/integration/parseRunPayload";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    requireIntegrationAuth(req);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `integration-optimize-preview:${ip}`,
      windowMs: 60_000,
      maxRequests: 30,
    });

    const body = (await req.json().catch(() => null)) as IncomingBody | null;
    if (!body || typeof body !== "object") {
      return json(
        {
          error: "Invalid JSON body",
          code: "BAD_REQUEST",
          preview: true,
          persisted: false,
          validation_errors: [],
        },
        { status: 400 }
      );
    }

    const parsed = parseIntegrationRunPayload(body);
    const { errors, warnings, run, meta, sanitizedCustomers } = parsed;

    if (errors.length > 0 || !run || !sanitizedCustomers) {
      const hasFieldErrors = errors.some(
        (e) =>
          e.field?.startsWith("run.") ||
          e.field === "customers" ||
          e.field?.endsWith(".name") ||
          e.field?.endsWith(".address") ||
          e.field?.endsWith(".service_time_minutes")
      );
      return json(
        {
          ...buildIntegrationErrorResponse({
            code: "VALIDATION_ERROR",
            error: hasFieldErrors ? "Validation failed" : "Route constraint validation failed",
            validation_errors: errors,
            warnings,
            run_created_as_draft: false,
            runId: null,
          }),
          preview: true,
          persisted: false,
        },
        { status: 422 }
      );
    }

    const { customers: geocoded, failures: geocodeFailures } =
      await geocodeCustomersInMemory(sanitizedCustomers);

    if (geocodeFailures.length > 0) {
      return json(
        {
          ...buildIntegrationErrorResponse({
            code: "GEOCODE_FAILED",
            error: "Geocoding failed for one or more customers",
            validation_errors: [],
            geocode_failures: geocodeFailures,
            warnings,
            run_created_as_draft: false,
            runId: null,
          }),
          preview: true,
          persisted: false,
        },
        { status: 422 }
      );
    }

    const postGeocodeIssues = await collectPostGeocodeConstraintIssues(geocoded, {
      end_location: run.end_location,
    });
    if (postGeocodeIssues.length > 0) {
      return json(
        {
          ...buildIntegrationErrorResponse({
            code: "VALIDATION_ERROR",
            error: "Route constraint validation failed after geocoding",
            validation_errors: routeConstraintIssuesToValidationIssues(postGeocodeIssues),
            warnings,
            run_created_as_draft: false,
            runId: null,
          }),
          preview: true,
          persisted: false,
        },
        { status: 422 }
      );
    }

    try {
      const { optimizedRoute } = await computeOptimizedRouteForRun(run, geocoded);

      return json(
        buildPreviewRunResponse(
          {
            run_date: run.run_date,
            start_time: run.start_time,
            status: "preview",
            planning_session_id: meta.planning_session_id,
            external_id: meta.external_id,
            idempotency_key: meta.idempotency_key,
            optimized_route: optimizedRoute as RunForResponse["optimized_route"],
          },
          { warnings }
        ),
        { status: 200 }
      );
    } catch (err) {
      const { code, issues } = mapOptimizeErrorToIntegrationIssues(err, geocoded);
      if (err instanceof ApiError) {
        return json(
          {
            ...buildIntegrationErrorResponse({
              code,
              error: "Optimization failed",
              validation_errors: issues,
              warnings,
              run_created_as_draft: false,
              runId: null,
            }),
            preview: true,
            persisted: false,
          },
          { status: err.statusCode }
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
