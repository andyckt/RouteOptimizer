/**
 * Maps lean DeliveryRun documents to the runs-by-date integration response.
 * Pure — no DB or network access.
 */

import { isSyntheticStop, getEffectiveStopType } from "@/lib/stops/synthetic";
import type { ParsedRunsByDateQuery } from "@/lib/integration/parseRunsByDateQuery";
import type {
  DeliveryCustomer,
  OptimizedStop,
  OptimizedRoute,
  RunStatus,
  StopType,
  TravelMode,
} from "@/types/delivery-run";

export type EtaBasis = "post_start" | "planned" | "unknown";

export interface RunsByDateStopDto {
  sequence: number;
  customer_index: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  order_ids: string[];
  is_synthetic: boolean;
  stop_type: StopType | "unknown";
  is_first_stop: boolean;
  is_end_point: boolean;
  fixed_stop_position: number | null;
  eta: string | null;
  arrival_time: string | null;
  eta_basis: EtaBasis;
  completed: boolean;
  completed_at: string | null;
  status: string | null;
}

export interface RunsByDateCustomerDto {
  customer_index: number;
  name: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  order_ids: string[];
  fixed_stop_position: number | null;
  is_first_stop: boolean;
  is_end_point: boolean;
  is_synthetic: boolean;
  stop_type: StopType | "unknown";
}

export interface RunsByDateRunDto {
  run_id: string;
  run_date: string;
  driver_name: string | null;
  status: string;
  start_location: string | null;
  end_location: string | null;
  start_time: string | null;
  actual_start_time: string | null;
  run_completed_at: string | null;
  travel_mode: TravelMode | null;
  planning_session_id: string | null;
  external_id: string | null;
  idempotency_key: string | null;
  created_by_integration: string | null;
  created_at: string | null;
  updated_at: string | null;
  eta_basis: EtaBasis;
  route: {
    total_distance_km: number | null;
    total_duration_minutes: number | null;
    stop_count: number;
  };
  optimization_controls: {
    has_fixed_stops: boolean;
    has_end_stop: boolean;
    has_start_location: boolean;
  };
  stops: RunsByDateStopDto[];
  customers: RunsByDateCustomerDto[];
}

export interface RunsByDateMetadata {
  deleted_runs_excluded: boolean;
  deleted_runs_behavior: string;
  draft_runs_excluded: boolean;
  test_runs_excluded: boolean;
  test_run_filter_available: boolean;
  supports_order_ids: boolean;
  supports_actual_completion: boolean;
  supports_post_start_eta: string;
  supports_fixed_end_stop_metadata: boolean;
  warnings: string[];
}

export interface RunsByDateResponse {
  status: "success";
  date: string;
  timezone_note: string;
  count: number;
  runs: RunsByDateRunDto[];
  metadata: RunsByDateMetadata;
  warnings: string[];
}

export interface LeanRunForByDate {
  _id: { toString(): string };
  run_date: string;
  driver_name?: string;
  status: RunStatus;
  start_location?: string;
  end_location?: string;
  start_time?: string;
  actual_start_time?: string;
  travel_mode?: TravelMode;
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  created_by_integration?: string;
  createdAt?: Date;
  updatedAt?: Date;
  customers?: DeliveryCustomer[];
  optimized_route?: OptimizedRoute;
}

const TIMEZONE_NOTE =
  "run_date is a business calendar date (YYYY-MM-DD), not a UTC instant.";

export function deriveRunCompletedAt(
  stops: { completed_at?: string }[]
): string | null {
  let maxMs: number | null = null;
  let maxIso: string | null = null;
  for (const stop of stops) {
    if (!stop.completed_at) continue;
    const ms = new Date(stop.completed_at).getTime();
    if (Number.isNaN(ms)) continue;
    if (maxMs === null || ms > maxMs) {
      maxMs = ms;
      maxIso = stop.completed_at;
    }
  }
  return maxIso;
}

export function deriveEtaBasis(
  actualStartTime?: string | null,
  stops?: { eta?: string; arrival_time?: string }[]
): EtaBasis {
  if (actualStartTime) return "post_start";
  const list = stops ?? [];
  const hasEta = list.some((s) => s.eta || s.arrival_time);
  if (hasEta) return "planned";
  return "unknown";
}

export function deriveStopEtaBasis(
  runEtaBasis: EtaBasis,
  stop: { eta?: string; arrival_time?: string }
): EtaBasis {
  if (runEtaBasis === "post_start") {
    return stop.eta || stop.arrival_time ? "post_start" : "unknown";
  }
  if (runEtaBasis === "planned") {
    return stop.eta || stop.arrival_time ? "planned" : "unknown";
  }
  return "unknown";
}

export function buildPlannedOnlyWarning(runId: string): string {
  return `Run ${runId} has planned-only ETA because actual_start_time is missing. Do not use ETA for post-start learning.`;
}

function normalizeOrderIds(ids?: string[]): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === "string" && id.length > 0);
}

