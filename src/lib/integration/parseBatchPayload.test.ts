import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBatchPayload } from "@/lib/integration/parseBatchPayload";

describe("parseBatchPayload", () => {
  it("accepts a valid batch with two runs", () => {
    const result = parseBatchPayload({
      planning_session_id: "sess-1",
      created_by_integration: "kapioo-admin",
      runs: [
        {
          idempotency_key: "dt-1",
          external_id: "dt-1",
          run: {
            run_date: "2026-05-29",
            driver_name: "DT",
            start_location: "Kitchen",
            start_time: "10:00",
          },
          customers: [{ name: "A", phone: "1", address: "Addr A" }],
        },
        {
          idempotency_key: "ut-1",
          run: {
            run_date: "2026-05-29",
            driver_name: "UT",
            start_location: "Meetup",
            start_time: "10:45",
          },
          customers: [{ name: "B", phone: "2", address: "Addr B" }],
        },
      ],
    });
    assert.equal(result.batchErrors.length, 0);
    assert.equal(result.planning_session_id, "sess-1");
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].planning_session_id, "sess-1");
    assert.equal(result.items[0].created_by_integration, "kapioo-admin");
  });

  it("rejects missing planning_session_id", () => {
    const result = parseBatchPayload({
      runs: [
        {
          idempotency_key: "k1",
          run: { run_date: "2026-05-29", start_location: "X", start_time: "10:00" },
          customers: [{ name: "A", address: "Addr" }],
        },
      ],
    });
    assert.ok(result.batchErrors.some((e) => e.field === "planning_session_id"));
    assert.equal(result.planning_session_id, null);
  });

  it("rejects empty runs array", () => {
    const result = parseBatchPayload({
      planning_session_id: "sess-1",
      runs: [],
    });
    assert.ok(result.batchErrors.some((e) => e.field === "runs"));
  });

  it("rejects run item without idempotency_key or external_id", () => {
    const result = parseBatchPayload({
      planning_session_id: "sess-1",
      runs: [
        {
          run: { run_date: "2026-05-29", start_location: "X", start_time: "10:00" },
          customers: [{ name: "A", address: "Addr" }],
        },
      ],
    });
    assert.ok(
      result.batchErrors.some((e) =>
        e.message.includes("idempotency_key or external_id")
      )
    );
  });
});
