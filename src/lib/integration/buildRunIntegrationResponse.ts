/**
 * Builds the structured response returned by the inbound integration endpoints.
 * Pure/deterministic given a plain run object; no DB or network access.
 */

import { makeDriverToken } from "@/lib/security/driverToken";
import type { GoogleApiCostEstimate } from "@/lib/integration/googleApiBudget";

export interface GeocodeFailure {
  index: number;
  name: string;
  address: string;
  error: string;
}

export interface ValidationIssue {
  field?: string;
  message: string;
  customer_index?: number;
  customer_name?: string;
  order_ids?: string[];
}

export interface RunForResponse {
  run_date?: string;
  start_time?: string;
  status?: string;
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  optimized_route?:
    | ({
        total_duration_minutes?: number;
        total_distance_km?: number;
        stops?: unknown[];
      } & Record<string, unknown>)
    | null;
}

export interface BuildRunIntegrationResponseOptions {
  runId: string;
  /** Request origin used to build absolute links (e.g. https://delivery.kapioo.com). */
  origin?: string;
  geocode_failures?: GeocodeFailure[];
  validation_errors?: ValidationIssue[];
  warnings?: string[];
  google_cost_estimate?: GoogleApiCostEstimate | null;
}

export interface IntegrationRunResponse {
  error?: string | null;
  code?: string | null;
  preview?: boolean;
  persisted?: boolean;
  run_created_as_draft?: boolean;
  run_id: string | null;
  status: string | null;
  planning_session_id: string | null;
  external_id: string | null;
  idempotency_key: string | null;
  details_link: string | null;
  driver_link: string | null;
  total_duration_minutes: number | null;
  total_distance_km: number | null;
  estimated_finish_time: string | null;
  optimized_route: RunForResponse["optimized_route"] | null;
  google_cost_estimate?: GoogleApiCostEstimate | null;
  geocode_failures: GeocodeFailure[];
  validation_errors: ValidationIssue[];
  warnings: string[];
}

/**
 * estimated_finish_time = run start datetime + total_duration_minutes.
 * Mirrors how the rest of the app interprets `${run_date}T${start_time}:00` (local time),
 * keeping it consistent with computeOptimizedRouteFromSequence.
 */
function computeEstimatedFinishTime(run: RunForResponse): string | null {
  const totalMin = run.optimized_route?.total_duration_minutes;
  if (typeof totalMin !== "number" || !run.run_date || !run.start_time) return null;
  const base = new Date(`${run.run_date}T${run.start_time}:00`);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() + totalMin * 60 * 1000).toISOString();
}

export function buildRunIntegrationResponse(
  run: RunForResponse,
  opts: BuildRunIntegrationResponseOptions
): IntegrationRunResponse {
  const { runId, origin } = opts;
  const route = run.optimized_route ?? null;

  const details_link = origin ? `${origin}/run-details?id=${runId}` : null;

  let driver_link: string | null = null;
  if (origin && run.status && run.status !== "draft") {
    driver_link = `${origin}/driver-route?id=${runId}&token=${makeDriverToken(runId)}`;
  }

  return {
    error: null,
    code: null,
    preview: undefined,
    persisted: undefined,
    run_created_as_draft: undefined,
    run_id: runId,
    status: run.status ?? null,
    planning_session_id: run.planning_session_id ?? null,
    external_id: run.external_id ?? null,
    idempotency_key: run.idempotency_key ?? null,
    details_link,
    driver_link,
    total_duration_minutes: route?.total_duration_minutes ?? null,
    total_distance_km: route?.total_distance_km ?? null,
    estimated_finish_time: computeEstimatedFinishTime(run),
    optimized_route: route,
    google_cost_estimate: opts.google_cost_estimate,
    geocode_failures: opts.geocode_failures ?? [],
    validation_errors: opts.validation_errors ?? [],
    warnings: opts.warnings ?? [],
  };
}

export interface BuildIntegrationErrorResponseOptions {
  code: string;
  error: string;
  validation_errors: ValidationIssue[];
  warnings?: string[];
  run_created_as_draft: boolean;
  runId?: string | null;
  run?: RunForResponse | null;
  origin?: string;
  geocode_failures?: GeocodeFailure[];
  google_cost_estimate?: GoogleApiCostEstimate | null;
}

/** Structured 422 envelope for integration constraint / geocode / optimize failures. */
export function buildIntegrationErrorResponse(
  opts: BuildIntegrationErrorResponseOptions
): IntegrationRunResponse {
  const runId = opts.runId ?? null;
  const run = opts.run ?? null;
  const base = run && runId
    ? buildRunIntegrationResponse(run, {
        runId,
        origin: opts.origin,
        geocode_failures: opts.geocode_failures,
        validation_errors: opts.validation_errors,
        warnings: opts.warnings,
        google_cost_estimate: opts.google_cost_estimate,
      })
    : {
        run_id: runId,
        status: run?.status ?? null,
        planning_session_id: run?.planning_session_id ?? null,
        external_id: run?.external_id ?? null,
        idempotency_key: run?.idempotency_key ?? null,
        details_link: runId && opts.origin ? `${opts.origin}/run-details?id=${runId}` : null,
        driver_link: null,
        total_duration_minutes: null,
        total_distance_km: null,
        estimated_finish_time: null,
        optimized_route: null,
        google_cost_estimate: opts.google_cost_estimate,
        geocode_failures: opts.geocode_failures ?? [],
        validation_errors: opts.validation_errors,
        warnings: opts.warnings ?? [],
      };

  return {
    ...base,
    error: opts.error,
    code: opts.code,
    run_created_as_draft: opts.run_created_as_draft,
    run_id: runId,
  };
}

