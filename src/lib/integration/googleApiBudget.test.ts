import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeliveryCustomer } from "@/types/delivery-run";
import {
  batchGoogleApiBudgetViolations,
  estimateGeocodeAddressGoogleApiCost,
  estimateRunGoogleApiCost,
  geocodeAddressBudgetViolations,
  googleApiBudgetViolations,
  sumGoogleApiCostEstimates,
  GOOGLE_API_BUDGET_LIMITS,
} from "@/lib/integration/googleApiBudget";

function customer(overrides: Partial<DeliveryCustomer> = {}): DeliveryCustomer {
  const next = {
    name: "Customer",
    phone: "4165550000",
    address: "1 Main St, Toronto",
    lat: 43.65,
    lng: -79.38,
    geocode_status: "success" as const,
    is_first_stop: false,
    is_end_point: false,
    ...overrides,
  };
  return {
    ...next,
    is_first_stop: next.is_first_stop ?? false,
    is_end_point: next.is_end_point ?? false,
  };
}

describe("estimateRunGoogleApiCost", () => {
  it("estimates one Route Optimization shipment and one Directions leg per flexible stop", () => {
    const estimate = estimateRunGoogleApiCost({
      customers: [customer(), customer()],
    });

    assert.equal(estimate.customer_count, 2);
    assert.equal(estimate.customer_geocoding_requests, 0);
    assert.equal(estimate.start_geocoding_requests, 1);
    assert.equal(estimate.end_geocoding_requests, 0);
    assert.equal(estimate.geocoding_requests, 1);
    assert.equal(estimate.route_optimization_requests, 1);
    assert.equal(estimate.route_optimization_billable_units, 2);
    assert.equal(estimate.directions_requests, 2);
    assert.equal(estimate.estimated_billable_units, 5);
  });

  it("counts customer geocodes and duplicate end-location geocodes before optimize", () => {
    const estimate = estimateRunGoogleApiCost({
      end_location: "Kitchen, Toronto",
      customers: [
        customer({ lat: undefined, lng: undefined, geocode_status: "pending" }),
        customer(),
      ],
    });

    assert.equal(estimate.customer_geocoding_requests, 1);
    assert.equal(estimate.start_geocoding_requests, 1);
    assert.equal(estimate.end_geocoding_requests, 2);
    assert.equal(estimate.geocoding_requests, 4);
    assert.equal(estimate.directions_requests, 3);
    assert.equal(estimate.estimated_billable_units, 9);
  });

  it("does not count Route Optimization shipments for fully fixed routes", () => {
    const estimate = estimateRunGoogleApiCost({
      customers: [
        customer({ fixed_stop_position: 1 }),
        customer({ fixed_stop_position: 2 }),
      ],
    });

    assert.equal(estimate.route_optimization_requests, 0);
    assert.equal(estimate.route_optimization_billable_units, 0);
    assert.equal(estimate.directions_requests, 2);
  });
});

describe("googleApiBudgetViolations", () => {
  it("rejects optimize requests with too many customer geocodes", () => {
    const customers = Array.from(
      { length: GOOGLE_API_BUDGET_LIMITS.maxOptimizeCustomerGeocodes + 1 },
      () => customer({ lat: undefined, lng: undefined, geocode_status: "pending" })
    );
    const issues = googleApiBudgetViolations(
      estimateRunGoogleApiCost({ customers })
    );

    assert.ok(issues.some((issue) => issue.field === "customers"));
    assert.ok(issues.some((issue) => issue.message.includes("customer addresses")));
  });

  it("rejects aggregate batch estimates over the batch budget", () => {
    const estimate = estimateRunGoogleApiCost({
      customers: Array.from({ length: 20 }, () => customer()),
    });
    const aggregate = sumGoogleApiCostEstimates([
      estimate,
      estimate,
      estimate,
      estimate,
      estimate,
    ]);

    assert.equal(aggregate.estimated_billable_units, 205);
    assert.equal(batchGoogleApiBudgetViolations({
      totalEstimatedBillableUnits: aggregate.estimated_billable_units,
    }).length, 0);

    const overBudget = sumGoogleApiCostEstimates([aggregate, estimate, estimate]);
    const issues = batchGoogleApiBudgetViolations({
      totalEstimatedBillableUnits: overBudget.estimated_billable_units,
    });

    assert.ok(issues.some((issue) => issue.field === "runs"));
  });
});

describe("geocodeAddressBudgetViolations", () => {
  it("rejects geocode-addresses requests above the geocode budget", () => {
    const estimate = estimateGeocodeAddressGoogleApiCost(
      GOOGLE_API_BUDGET_LIMITS.maxGeocodeAddressBillableUnits + 1
    );
    const issues = geocodeAddressBudgetViolations(estimate);

    assert.equal(estimate.geocoding_requests, 26);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "addresses");
  });
});
