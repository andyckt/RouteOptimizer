import type { DeliveryCustomer } from "@/types/delivery-run";
import type { ValidationIssue } from "@/lib/integration/buildRunIntegrationResponse";
import {
  buildRouteSkeletonSlots,
  getFlexibleCustomerIndices,
} from "@/lib/validation/fixed-stop-position";

export const GOOGLE_API_BUDGET_EXCEEDED_CODE = "GOOGLE_API_BUDGET_EXCEEDED";

export const GOOGLE_API_BUDGET_LIMITS = {
  maxOptimizeStops: 25,
  maxOptimizeCustomerGeocodes: 10,
  maxOptimizeRouteOptimizationBillableUnits: 25,
  maxOptimizeDirectionsRequests: 26,
  maxOptimizeEstimatedBillableUnits: 75,
  maxBatchEstimatedBillableUnits: 250,
  maxGeocodeAddressBillableUnits: 25,
} as const;

export interface GoogleApiCostEstimate {
  customer_count: number;
  customer_geocoding_requests: number;
  start_geocoding_requests: number;
  end_geocoding_requests: number;
  geocoding_requests: number;
  route_optimization_requests: number;
  route_optimization_billable_units: number;
  directions_requests: number;
  estimated_billable_units: number;
}

function hasProvidedCoords(c: DeliveryCustomer): boolean {
  return typeof c.lat === "number" && typeof c.lng === "number";
}

function needsCustomerGeocode(c: DeliveryCustomer): boolean {
  if (c.geocode_status === "override_success") return false;
  return !(hasProvidedCoords(c) && c.geocode_status === "success");
}

function hasEndPointCustomer(customers: DeliveryCustomer[]): boolean {
  return customers.some((c) => c.is_end_point === true);
}

function estimateFlexibleShipments(customers: DeliveryCustomer[]): number {
  const skeleton = buildRouteSkeletonSlots(customers);
  return getFlexibleCustomerIndices(skeleton).length;
}

export function estimateRunGoogleApiCost(input: {
  customers: DeliveryCustomer[];
  end_location?: string;
}): GoogleApiCostEstimate {
  const customerCount = input.customers.length;
  const customerGeocodingRequests = input.customers.filter(needsCustomerGeocode).length;
  const endLocationProvided = Boolean(input.end_location?.trim());
  const endGeocodingRequests =
    endLocationProvided && !hasEndPointCustomer(input.customers) ? 2 : 0;
  const startGeocodingRequests = 1;
  const routeOptimizationBillableUnits = estimateFlexibleShipments(input.customers);
  const routeOptimizationRequests = routeOptimizationBillableUnits > 0 ? 1 : 0;
  const directionsRequests =
    customerCount + (endLocationProvided && !hasEndPointCustomer(input.customers) ? 1 : 0);
  const geocodingRequests =
    customerGeocodingRequests + startGeocodingRequests + endGeocodingRequests;

  return {
    customer_count: customerCount,
    customer_geocoding_requests: customerGeocodingRequests,
    start_geocoding_requests: startGeocodingRequests,
    end_geocoding_requests: endGeocodingRequests,
    geocoding_requests: geocodingRequests,
    route_optimization_requests: routeOptimizationRequests,
    route_optimization_billable_units: routeOptimizationBillableUnits,
    directions_requests: directionsRequests,
    estimated_billable_units:
      geocodingRequests + routeOptimizationBillableUnits + directionsRequests,
  };
}

export function estimateGeocodeAddressGoogleApiCost(addressCount: number): GoogleApiCostEstimate {
  return {
    customer_count: addressCount,
    customer_geocoding_requests: addressCount,
    start_geocoding_requests: 0,
    end_geocoding_requests: 0,
    geocoding_requests: addressCount,
    route_optimization_requests: 0,
    route_optimization_billable_units: 0,
    directions_requests: 0,
    estimated_billable_units: addressCount,
  };
}

