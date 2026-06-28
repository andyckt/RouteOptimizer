/**
 * Shared create + geocode + optimize pipeline for integration endpoints.
 */

import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { ApiError } from "@/lib/http/errors";
import {
  createDeliveryRunFromPayload,
  geocodeRunCustomers,
  optimizeDeliveryRunById,
  type DeliveryRunDoc,
} from "@/lib/services/delivery-run-service";
import {
  buildRunIntegrationResponse,
  buildIntegrationErrorResponse,
  type IntegrationRunResponse,
  type RunForResponse,
} from "@/lib/integration/buildRunIntegrationResponse";
import type { DeliveryCustomer } from "@/types/delivery-run";
import {
  collectPostGeocodeConstraintIssues,
  mapOptimizeErrorToIntegrationIssues,
  routeConstraintIssuesToValidationIssues,
} from "@/lib/integration/routeConstraints";
import {
  parseIntegrationRunPayload,
  type IncomingBody,
} from "@/lib/integration/parseRunPayload";
import {
  estimateRunGoogleApiCost,
  googleApiBudgetViolations,
  logGoogleApiCostEstimate,
  GOOGLE_API_BUDGET_EXCEEDED_CODE,
} from "@/lib/integration/googleApiBudget";
import { enrichCustomersWithBoxCounts } from "@/lib/kapioo/order-box-counts";

export type CreateAndOptimizeItemStatus = "success" | "replayed" | "failed";

export interface IdempotencyConflictBody {
  error: string;
  code: "IDEMPOTENCY_CONFLICT";
  run_id: string;
}

export type CreateAndOptimizeRunBody = IntegrationRunResponse | IdempotencyConflictBody;

export interface CreateAndOptimizeRunResult {
  itemStatus: CreateAndOptimizeItemStatus;
  httpStatus: number;
  body: CreateAndOptimizeRunBody;
  driver_name: string;
}

function runDocForResponse(run: DeliveryRunDoc): RunForResponse {
  return run.toObject() as unknown as RunForResponse;
}

function failedFromIntegrationResponse(
  response: IntegrationRunResponse,
  driverName: string,
  httpStatus: number
): CreateAndOptimizeRunResult {
  return {
    itemStatus: "failed",
    httpStatus,
    body: response,
    driver_name: driverName,
  };
}

function successFromIntegrationResponse(
  response: IntegrationRunResponse,
  driverName: string,
  itemStatus: "success" | "replayed",
  httpStatus: number
): CreateAndOptimizeRunResult {
  return {
    itemStatus,
    httpStatus,
    body: response,
    driver_name: driverName,
  };
}

export interface CreateAndOptimizeIntegrationRunOptions {
  origin: string;
}

/**
 * Creates and optimizes one integration run (same behavior as create-and-optimize route).
 */