export interface BuildPreviewRunResponseOptions {
  warnings?: string[];
  geocode_failures?: GeocodeFailure[];
  validation_errors?: ValidationIssue[];
  google_cost_estimate?: GoogleApiCostEstimate | null;
}

export type BatchItemStatus = "success" | "failed" | "replayed";

export interface BatchRunItemResult {
  index: number;
  status: BatchItemStatus;
  run_id: string | null;
  external_id: string | null;
  idempotency_key: string | null;
  driver_name: string;
  details_link: string | null;
  driver_link: string | null;
  total_duration_minutes: number | null;
  total_distance_km: number | null;
  estimated_finish_time: string | null;
  optimized_route: RunForResponse["optimized_route"] | null;
  google_cost_estimate?: GoogleApiCostEstimate | null;
  geocode_failures: GeocodeFailure[];
  validation_errors: ValidationIssue[];
  warnings: string[];
  error?: string | null;
  code?: string | null;
  run_created_as_draft?: boolean;
}

export type BatchOverallStatus = "success" | "partial" | "failed";

export interface BatchIntegrationResponse {
  planning_session_id: string;
  status: BatchOverallStatus;
  total_requested: number;
  total_succeeded: number;
  total_failed: number;
  runs: BatchRunItemResult[];
  errors: ValidationIssue[];
}

export function integrationResponseToBatchItem(
  index: number,
  itemStatus: BatchItemStatus,
  driverName: string,
  body: IntegrationRunResponse | { error: string; code: string; run_id: string }
): BatchRunItemResult {
  if ("code" in body && body.code === "IDEMPOTENCY_CONFLICT") {
    return {
      index,
      status: "failed",
      run_id: body.run_id,
      external_id: null,
      idempotency_key: null,
      driver_name: driverName,
      details_link: null,
      driver_link: null,
      total_duration_minutes: null,
      total_distance_km: null,
      estimated_finish_time: null,
      optimized_route: null,
      google_cost_estimate: null,
      geocode_failures: [],
      validation_errors: [],
      warnings: [],
      error: body.error,
      code: body.code,
      run_created_as_draft: false,
    };
  }

  const r = body as IntegrationRunResponse;
  return {
    index,
    status: itemStatus,
    run_id: r.run_id,
    external_id: r.external_id,
    idempotency_key: r.idempotency_key,
    driver_name: driverName,
    details_link: r.details_link,
    driver_link: r.driver_link,
    total_duration_minutes: r.total_duration_minutes,
    total_distance_km: r.total_distance_km,
    estimated_finish_time: r.estimated_finish_time,
    optimized_route: r.optimized_route,
    google_cost_estimate: r.google_cost_estimate,
    geocode_failures: r.geocode_failures ?? [],
    validation_errors: r.validation_errors ?? [],
    warnings: r.warnings ?? [],
    error: r.error ?? null,
    code: r.code ?? null,
    run_created_as_draft: r.run_created_as_draft,
  };
}

export function deriveBatchStatus(
  items: BatchRunItemResult[]
): BatchOverallStatus {
  const succeeded = items.filter((i) => i.status === "success" || i.status === "replayed").length;
  const failed = items.filter((i) => i.status === "failed").length;
  if (failed === 0) return "success";
  if (succeeded === 0) return "failed";
  return "partial";
}

/** 201 only when all items are newly created successes; otherwise 200. */
export function deriveBatchHttpStatus(items: BatchRunItemResult[]): number {
  const status = deriveBatchStatus(items);
  if (status === "success" && items.every((i) => i.status === "success")) {
    return 201;
  }
  return 200;
}

export function buildFailedBatchItem(
  index: number,
  message: string,
  code = "INTERNAL_ERROR"
): BatchRunItemResult {
  return {
    index,
    status: "failed",
    run_id: null,
    external_id: null,
    idempotency_key: null,
    driver_name: "",
    details_link: null,
    driver_link: null,
    total_duration_minutes: null,
    total_distance_km: null,
    estimated_finish_time: null,
    optimized_route: null,
    google_cost_estimate: null,
    geocode_failures: [],
    validation_errors: [{ message }],
    warnings: [],
    error: message,
    code,
    run_created_as_draft: false,
  };
}

export function buildBatchIntegrationResponse(
  planning_session_id: string,
  items: BatchRunItemResult[],
  batchErrors: ValidationIssue[] = []
): BatchIntegrationResponse {
  const total_requested = items.length;
  const total_succeeded = items.filter(
    (i) => i.status === "success" || i.status === "replayed"
  ).length;
  const total_failed = items.filter((i) => i.status === "failed").length;

  return {
    planning_session_id,
    status: deriveBatchStatus(items),
    total_requested,
    total_succeeded,
    total_failed,
    runs: items,
    errors: batchErrors,
  };
}

/** In-memory optimize-preview result (no DB record). */
export function buildPreviewRunResponse(
  run: RunForResponse,
  opts?: BuildPreviewRunResponseOptions
): IntegrationRunResponse {
  const route = run.optimized_route ?? null;
  return {
    error: null,
    code: null,
    preview: true,
    persisted: false,
    run_created_as_draft: false,
    run_id: null,
    status: "preview",
    planning_session_id: run.planning_session_id ?? null,
    external_id: run.external_id ?? null,
    idempotency_key: run.idempotency_key ?? null,
    details_link: null,
    driver_link: null,
    total_duration_minutes: route?.total_duration_minutes ?? null,
    total_distance_km: route?.total_distance_km ?? null,
    estimated_finish_time: computeEstimatedFinishTime(run),
    optimized_route: route,
    google_cost_estimate: opts?.google_cost_estimate,
    geocode_failures: opts?.geocode_failures ?? [],
    validation_errors: opts?.validation_errors ?? [],
    warnings: opts?.warnings ?? [],
  };
}
