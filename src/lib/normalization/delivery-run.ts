import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { validationError } from "@/lib/http/errors";
import { parseFixedStopValue } from "@/lib/validation/fixed-stop-position";

type UnknownRecord = Record<string, unknown>;

function omitPriority<T extends UnknownRecord>(input: T): Omit<T, "priority"> {
  const { priority: _ignored, ...rest } = input;
  return rest;
}

const MAX_ORDER_ID_LEN = 64;

/**
 * Single cleanup point for Kapioo order IDs (seed AND SSOT).
 * Trim, drop empties, dedupe preserving first occurrence, cap each ID at 64 chars,
 * drop the field entirely when no IDs remain so it stays `undefined` instead of `[]`.
 */
export function normalizeOrderIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const capped = trimmed.length > MAX_ORDER_ID_LEN ? trimmed.slice(0, MAX_ORDER_ID_LEN) : trimmed;
    if (seen.has(capped)) continue;
    seen.add(capped);
    out.push(capped);
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeMeetupNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function sanitizeCustomer(
  customer: DeliveryCustomer | UnknownRecord
): DeliveryCustomer {
  const base = omitPriority(customer as UnknownRecord) as UnknownRecord;
  const p = parseFixedStopValue(base.fixed_stop_position);
  if (!p.ok) throw validationError(p.message);
  base.fixed_stop_position = p.value;
  const cleanedIds = normalizeOrderIds(base.order_ids);
  if (cleanedIds === undefined) {
    delete base.order_ids;
  } else {
    base.order_ids = cleanedIds;
  }
  const cleanedMeetupNote = normalizeMeetupNote(base.meetup_note);
  if (cleanedMeetupNote === undefined) {
    delete base.meetup_note;
  } else {
    base.meetup_note = cleanedMeetupNote;
  }
  return base as unknown as DeliveryCustomer;
}

export function sanitizeCustomers(
  customers: Array<DeliveryCustomer | UnknownRecord>
): DeliveryCustomer[] {
  return customers.map((customer) => sanitizeCustomer(customer));
}

export function sanitizeStop(stop: OptimizedStop | UnknownRecord): OptimizedStop {
  const base = omitPriority(stop as UnknownRecord) as UnknownRecord;
  if ("order_ids" in base) {
    const cleanedIds = normalizeOrderIds(base.order_ids);
    if (cleanedIds === undefined) {
      delete base.order_ids;
    } else {
      base.order_ids = cleanedIds;
    }
  }
  if ("meetup_note" in base) {
    const cleanedMeetupNote = normalizeMeetupNote(base.meetup_note);
    if (cleanedMeetupNote === undefined) {
      delete base.meetup_note;
    } else {
      base.meetup_note = cleanedMeetupNote;
    }
  }
  return base as unknown as OptimizedStop;
}

export function sanitizeStops(
  stops: Array<OptimizedStop | UnknownRecord>
): OptimizedStop[] {
  return stops.map((stop) => sanitizeStop(stop));
}

export function sanitizeRunForResponse<T extends UnknownRecord>(run: T): T {
  const next = { ...run } as UnknownRecord;
  if (Array.isArray(next.customers)) {
    next.customers = sanitizeCustomers(next.customers as UnknownRecord[]);
  }
  const optimizedRoute = next.optimized_route as UnknownRecord | undefined;
  if (optimizedRoute && Array.isArray(optimizedRoute.stops)) {
    next.optimized_route = {
      ...optimizedRoute,
      stops: sanitizeStops(optimizedRoute.stops as UnknownRecord[]),
    };
  }
  return next as T;
}