export function sumGoogleApiCostEstimates(
  estimates: GoogleApiCostEstimate[]
): GoogleApiCostEstimate {
  return estimates.reduce<GoogleApiCostEstimate>(
    (sum, estimate) => ({
      customer_count: sum.customer_count + estimate.customer_count,
      customer_geocoding_requests:
        sum.customer_geocoding_requests + estimate.customer_geocoding_requests,
      start_geocoding_requests:
        sum.start_geocoding_requests + estimate.start_geocoding_requests,
      end_geocoding_requests: sum.end_geocoding_requests + estimate.end_geocoding_requests,
      geocoding_requests: sum.geocoding_requests + estimate.geocoding_requests,
      route_optimization_requests:
        sum.route_optimization_requests + estimate.route_optimization_requests,
      route_optimization_billable_units:
        sum.route_optimization_billable_units +
        estimate.route_optimization_billable_units,
      directions_requests: sum.directions_requests + estimate.directions_requests,
      estimated_billable_units:
        sum.estimated_billable_units + estimate.estimated_billable_units,
    }),
    {
      customer_count: 0,
      customer_geocoding_requests: 0,
      start_geocoding_requests: 0,
      end_geocoding_requests: 0,
      geocoding_requests: 0,
      route_optimization_requests: 0,
      route_optimization_billable_units: 0,
      directions_requests: 0,
      estimated_billable_units: 0,
    }
  );
}

export function googleApiBudgetViolations(
  estimate: GoogleApiCostEstimate
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (estimate.customer_count > GOOGLE_API_BUDGET_LIMITS.maxOptimizeStops) {
    issues.push({
      field: "customers",
      message: `Google API budget exceeded: at most ${GOOGLE_API_BUDGET_LIMITS.maxOptimizeStops} stops are allowed for paid optimization requests.`,
    });
  }

  if (
    estimate.customer_geocoding_requests >
    GOOGLE_API_BUDGET_LIMITS.maxOptimizeCustomerGeocodes
  ) {
    issues.push({
      field: "customers",
      message: `Google API budget exceeded: at most ${GOOGLE_API_BUDGET_LIMITS.maxOptimizeCustomerGeocodes} customer addresses may require geocoding. Send cached lat/lng for larger previews or creates.`,
    });
  }

  if (
    estimate.route_optimization_billable_units >
    GOOGLE_API_BUDGET_LIMITS.maxOptimizeRouteOptimizationBillableUnits
  ) {
    issues.push({
      field: "customers",
      message: `Google API budget exceeded: estimated Route Optimization billable units ${estimate.route_optimization_billable_units} exceeds limit ${GOOGLE_API_BUDGET_LIMITS.maxOptimizeRouteOptimizationBillableUnits}.`,
    });
  }

  if (estimate.directions_requests > GOOGLE_API_BUDGET_LIMITS.maxOptimizeDirectionsRequests) {
    issues.push({
      field: "customers",
      message: `Google API budget exceeded: estimated Directions requests ${estimate.directions_requests} exceeds limit ${GOOGLE_API_BUDGET_LIMITS.maxOptimizeDirectionsRequests}.`,
    });
  }

  if (
    estimate.estimated_billable_units >
    GOOGLE_API_BUDGET_LIMITS.maxOptimizeEstimatedBillableUnits
  ) {
    issues.push({
      field: "google_cost_estimate.estimated_billable_units",
      message: `Google API budget exceeded: estimated billable units ${estimate.estimated_billable_units} exceeds limit ${GOOGLE_API_BUDGET_LIMITS.maxOptimizeEstimatedBillableUnits}.`,
    });
  }

  return issues;
}

export function batchGoogleApiBudgetViolations(input: {
  totalEstimatedBillableUnits: number;
}): ValidationIssue[] {
  if (
    input.totalEstimatedBillableUnits <=
    GOOGLE_API_BUDGET_LIMITS.maxBatchEstimatedBillableUnits
  ) {
    return [];
  }
  return [
    {
      field: "runs",
      message: `Google API budget exceeded: batch estimated billable units ${input.totalEstimatedBillableUnits} exceeds limit ${GOOGLE_API_BUDGET_LIMITS.maxBatchEstimatedBillableUnits}. Submit fewer or smaller runs.`,
    },
  ];
}

export function geocodeAddressBudgetViolations(
  estimate: GoogleApiCostEstimate
): ValidationIssue[] {
  if (
    estimate.estimated_billable_units <=
    GOOGLE_API_BUDGET_LIMITS.maxGeocodeAddressBillableUnits
  ) {
    return [];
  }
  return [
    {
      field: "addresses",
      message: `Google API budget exceeded: estimated Geocoding requests ${estimate.estimated_billable_units} exceeds limit ${GOOGLE_API_BUDGET_LIMITS.maxGeocodeAddressBillableUnits}.`,
    },
  ];
}

export function logGoogleApiCostEstimate(input: {
  event: string;
  estimate: GoogleApiCostEstimate;
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
}): void {
  console.log(
    JSON.stringify({
      event: input.event,
      planning_session_id: input.planning_session_id,
      external_id: input.external_id,
      idempotency_key: input.idempotency_key,
      google_cost_estimate: input.estimate,
    })
  );
}
