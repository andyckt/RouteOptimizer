/**
 * Inbound machine-to-machine endpoint: create + optimize a single delivery run.
 *
 * POST /api/integrations/runs/create-and-optimize
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 *
 * Reuses the same create/geocode/optimize logic as the admin flows via the shared
 * service. Does NOT change SMS, Kapioo sync, service-time, or synthetic-stop behavior.
 */

import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { ApiError } from "@/lib/http/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import {
  createDeliveryRunFromPayload,
  geocodeRunCustomers,
  optimizeDeliveryRunById,
  type DeliveryRunDoc,
} from "@/lib/services/delivery-run-service";
import {
  buildRunIntegrationResponse,
  buildIntegrationErrorResponse,
  type RunForResponse,
  type ValidationIssue,
} from "@/lib/integration/buildRunIntegrationResponse";
import type { DeliveryCustomer, TravelMode } from "@/types/delivery-run";
import { isSyntheticStop, validateServiceTimeMinutes } from "@/lib/stops/synthetic";
import { sanitizeCustomers } from "@/lib/normalization/delivery-run";
import { collectRouteConstraintIssues } from "@/lib/validation/fixed-stop-position";
import {
  collectPostGeocodeConstraintIssues,
  mapOptimizeErrorToIntegrationIssues,
  normalizeIntegrationCustomerFlags,
  routeConstraintIssuesToValidationIssues,
} from "@/lib/integration/routeConstraints";

export const dynamic = "force-dynamic";

const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const START_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

interface IncomingCustomer {
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  [k: string]: unknown;
}

interface IncomingRun {
  run_date?: unknown;
  driver_name?: unknown;
  start_location?: unknown;
  end_location?: unknown;
  start_time?: unknown;
  travel_mode?: unknown;
}

interface IncomingBody {
  idempotency_key?: unknown;
  external_id?: unknown;
  planning_session_id?: unknown;
  created_by_integration?: unknown;
  run?: IncomingRun;
  customers?: IncomingCustomer[];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function hasValidCoords(c: IncomingCustomer): boolean {
  const lat = asNumber(c.lat);
  const lng = asNumber(c.lng);
  return lat !== undefined && lng !== undefined;
}

/** Integration-only: default geocode_status when coords are provided without status. */
function normalizeIntegrationCustomers(
  customers: IncomingCustomer[]
): IncomingCustomer[] {
  return customers.map((c) => {
    const next = normalizeIntegrationCustomerFlags(c);
    if (hasValidCoords(next) && next.geocode_status === undefined) {
      next.geocode_status = "success";
    }
    return next;
  });
}

function runDocForResponse(run: DeliveryRunDoc): RunForResponse {
  const obj = run.toObject() as unknown as RunForResponse;
  return obj;
}

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

    const idempotency_key = asString(body.idempotency_key)?.trim() || undefined;
    const external_id = asString(body.external_id)?.trim() || undefined;
    const planning_session_id =
      asString(body.planning_session_id)?.trim() || undefined;
    const created_by_integration =
      asString(body.created_by_integration)?.trim() || undefined;

    // ---- Validation ----
    const errors: ValidationIssue[] = [];
    const warnings: string[] = [];
    const run = body.run ?? {};
    const customers = Array.isArray(body.customers) ? body.customers : [];

    const run_date = asString(run.run_date)?.trim() ?? "";
    const start_time = asString(run.start_time)?.trim() ?? "";
    const start_location = asString(run.start_location)?.trim() ?? "";
    const travel_modeRaw = asString(run.travel_mode)?.trim();

    if (!run_date) errors.push({ field: "run.run_date", message: "run_date is required." });
    else if (!RUN_DATE_RE.test(run_date))
      errors.push({ field: "run.run_date", message: "run_date must be YYYY-MM-DD." });

    if (!start_time) errors.push({ field: "run.start_time", message: "start_time is required." });
    else if (!START_TIME_RE.test(start_time))
      errors.push({ field: "run.start_time", message: "start_time must be HH:MM (24h)." });

    if (!start_location)
      errors.push({ field: "run.start_location", message: "start_location is required." });

    if (travel_modeRaw && travel_modeRaw !== "driving" && travel_modeRaw !== "ebike")
      errors.push({ field: "run.travel_mode", message: 'travel_mode must be "driving" or "ebike".' });

    if (customers.length === 0)
      errors.push({ field: "customers", message: "At least one customer is required." });

    customers.forEach((c, i) => {
      const name = asString(c?.name)?.trim();
      if (!name)
        errors.push({ field: `customers[${i}].name`, message: "name is required." });

      const isSynthetic = isSyntheticStop(c as Parameters<typeof isSyntheticStop>[0]);
      const address = asString(c?.address)?.trim();
      if (!isSynthetic && !address) {
        errors.push({ field: `customers[${i}].address`, message: "address is required." });
      }
      if (isSynthetic && !address && !hasValidCoords(c)) {
        errors.push({
          field: `customers[${i}].address`,
          message: "handoff stop requires address or valid lat/lng coordinates.",
        });
      }

      const phone = asString(c?.phone)?.trim();
      if (!phone && !isSynthetic) {
        warnings.push(`customers[${i}] (${name ?? "unnamed"}) has no phone; SMS/ETA will be skipped for this stop.`);
      }

      const serviceTimeResult = validateServiceTimeMinutes(c?.service_time_minutes, {
        isSynthetic,
      });
      if (!serviceTimeResult.ok) {
        errors.push({
          field: `customers[${i}].service_time_minutes`,
          message: serviceTimeResult.message,
        });
      }
    });

