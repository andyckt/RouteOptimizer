import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { collectRouteConstraintIssues } from "@/lib/validation/fixed-stop-position";

function customer(
  overrides: Partial<DeliveryCustomer> & { name: string }
): DeliveryCustomer {
  const { name, phone, address, is_first_stop, is_end_point, geocode_status, lat, lng, ...rest } =
    overrides;
  return {
    phone: phone ?? "4165550000",
    address: address ?? "123 Main St",
    is_first_stop: is_first_stop ?? false,
    is_end_point: is_end_point ?? false,
    geocode_status: geocode_status ?? "success",
    lat: lat ?? 43.65,
    lng: lng ?? -79.38,
    ...rest,
    name,
  };
}

describe("collectRouteConstraintIssues", () => {
  it("returns empty for valid flexible route", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "A" }),
      customer({ name: "B" }),
    ]);
    assert.equal(issues.length, 0);
  });

  it("detects duplicate fixed_stop_position", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "A", fixed_stop_position: 2 }),
      customer({ name: "B", fixed_stop_position: 2 }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /same fixed stop position/i);
    assert.equal(issues[0].customer_index, 1);
    assert.equal(issues[0].customer_name, "B");
  });

  it("detects fixed_stop_position out of range", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "A", fixed_stop_position: 5 }),
      customer({ name: "B" }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /between 1 and 2/i);
    assert.equal(issues[0].customer_index, 0);
  });

  it("detects multiple is_end_point", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "A", is_end_point: true }),
      customer({ name: "B", is_end_point: true }),
      customer({ name: "C" }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Only one customer can be marked as End Point/i);
    assert.equal(issues[0].customer_index, 1);
  });

  it("detects multiple is_first_stop", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "A", is_first_stop: true }),
      customer({ name: "B", is_first_stop: true }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /Only one customer can be marked as First Stop/i);
    assert.equal(issues[0].customer_index, 1);
  });

  it("detects first stop vs fixed position conflict", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "First", is_first_stop: true }),
      customer({ name: "Other", fixed_stop_position: 1 }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /conflicts with another route rule/i);
    assert.equal(issues[0].customer_index, 1);
  });

  it("detects end point vs fixed position conflict", () => {
    const issues = collectRouteConstraintIssues([
      customer({ name: "Mid" }),
      customer({ name: "End", is_end_point: true }),
      customer({ name: "Wrong", fixed_stop_position: 3 }),
    ]);
    assert.equal(issues.length, 1);
    assert.match(issues[0].message, /conflicts with another route rule/i);
  });
});