export async function createAndOptimizeIntegrationRun(
  body: IncomingBody,
  opts: CreateAndOptimizeIntegrationRunOptions
): Promise<CreateAndOptimizeRunResult> {
  const { origin } = opts;
  const parsed = parseIntegrationRunPayload(body);
  const { errors, warnings, run, meta } = parsed;
  const driverName = run?.driver_name ?? "";

  if (errors.length > 0 || !run || !parsed.sanitizedCustomers) {
    const hasFieldErrors = errors.some(
      (e) =>
        e.field?.startsWith("run.") ||
        e.field === "customers" ||
        e.field?.endsWith(".name") ||
        e.field?.endsWith(".address") ||
        e.field?.endsWith(".service_time_minutes")
    );
    return failedFromIntegrationResponse(
      buildIntegrationErrorResponse({
        code: "VALIDATION_ERROR",
        error: hasFieldErrors ? "Validation failed" : "Route constraint validation failed",
        validation_errors: errors,
        warnings,
        run_created_as_draft: false,
        runId: null,
      }),
      driverName,
      422
    );
  }

  const {
    idempotency_key,
    external_id,
    planning_session_id,
    created_by_integration,
  } = meta;

  await connectDB();
  if (idempotency_key || external_id) {
    const query = idempotency_key ? { idempotency_key } : { external_id };
    const existing = await DeliveryRunModel.findOne(query);
    if (existing) {
      const existingExternal =
        (existing.get("external_id") as string | undefined) ?? undefined;
      const conflict =
        existing.run_date !== run.run_date ||
        (external_id !== undefined &&
          existingExternal !== undefined &&
          existingExternal !== external_id);
      if (conflict) {
        return {
          itemStatus: "failed",
          httpStatus: 409,
          body: {
            error:
              "An existing run was found for this key but the payload conflicts with it.",
            code: "IDEMPOTENCY_CONFLICT",
            run_id: existing._id.toString(),
          },
          driver_name: run.driver_name,
        };
      }
      return successFromIntegrationResponse(
        buildRunIntegrationResponse(runDocForResponse(existing), {
          runId: existing._id.toString(),
          origin,
          warnings: ["Returned existing run (idempotent replay); no new run created."],
        }),
        run.driver_name,
        "replayed",
        200
      );
    }
  }

  const googleCostEstimate = estimateRunGoogleApiCost({
    customers: parsed.sanitizedCustomers,
    end_location: run.end_location,
  });
  const budgetIssues = googleApiBudgetViolations(googleCostEstimate);
  if (budgetIssues.length > 0) {
    return failedFromIntegrationResponse(
      buildIntegrationErrorResponse({
        code: GOOGLE_API_BUDGET_EXCEEDED_CODE,
        error: "Google API budget exceeded",
        validation_errors: budgetIssues,
        warnings,
        run_created_as_draft: false,
        runId: null,
        google_cost_estimate: googleCostEstimate,
      }),
      run.driver_name,
      422
    );
  }

  logGoogleApiCostEstimate({
    event: "integration_create_optimize_google_cost_estimate",
    estimate: googleCostEstimate,
    planning_session_id,
    external_id,
    idempotency_key,
  });

  const customersForCreate = parsed.sanitizedCustomers;
  await enrichCustomersWithBoxCounts(customersForCreate);

  const created = await createDeliveryRunFromPayload({
    ...run,
    customers: customersForCreate,
    planning_session_id,
    external_id,
    idempotency_key,
    created_by_integration,
  });
  const runId = created._id.toString();

  const geocodeFailures = await geocodeRunCustomers(created);
  if (geocodeFailures.length > 0) {
    return failedFromIntegrationResponse(
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
        google_cost_estimate: googleCostEstimate,
      }),
      run.driver_name,
      422
    );
  }

  const postGeocodeIssues = await collectPostGeocodeConstraintIssues(
    JSON.parse(JSON.stringify(created.customers ?? [])) as DeliveryCustomer[],
    { end_location: created.end_location }
  );
  if (postGeocodeIssues.length > 0) {
    return failedFromIntegrationResponse(
      buildIntegrationErrorResponse({
        code: "VALIDATION_ERROR",
        error: "Route constraint validation failed after geocoding",
        validation_errors: routeConstraintIssuesToValidationIssues(postGeocodeIssues),
        warnings,
        run_created_as_draft: true,
        runId,
        run: runDocForResponse(created),
        origin,
        google_cost_estimate: googleCostEstimate,
      }),
      run.driver_name,
      422
    );
  }

  try {
    const optimized = await optimizeDeliveryRunById(runId);
    return successFromIntegrationResponse(
      buildRunIntegrationResponse(runDocForResponse(optimized), {
        runId,
        origin,
        warnings,
        google_cost_estimate: googleCostEstimate,
      }),
      run.driver_name,
      "success",
      201
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
      return failedFromIntegrationResponse(
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
          google_cost_estimate: googleCostEstimate,
        }),
        run.driver_name,
        err.statusCode
      );
    }
    throw err;
  }
}