    if (errors.length > 0) {
      return json(
        buildIntegrationErrorResponse({
          code: "VALIDATION_ERROR",
          error: "Validation failed",
          validation_errors: errors,
          warnings,
          run_created_as_draft: false,
          runId: null,
        }),
        { status: 422 }
      );
    }

    const normalizedCustomers = normalizeIntegrationCustomers(customers);
    let sanitizedCustomers: DeliveryCustomer[];
    try {
      sanitizedCustomers = sanitizeCustomers(
        normalizedCustomers as Array<DeliveryCustomer | Record<string, unknown>>
      );
    } catch (sanitizeErr) {
      if (sanitizeErr instanceof ApiError) {
        return json(
          buildIntegrationErrorResponse({
            code: sanitizeErr.code ?? "VALIDATION_ERROR",
            error: "Route constraint validation failed",
            validation_errors: [{ message: sanitizeErr.message }],
            warnings,
            run_created_as_draft: false,
            runId: null,
          }),
          { status: sanitizeErr.statusCode }
        );
      }
      throw sanitizeErr;
    }

    const preCreateConstraintIssues = collectRouteConstraintIssues(sanitizedCustomers);
    if (preCreateConstraintIssues.length > 0) {
      return json(
        buildIntegrationErrorResponse({
          code: "VALIDATION_ERROR",
          error: "Route constraint validation failed",
          validation_errors: routeConstraintIssuesToValidationIssues(
            preCreateConstraintIssues
          ),
          warnings,
          run_created_as_draft: false,
          runId: null,
        }),
        { status: 422 }
      );
    }

    // ---- Idempotency ----
    await connectDB();
    if (idempotency_key || external_id) {
      const query = idempotency_key ? { idempotency_key } : { external_id };
      const existing = await DeliveryRunModel.findOne(query);
      if (existing) {
        const existingExternal =
          (existing.get("external_id") as string | undefined) ?? undefined;
        const conflict =
          existing.run_date !== run_date ||
          (external_id !== undefined &&
            existingExternal !== undefined &&
            existingExternal !== external_id);
        if (conflict) {
          return json(
            {
              error:
                "An existing run was found for this key but the payload conflicts with it.",
              code: "IDEMPOTENCY_CONFLICT",
              run_id: existing._id.toString(),
            },
            { status: 409 }
          );
        }
        return json(
          buildRunIntegrationResponse(runDocForResponse(existing), {
            runId: existing._id.toString(),
            origin,
            warnings: ["Returned existing run (idempotent replay); no new run created."],
          }),
          { status: 200 }
        );
      }
    }

    // ---- Create ----
    const created = await createDeliveryRunFromPayload({
      run_date,
      driver_name: asString(run.driver_name) ?? "",
      start_location,
      end_location: asString(run.end_location) || undefined,
      start_time,
      travel_mode: (travel_modeRaw as TravelMode | undefined) ?? "driving",
      customers: normalizedCustomers,
      planning_session_id,
      external_id,
      idempotency_key,
      created_by_integration,
    });
    const runId = created._id.toString();

    // ---- Geocode ----
    const geocodeFailures = await geocodeRunCustomers(created);
    if (geocodeFailures.length > 0) {
      return json(
        buildIntegrationErrorResponse({
          code: "GEOCODE_FAILED",
          error: "Geocoding failed for one or more customers",
          validation_errors: [],
          geocode_failures: geocodeFailures,
          warnings: [
            ...warnings,
            "Run created as draft but not optimized due to geocode failures.",
          ],
          run_created_as_draft: true,
          runId,
          run: runDocForResponse(created),
          origin,
        }),
        { status: 422 }
      );
    }

    const postGeocodeIssues = await collectPostGeocodeConstraintIssues(
      JSON.parse(JSON.stringify(created.customers ?? [])) as DeliveryCustomer[],
      { end_location: created.end_location }
    );
    if (postGeocodeIssues.length > 0) {
      return json(
        buildIntegrationErrorResponse({
          code: "VALIDATION_ERROR",
          error: "Route constraint validation failed after geocoding",
          validation_errors: routeConstraintIssuesToValidationIssues(postGeocodeIssues),
          warnings,
          run_created_as_draft: true,
          runId,
          run: runDocForResponse(created),
          origin,
        }),
        { status: 422 }
      );
    }

    // ---- Optimize ----
    try {
      const optimized = await optimizeDeliveryRunById(runId);
      return json(
        buildRunIntegrationResponse(runDocForResponse(optimized), {
          runId,
          origin,
          warnings,
        }),
        { status: 201 }
      );
    } catch (err) {
      const customersAfterCreate = JSON.parse(
        JSON.stringify(created.customers ?? [])
      ) as DeliveryCustomer[];
      const { code, issues } = mapOptimizeErrorToIntegrationIssues(
        err,
        customersAfterCreate
      );
      if (err instanceof ApiError) {
        return json(
          buildIntegrationErrorResponse({
            code,
            error: "Optimization failed",
            validation_errors: issues,
            warnings: [
              ...warnings,
              "Run created as draft but optimization failed.",
            ],
            run_created_as_draft: true,
            runId,
            run: runDocForResponse(created),
            origin,
          }),
          { status: err.statusCode }
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
