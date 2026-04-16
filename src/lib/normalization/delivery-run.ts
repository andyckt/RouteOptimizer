import type { DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { validationError } from "@/lib/http/errors";
import { parseFixedStopValue } from "@/lib/validation/fixed-stop-position";

type UnknownRecord = Record<string, unknown>;

function omitPriority<T extends UnknownRecord>(input: T): Omit<T, "priority"> {
  const { priority: _ignored, ...rest } = input;
  return rest;
}

export function sanitizeCustomer(
  customer: DeliveryCustomer | UnknownRecord
): DeliveryCustomer {
  const base = omitPriority(customer as UnknownRecord) as UnknownRecord;
  const p = parseFixedStopValue(base.fixed_stop_position);
  if (!p.ok) throw validationError(p.message);
  base.fixed_stop_position = p.value;
  return base as unknown as DeliveryCustomer;
}

export function sanitizeCustomers(
  customers: Array<DeliveryCustomer | UnknownRecord>
): DeliveryCustomer[] {
  return customers.map((customer) => sanitizeCustomer(customer));
}

export function sanitizeStop(stop: OptimizedStop | UnknownRecord): OptimizedStop {
  return omitPriority(stop as UnknownRecord) as unknown as OptimizedStop;
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

