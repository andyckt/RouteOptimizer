/**
 * Synthetic / handoff stop helpers.
 *
 * Effective defaults are applied in code, not the Mongoose schema (Milestone 1).
 * A stop is synthetic/handoff when is_synthetic === true OR stop_type === "handoff".
 * Stops missing both fields are treated as normal customers (legacy-safe).
 */

import type { StopType } from "@/types/delivery-run";

export interface StopSyntheticFields {
  is_synthetic?: boolean;
  stop_type?: StopType;
  service_time_minutes?: number;
}

/** Default service time at every stop when the field is missing (legacy-safe). */
export const DEFAULT_SERVICE_TIME_MINUTES = 5;

/** Maximum allowed service time for any stop (M4: not yet applied to timing math). */
export const MAX_SERVICE_TIME_MINUTES = 5;

/** Handoff / meet-up stops must not exceed this value. */
export const MAX_HANDOFF_SERVICE_TIME_MINUTES = 5;

/** True when the stop is an operational handoff/meet-up, not a Kapioo customer delivery. */
export function isSyntheticStop(stop: StopSyntheticFields): boolean {
  return stop.is_synthetic === true || stop.stop_type === "handoff";
}

/** Effective stop classification. Missing fields => "customer". */
export function getEffectiveStopType(stop: StopSyntheticFields): StopType {
  return isSyntheticStop(stop) ? "handoff" : "customer";
}

/**
 * Effective service time in minutes for route duration / ETA math.
 * Single source of truth for all timing paths (Fleet, Directions, totals).
 *
 * M4: returns the default for every stop so existing ETA/duration behavior is unchanged.
 * A future milestone will read `service_time_minutes` from the stop here.
 */
export function getEffectiveServiceTimeMinutes(_stop: StopSyntheticFields): number {
  return DEFAULT_SERVICE_TIME_MINUTES;
}

export type ServiceTimeValidationResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Validates an incoming service_time_minutes value (integration endpoint only).
 * Missing/undefined is allowed; invalid values are rejected with a message.
 */
export function validateServiceTimeMinutes(
  value: unknown,
  options: { isSynthetic: boolean }
): ServiceTimeValidationResult {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, message: "service_time_minutes must be a number." };
  }
  if (value <= 0) {
    return { ok: false, message: "service_time_minutes must be greater than 0." };
  }
  const max = options.isSynthetic
    ? MAX_HANDOFF_SERVICE_TIME_MINUTES
    : MAX_SERVICE_TIME_MINUTES;
  if (value > max) {
    if (options.isSynthetic) {
      return {
        ok: false,
        message: `handoff stop service_time_minutes must not exceed ${MAX_HANDOFF_SERVICE_TIME_MINUTES} minutes.`,
      };
    }
    return {
      ok: false,
      message: `service_time_minutes must not exceed ${MAX_SERVICE_TIME_MINUTES} minutes.`,
    };
  }
  return { ok: true };
}
