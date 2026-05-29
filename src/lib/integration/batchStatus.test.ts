import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBatchStatus,
  deriveBatchHttpStatus,
  type BatchRunItemResult,
} from "@/lib/integration/buildRunIntegrationResponse";

function item(
  status: BatchRunItemResult["status"]
): BatchRunItemResult {
  return {
    index: 0,
    status,
    run_id: null,
    external_id: null,
    idempotency_key: null,
    driver_name: "DT",
    details_link: null,
    driver_link: null,
    total_duration_minutes: null,
    total_distance_km: null,
    estimated_finish_time: null,
    optimized_route: null,
    geocode_failures: [],
    validation_errors: [],
    warnings: [],
  };
}

describe("deriveBatchStatus", () => {
  it("returns success when no failures", () => {
    assert.equal(
      deriveBatchStatus([item("success"), item("replayed")]),
      "success"
    );
  });

  it("returns partial when mixed", () => {
    assert.equal(deriveBatchStatus([item("success"), item("failed")]), "partial");
  });

  it("returns failed when all failed", () => {
    assert.equal(deriveBatchStatus([item("failed"), item("failed")]), "failed");
  });
});

describe("deriveBatchHttpStatus", () => {
  it("returns 201 when all success", () => {
    assert.equal(deriveBatchHttpStatus([item("success"), item("success")]), 201);
  });

  it("returns 200 when any replayed", () => {
    assert.equal(deriveBatchHttpStatus([item("success"), item("replayed")]), 200);
  });

  it("returns 200 for partial", () => {
    assert.equal(deriveBatchHttpStatus([item("success"), item("failed")]), 200);
  });
});
