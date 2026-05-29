import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPreviewRunResponse,
  integrationResponseToBatchItem,
  deriveBatchHttpStatus,
  type BatchRunItemResult,
} from "@/lib/integration/buildRunIntegrationResponse";

describe("buildPreviewRunResponse", () => {
  it("returns preview flags and no persisted run_id", () => {
    const res = buildPreviewRunResponse({
      run_date: "2026-05-29",
      start_time: "10:00",
      status: "preview",
      planning_session_id: "sess-abc",
      optimized_route: {
        total_duration_minutes: 120,
        total_distance_km: 45,
        stops: [],
      },
    });
    assert.equal(res.preview, true);
    assert.equal(res.persisted, false);
    assert.equal(res.run_id, null);
    assert.equal(res.details_link, null);
    assert.equal(res.driver_link, null);
    assert.equal(res.status, "preview");
  });
});

describe("integrationResponseToBatchItem", () => {
  it("maps IDEMPOTENCY_CONFLICT to failed batch item with run_id", () => {
    const item = integrationResponseToBatchItem(2, "failed", "DT", {
      error: "conflict",
      code: "IDEMPOTENCY_CONFLICT",
      run_id: "507f1f77bcf86cd799439011",
    });
    assert.equal(item.index, 2);
    assert.equal(item.status, "failed");
    assert.equal(item.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(item.run_id, "507f1f77bcf86cd799439011");
  });
});

describe("deriveBatchHttpStatus (replayed)", () => {
  function batchItem(
    status: BatchRunItemResult["status"]
  ): BatchRunItemResult {
    return {
      index: 0,
      status,
      run_id: "id",
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

  it("returns 200 when all items are replayed", () => {
    assert.equal(
      deriveBatchHttpStatus([batchItem("replayed"), batchItem("replayed")]),
      200
    );
  });
});