function toIsoOrNull(d?: Date): string | null {
  if (!d) return null;
  const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function customerStopType(c: DeliveryCustomer): StopType | "unknown" {
  if (c.is_synthetic === true || c.stop_type === "handoff") return "handoff";
  if (c.stop_type === "customer") return "customer";
  return "customer";
}

function mapCustomer(c: DeliveryCustomer, index: number): RunsByDateCustomerDto {
  return {
    customer_index: index,
    name: c.name ?? null,
    phone: c.phone ?? null,
    address: c.address ?? null,
    notes: c.notes ?? null,
    lat: typeof c.lat === "number" ? c.lat : null,
    lng: typeof c.lng === "number" ? c.lng : null,
    order_ids: normalizeOrderIds(c.order_ids),
    fixed_stop_position:
      typeof c.fixed_stop_position === "number" ? c.fixed_stop_position : null,
    is_first_stop: c.is_first_stop === true,
    is_end_point: c.is_end_point === true,
    is_synthetic: c.is_synthetic === true,
    stop_type: customerStopType(c),
  };
}

function mapStop(
  stop: OptimizedStop,
  sequence: number,
  customers: DeliveryCustomer[],
  runEtaBasis: EtaBasis
): RunsByDateStopDto {
  const idx =
    typeof stop.customer_index === "number" ? stop.customer_index : null;
  const customer =
    idx !== null && idx >= 0 && idx < customers.length ? customers[idx] : null;

  const isFirst =
    stop.is_first_stop === true ||
    (stop.is_first_stop === undefined && customer?.is_first_stop === true);
  const isEnd =
    stop.is_end_point === true ||
    (stop.is_end_point === undefined && customer?.is_end_point === true);

  const effectiveType = getEffectiveStopType(stop);
  const stopType: StopType | "unknown" =
    effectiveType === "handoff" ? "handoff" : "customer";

  return {
    sequence,
    customer_index: idx,
    customer_name: stop.customer_name ?? null,
    customer_phone: stop.customer_phone ?? null,
    customer_address: stop.customer_address ?? null,
    notes: stop.notes ?? null,
    lat: typeof customer?.lat === "number" ? customer.lat : null,
    lng: typeof customer?.lng === "number" ? customer.lng : null,
    order_ids: normalizeOrderIds(
      stop.order_ids ?? customer?.order_ids
    ),
    is_synthetic: isSyntheticStop(stop),
    stop_type: stopType,
    is_first_stop: isFirst,
    is_end_point: isEnd,
    fixed_stop_position:
      typeof customer?.fixed_stop_position === "number"
        ? customer.fixed_stop_position
        : null,
    eta: stop.eta ?? null,
    arrival_time: stop.arrival_time ?? null,
    eta_basis: deriveStopEtaBasis(runEtaBasis, stop),
    completed: stop.completed === true,
    completed_at: stop.completed_at ?? null,
    status: stop.completed === true ? "completed" : "pending",
  };
}

function mapRun(run: LeanRunForByDate): { dto: RunsByDateRunDto; warnings: string[] } {
  const runId = run._id.toString();
  const customers = run.customers ?? [];
  const stops = run.optimized_route?.stops ?? [];
  const runWarnings: string[] = [];

  const runEtaBasis = deriveEtaBasis(run.actual_start_time, stops);
  if (
    !run.actual_start_time &&
    runEtaBasis === "planned"
  ) {
    runWarnings.push(buildPlannedOnlyWarning(runId));
  }

  const runCompletedAt = deriveRunCompletedAt(stops);

  const hasFixed = customers.some(
    (c) => typeof c.fixed_stop_position === "number"
  );
  const hasEnd =
    customers.some((c) => c.is_end_point === true) ||
    Boolean(run.end_location?.trim());
  const hasStart = Boolean(run.start_location?.trim());

  const dto: RunsByDateRunDto = {
    run_id: runId,
    run_date: run.run_date,
    driver_name: run.driver_name ?? null,
    status: run.status,
    start_location: run.start_location ?? null,
    end_location: run.end_location ?? null,
    start_time: run.start_time ?? null,
    actual_start_time: run.actual_start_time ?? null,
    run_completed_at: runCompletedAt,
    travel_mode: run.travel_mode ?? null,
    planning_session_id: run.planning_session_id ?? null,
    external_id: run.external_id ?? null,
    idempotency_key: run.idempotency_key ?? null,
    created_by_integration: run.created_by_integration ?? null,
    created_at: toIsoOrNull(run.createdAt),
    updated_at: toIsoOrNull(run.updatedAt),
    eta_basis: runEtaBasis,
    route: {
      total_distance_km:
        typeof run.optimized_route?.total_distance_km === "number"
          ? run.optimized_route.total_distance_km
          : null,
      total_duration_minutes:
        typeof run.optimized_route?.total_duration_minutes === "number"
          ? run.optimized_route.total_duration_minutes
          : null,
      stop_count: stops.length,
    },
    optimization_controls: {
      has_fixed_stops: hasFixed,
      has_end_stop: hasEnd,
      has_start_location: hasStart,
    },
    stops: stops.map((s, i) => mapStop(s, i, customers, runEtaBasis)),
    customers: customers.map(mapCustomer),
  };

  return { dto, warnings: runWarnings };
}

export function buildRunsByDateResponse(
  parsed: ParsedRunsByDateQuery,
  runs: LeanRunForByDate[]
): RunsByDateResponse {
  const allWarnings: string[] = [];
  const mappedRuns: RunsByDateRunDto[] = [];

  for (const run of runs) {
    const { dto, warnings } = mapRun(run);
    mappedRuns.push(dto);
    allWarnings.push(...warnings);
  }

  const metadata: RunsByDateMetadata = {
    deleted_runs_excluded: true,
    deleted_runs_behavior: "hard_deleted_unavailable",
    draft_runs_excluded: !parsed.includeDrafts,
    test_runs_excluded: false,
    test_run_filter_available: false,
    supports_order_ids: true,
    supports_actual_completion: true,
    supports_post_start_eta: "derived_by_actual_start_time",
    supports_fixed_end_stop_metadata: true,
    warnings: [...allWarnings],
  };

  return {
    status: "success",
    date: parsed.date,
    timezone_note: TIMEZONE_NOTE,
    count: mappedRuns.length,
    runs: mappedRuns,
    metadata,
    warnings: [...allWarnings],
  };
}
