import type { DeliveryCustomer } from "@/types/delivery-run";
import { validationError } from "@/lib/http/errors";

export type ParsedFixedStop =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/** Parse a single fixed_stop_position value from API/UI/DB. */
export function parseFixedStopValue(raw: unknown): ParsedFixedStop {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return { ok: true, value: null };
    if (!/^\d+$/.test(t)) {
      return { ok: false, message: "Fixed stop position must be a whole number." };
    }
    return { ok: true, value: parseInt(t, 10) };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, message: "Fixed stop position must be a whole number." };
    }
    return { ok: true, value: raw };
  }
  return { ok: false, message: "Fixed stop position must be a whole number." };
}

/**
 * Validates fixed stop positions after numeric parsing (sanitize first).
 * N = total customers in the run.
 * Returns first error message, or null if valid.
 */
export function getFixedStopPositionValidationMessage(
  customers: DeliveryCustomer[]
): string | null {
  const N = customers.length;
  const parsed: (number | null)[] = [];

  for (let i = 0; i < N; i++) {
    const p = parseFixedStopValue(customers[i].fixed_stop_position);
    if (!p.ok) return p.message;
    parsed[i] = p.value;
  }

  for (let i = 0; i < N; i++) {
    const fp = parsed[i];
    if (fp === null) continue;
    if (fp < 1 || fp > N) {
      return `Fixed stop position must be between 1 and ${N}.`;
    }
  }

  const used = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    const fp = parsed[i];
    if (fp === null) continue;
    if (used.has(fp)) {
      return "Two customers cannot share the same fixed stop position.";
    }
    used.set(fp, i);
  }

  const firstIndices = customers
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.is_first_stop);
  if (firstIndices.length > 1) {
    return "Only one customer can be marked as First Stop.";
  }
  const endIndices = customers
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.is_end_point);
  if (endIndices.length > 1) {
    return "Only one customer can be marked as End Point.";
  }

  if (N > 1) {
    for (let i = 0; i < N; i++) {
      if (customers[i].is_first_stop && customers[i].is_end_point) {
        return "A customer cannot be both First Stop and End Point unless the route has only one stop.";
      }
    }
  }

  const firstStop = firstIndices[0];
  const endPoint = endIndices[0];

  if (firstStop) {
    const fp = parsed[firstStop.idx];
    if (fp !== null && fp !== 1) {
      return "A First Stop customer must be position 1.";
    }
    for (let j = 0; j < N; j++) {
      if (j !== firstStop.idx && parsed[j] === 1) {
        return "This fixed stop position conflicts with another route rule.";
      }
    }
  }

  if (endPoint) {
    const fp = parsed[endPoint.idx];
    if (fp !== null && fp !== N) {
      return "An End Point customer must be the final stop.";
    }
    for (let j = 0; j < N; j++) {
      if (j !== endPoint.idx && parsed[j] === N) {
        return "This fixed stop position conflicts with another route rule.";
      }
    }
  }

  return null;
}

export function assertFixedStopPositionsValid(customers: DeliveryCustomer[]): void {
  const msg = getFixedStopPositionValidationMessage(customers);
  if (msg) throw validationError(msg);
}

/**
 * After assertFixedStopPositionsValid: build slot array (length N) with customer indices
 * for explicitly fixed + reserved first/end slots; null = fill later with flexible order.
 */
export function buildRouteSkeletonSlots(
  customers: DeliveryCustomer[]
): (number | null)[] {
  const N = customers.length;
  const parsed: (number | null)[] = [];
  for (let i = 0; i < N; i++) {
    const p = parseFixedStopValue(customers[i].fixed_stop_position);
    if (!p.ok || p.value === null) parsed[i] = null;
    else parsed[i] = p.value;
  }

  const firstStop = customers.findIndex((c) => c.is_first_stop);
  const endPoint = customers.findIndex((c) => c.is_end_point);

  const slots: (number | null)[] = Array(N).fill(null);

  for (let i = 0; i < N; i++) {
    const pos = parsed[i];
    if (pos === null) continue;
    const slot = pos - 1;
    if (slots[slot] !== null) {
      throw validationError(
        "Two customers cannot share the same fixed stop position."
      );
    }
    slots[slot] = i;
  }

  if (firstStop >= 0) {
    if (slots[0] === null) {
      slots[0] = firstStop;
    } else if (slots[0] !== firstStop) {
      throw validationError("A First Stop customer must be position 1.");
    }
  }

  if (endPoint >= 0) {
    if (slots[N - 1] === null) {
      slots[N - 1] = endPoint;
    } else if (slots[N - 1] !== endPoint) {
      throw validationError("An End Point customer must be the final stop.");
    }
  }

  return slots;
}

/** True if every stop position is pinned (no flexible customers). */
export function isFullyFixedRoute(slots: (number | null)[]): boolean {
  return slots.every((s) => s !== null);
}

/** Customer indices not yet placed in the skeleton. */
export function getFlexibleCustomerIndices(
  slots: (number | null)[]
): number[] {
  const placed = new Set(
    slots.filter((s): s is number => s !== null)
  );
  const out: number[] = [];
  const N = slots.length;
  for (let i = 0; i < N; i++) {
    if (!placed.has(i)) out.push(i);
  }
  return out;
}

/** Indices of slots still null (same length as flexible when valid). */
export function getEmptySlotIndices(slots: (number | null)[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) out.push(i);
  }
  return out;
}

/**
 * Fills null slots with flexibleOrder (same length). Returns final customer index order (positions 0..N-1).
 */
export function fillSkeletonWithFlexibleOrder(
  slots: (number | null)[],
  flexibleOrder: number[]
): number[] {
  const empty = getEmptySlotIndices(slots);
  if (empty.length !== flexibleOrder.length) {
    throw validationError(
      "Unable to build a valid optimized route with the current fixed stop positions."
    );
  }
  const next = [...slots];
  for (let k = 0; k < empty.length; k++) {
    next[empty[k]] = flexibleOrder[k];
  }
  return next as number[];
}

/**
 * Manual reorder: stop i must be the customer assigned fixed position i+1 (or flexible).
 */
export function getManualReorderValidationMessage(
  stops: { customer_index: number }[],
  customers: DeliveryCustomer[]
): string | null {
  for (let i = 0; i < stops.length; i++) {
    const ci = stops[i].customer_index;
    const p = parseFixedStopValue(customers[ci]?.fixed_stop_position);
    if (!p.ok) return p.message;
    if (p.value !== null && p.value !== i + 1) {
      return "Manual order conflicts with a fixed stop position. Move only flexible stops or clear fixed positions on Edit Run.";
    }
  }
  return null;
}

export function assertManualOrderRespectsFixedStops(
  stops: { customer_index: number }[],
  customers: DeliveryCustomer[]
): void {
  const msg = getManualReorderValidationMessage(stops, customers);
  if (msg) throw validationError(msg);
}
