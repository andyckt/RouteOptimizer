/**
 * Builds the structured response returned by the inbound integration endpoints.
 * Pure/deterministic given a plain run object; no DB or network access.
 */

import { makeDriverToken } from "@/lib/security/driverToken";

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
}

export interface IntegrationRunResponse {
  error?: string | null;
  code?: string | null;
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
