/**
 * Pure payment calculation helpers.
 * No DB access. No side effects. Fully testable.
 *
 * IMPORTANT: hours_effective must never use the DriverRouteView fake duration
 * (actual - 15 min). The fake duration is display-only on the driver page.
 * See .cursor/rules/driver-page-duration.mdc.
 */

import type { Driver } from "@/types/driver";
import type { PaymentRecordStatus } from "@/types/driver-payment";

// ---------------------------------------------------------------------------
// Name normalisation / driver matching
// ---------------------------------------------------------------------------

/** Lowercase + trim + collapse whitespace. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Returns the Driver whose aliases list contains the normalised raw name.
 * display_name is always included in aliases at creation time.
 */
export function matchDriver(
  rawName: string,
  drivers: Pick<Driver, "_id" | "aliases" | "display_name">[]
): Pick<Driver, "_id" | "aliases" | "display_name"> | null {
  const key = normalizeName(rawName);
  for (const d of drivers) {
    if (d.aliases.some((a) => normalizeName(a) === key)) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hours derivation
// ---------------------------------------------------------------------------

/**
 * Derives actual worked hours from a lean run.
 * Returns null when either bound is unavailable.
 *
 * Uses real actual_start_time and max(stops[].completed_at).
 * NEVER uses the driver-page fake duration (total_duration_minutes - 15).
 */
export function deriveActualHours(run: {
  actual_start_time?: string | null;
  optimized_route?: {
    stops?: { completed_at?: string }[];
  } | null;
}): number | null {
  if (!run.actual_start_time) return null;
  const startMs = new Date(run.actual_start_time).getTime();
  if (Number.isNaN(startMs)) return null;

  const stops = run.optimized_route?.stops ?? [];
  let maxMs: number | null = null;
  for (const s of stops) {
    if (!s.completed_at) continue;
    const ms = new Date(s.completed_at).getTime();
    if (!Number.isNaN(ms) && (maxMs === null || ms > maxMs)) maxMs = ms;
  }
  if (maxMs === null || maxMs <= startMs) return null;

  return (maxMs - startMs) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Pay week / deposit classification
// ---------------------------------------------------------------------------

/**
 * Returns the 0-based week index from a driver's start_date.
 * Week 0 = days [start_date, start_date+6].
 * Saturday runs still fall into whichever week their run_date lands in;
 * "Time = 0" for Saturdays is a display decision, not a DB concern.
 */
export function payWeekIndex(runDate: string, startDate: string): number {
  const run = new Date(`${runDate}T00:00:00`);
  const start = new Date(`${startDate}T00:00:00`);
  const diffDays = Math.floor((run.getTime() - start.getTime()) / 86_400_000);
  if (diffDays < 0) return -1; // run before driver start
  return Math.floor(diffDays / 7);
}

/** True when the week index falls within the deposit window. */
export function isDepositWeek(weekIndex: number, depositWeeks: number): boolean {
  return weekIndex >= 0 && weekIndex < depositWeeks;
}

// ---------------------------------------------------------------------------
// Main payment computation
// ---------------------------------------------------------------------------

export interface ComputeRunPaymentInput {
  runId: string;
  run: {
    run_date: string;
    driver_name: string;
    actual_start_time?: string | null;
    optimized_route?: {
      stops?: { completed_at?: string }[];
      total_distance_km?: number;
      return_distance_km?: number;
    } | null;
  };
  driver: Pick<
    Driver,
    "_id" | "hourly_rate" | "fuel_rate_per_km" | "start_date" | "deposit_weeks"
  > | null;
  /** Override hours (from a previous admin override) — preserved across recomputes. */
  hoursOverride?: number | null;
  overrideReason?: string;
}

export interface ComputedPayment {
  driver_id: string | null;
  driver_name_raw: string;
  run_date: string;
  completed_at: string | null;

  hours_actual: number | null;
  hours_override: number | null;
  override_reason: string | undefined;
  hours_effective: number;

  total_distance_km: number;
  return_distance_km: number;
  billable_distance_km: number;

  hourly_rate_snapshot: number;
  fuel_rate_snapshot: number;

  subtotal_labor: number;
  fuel_amount: number;
  total: number;

  pay_week_index: number;
  is_deposit_week: boolean;

  status: PaymentRecordStatus;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeRunPayment(input: ComputeRunPaymentInput): ComputedPayment {
  const { runId: _runId, run, driver, hoursOverride = null, overrideReason } = input;

  const driver_name_raw = run.driver_name;
  const run_date = run.run_date;

  // Derive completion timestamp
  const stops = run.optimized_route?.stops ?? [];
  let maxCompletedAt: string | null = null;
  let maxMs: number | null = null;
  for (const s of stops) {
    if (!s.completed_at) continue;
    const ms = new Date(s.completed_at).getTime();
    if (!Number.isNaN(ms) && (maxMs === null || ms > maxMs)) {
      maxMs = ms;
      maxCompletedAt = s.completed_at;
    }
  }

  const hours_actual = deriveActualHours(run);
  const hours_override = typeof hoursOverride === "number" ? hoursOverride : null;
  const hours_effective = round2(hours_override ?? hours_actual ?? 0);

  // Distance
  const total_distance_km = run.optimized_route?.total_distance_km ?? 0;
  const return_distance_km = run.optimized_route?.return_distance_km ?? 0;
  const billable_distance_km = round2(Math.max(0, total_distance_km - return_distance_km));

  if (!driver) {
    // No profile — pending rate
    const weekIndex = 0;
    return {
      driver_id: null,
      driver_name_raw,
      run_date,
      completed_at: maxCompletedAt,
      hours_actual,
      hours_override,
      override_reason: overrideReason,
      hours_effective,
      total_distance_km,
      return_distance_km,
      billable_distance_km,
      hourly_rate_snapshot: 0,
      fuel_rate_snapshot: 0,
      subtotal_labor: 0,
      fuel_amount: 0,
      total: 0,
      pay_week_index: weekIndex,
      is_deposit_week: false,
      status: "pending_rate",
    };
  }

  const weekIndex = payWeekIndex(run_date, driver.start_date);
  const isDeposit = isDepositWeek(weekIndex, driver.deposit_weeks);

  const hourly_rate_snapshot = driver.hourly_rate;
  const fuel_rate_snapshot = driver.fuel_rate_per_km;

  const subtotal_labor = round2(hours_effective * hourly_rate_snapshot);
  const fuel_amount = round2(billable_distance_km * fuel_rate_snapshot);
  const total = round2(subtotal_labor + fuel_amount);

  let status: PaymentRecordStatus = "computed";
  if (hours_actual === null && hours_override === null) {
    status = "needs_review";
  }

  return {
    driver_id: driver._id,
    driver_name_raw,
    run_date,
    completed_at: maxCompletedAt,
    hours_actual,
    hours_override,
    override_reason: overrideReason,
    hours_effective,
    total_distance_km,
    return_distance_km,
    billable_distance_km,
    hourly_rate_snapshot,
    fuel_rate_snapshot,
    subtotal_labor,
    fuel_amount,
    total,
    pay_week_index: weekIndex,
    is_deposit_week: isDeposit,
    status,
  };
}
