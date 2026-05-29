/**
 * Shared validation and parsing for integration run payloads
 * (create-and-optimize and optimize-preview).
 */

import { ApiError } from "@/lib/http/errors";
import { sanitizeCustomers } from "@/lib/normalization/delivery-run";
import type { ValidationIssue } from "@/lib/integration/buildRunIntegrationResponse";
import type { DeliveryCustomer, TravelMode } from "@/types/delivery-run";
import { isSyntheticStop, validateServiceTimeMinutes } from "@/lib/stops/synthetic";
import { collectRouteConstraintIssues } from "@/lib/validation/fixed-stop-position";
import {
  normalizeIntegrationCustomerFlags,
  routeConstraintIssuesToValidationIssues,
} from "@/lib/integration/routeConstraints";

export const RUN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const START_TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export interface IncomingCustomer {
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  [k: string]: unknown;
}

export interface IncomingRun {
  run_date?: unknown;
  driver_name?: unknown;
  start_location?: unknown;
  end_location?: unknown;
  start_time?: unknown;
  travel_mode?: unknown;
}

export interface IncomingBody {
  idempotency_key?: unknown;
  external_id?: unknown;
  planning_session_id?: unknown;
  created_by_integration?: unknown;
  run?: IncomingRun;
  customers?: IncomingCustomer[];
}

export interface ParsedRunFields {
  run_date: string;
  driver_name: string;
  start_location: string;
  end_location?: string;
  start_time: string;
  travel_mode: TravelMode;
}

export interface ParsedIntegrationMeta {
  idempotency_key?: string;
  external_id?: string;
  planning_session_id?: string;
  created_by_integration?: string;
}

export interface ParseIntegrationRunPayloadResult {
  errors: ValidationIssue[];
  warnings: string[];
  run: ParsedRunFields | null;
  meta: ParsedIntegrationMeta;
  normalizedCustomers: IncomingCustomer[];
  sanitizedCustomers: DeliveryCustomer[] | null;
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
export function normalizeIntegrationCustomers(
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

/**
 * Validates and parses an integration run body. Does not touch the database.
 */
export function parseIntegrationRunPayload(
  body: IncomingBody
): ParseIntegrationRunPayloadResult {
  const errors: ValidationIssue[] = [];
  const warnings: string[] = [];
  const run = body.run ?? {};
  const customers = Array.isArray(body.customers) ? body.customers : [];

  const meta: ParsedIntegrationMeta = {
    idempotency_key: asString(body.idempotency_key)?.trim() || undefined,
    external_id: asString(body.external_id)?.trim() || undefined,
    planning_session_id: asString(body.planning_session_id)?.trim() || undefined,
    created_by_integration: asString(body.created_by_integration)?.trim() || undefined,
  };

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
    if (!name) errors.push({ field: `customers[${i}].name`, message: "name is required." });

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
      warnings.push(
        `customers[${i}] (${name ?? "unnamed"}) has no phone; SMS/ETA will be skipped for this stop.`
      );
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

  const normalizedCustomers = normalizeIntegrationCustomers(customers);

  if (errors.length > 0) {
    return {
      errors,
      warnings,
      run: null,
      meta,
      normalizedCustomers,
      sanitizedCustomers: null,
    };
  }

  let sanitizedCustomers: DeliveryCustomer[];
  try {
    sanitizedCustomers = sanitizeCustomers(
      normalizedCustomers as Array<DeliveryCustomer | Record<string, unknown>>
    );
  } catch (sanitizeErr) {
    if (sanitizeErr instanceof ApiError) {
      return {
        errors: [{ message: sanitizeErr.message }],
        warnings,
        run: null,
        meta,
        normalizedCustomers,
        sanitizedCustomers: null,
      };
    }
    throw sanitizeErr;
  }

  const constraintIssues = collectRouteConstraintIssues(sanitizedCustomers);
  if (constraintIssues.length > 0) {
    return {
      errors: routeConstraintIssuesToValidationIssues(constraintIssues),
      warnings,
      run: null,
      meta,
      normalizedCustomers,
      sanitizedCustomers: null,
    };
  }

  const parsedRun: ParsedRunFields = {
    run_date,
    driver_name: asString(run.driver_name) ?? "",
    start_location,
    end_location: asString(run.end_location) || undefined,
    start_time,
    travel_mode: (travel_modeRaw as TravelMode | undefined) ?? "driving",
  };

  return {
    errors: [],
    warnings,
    run: parsedRun,
    meta,
    normalizedCustomers,
    sanitizedCustomers,
  };
}
