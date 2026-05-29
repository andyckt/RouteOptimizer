/**
 * Integration-only route constraint helpers (post-geocode readiness, error mapping).
 */

import type { DeliveryCustomer } from "@/types/delivery-run";
import { geocodeAddress } from "@/lib/google/geocoding";
import { ApiError } from "@/lib/http/errors";
import type { RouteConstraintIssue } from "@/lib/validation/fixed-stop-position";
import type { ValidationIssue } from "@/lib/integration/buildRunIntegrationResponse";

function hasValidCoords(c: DeliveryCustomer): boolean {
  if (
    c.geocode_status === "override_success" &&
    typeof c.nearby_lat === "number" &&
    typeof c.nearby_lng === "number"
  ) {
    return true;
  }
  return typeof c.lat === "number" && typeof c.lng === "number";
}

/** Coerce integration booleans: only strict true counts as set. */
export function normalizeIntegrationCustomerFlags(
  customer: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...customer,
    is_first_stop: customer.is_first_stop === true,
    is_end_point: customer.is_end_point === true,
  };
}

function toValidationIssue(issue: RouteConstraintIssue): ValidationIssue {
  return {
    field: issue.field,
    message: issue.message,
    customer_index: issue.customer_index,
    customer_name: issue.customer_name,
    order_ids: issue.order_ids,
  };
}

export function routeConstraintIssuesToValidationIssues(
  issues: RouteConstraintIssue[]
): ValidationIssue[] {
  return issues.map(toValidationIssue);
}

/**
 * After geocoding: ensure first/end point customers have coords; geocode run.end_location
 * when no end-point customer (integration surfaces failure; optimizer would silently skip).
 */
export async function collectPostGeocodeConstraintIssues(
  customers: DeliveryCustomer[],
  run: { end_location?: string }
): Promise<RouteConstraintIssue[]> {
  const issues: RouteConstraintIssue[] = [];

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if ((c.is_first_stop || c.is_end_point) && !hasValidCoords(c)) {
      const role = c.is_end_point ? "End Point" : "First Stop";
      issues.push({
        field: `customers[${i}].${c.is_end_point ? "is_end_point" : "is_first_stop"}`,
        message: `${role} customer "${c.name ?? "(no name)"}" is missing geocoded coordinates.`,
        customer_index: i,
        customer_name: c.name,
        order_ids: c.order_ids,
      });
    }
  }

  const hasEndPointCustomer = customers.some((c) => c.is_end_point);
  const endLocation = run.end_location?.trim();
  if (endLocation && !hasEndPointCustomer) {
    const geo = await geocodeAddress(endLocation);
    if (!geo) {
      issues.push({
        field: "run.end_location",
        message: `End location could not be geocoded: ${endLocation}`,
      });
    }
  }

  return issues;
}

/** Map optimize-time ApiError into structured integration validation issues. */
export function mapOptimizeErrorToIntegrationIssues(
  err: unknown,
  customers: DeliveryCustomer[]
): { code: string; issues: ValidationIssue[] } {
  if (!(err instanceof ApiError)) {
    return {
      code: "OPTIMIZATION_ERROR",
      issues: [{ message: err instanceof Error ? err.message : "Optimization failed." }],
    };
  }

  const message = err.message;
  const code =
    err.statusCode === 422 ? "ROUTE_CONSTRAINT_ERROR" : err.code ?? "OPTIMIZATION_ERROR";

  const customerRef = /#(\d+)\s+"([^"]*)"/g;
  const issues: ValidationIssue[] = [];
  let match: RegExpExecArray | null;
  while ((match = customerRef.exec(message)) !== null) {
    const oneBased = parseInt(match[1], 10);
    const idx = oneBased - 1;
    const c = idx >= 0 && idx < customers.length ? customers[idx] : undefined;
    issues.push({
      message,
      customer_index: idx >= 0 ? idx : undefined,
      customer_name: c?.name ?? match[2],
      order_ids: c?.order_ids,
    });
  }

  if (issues.length === 0) {
    issues.push({ message });
  }

  return { code, issues };
}
