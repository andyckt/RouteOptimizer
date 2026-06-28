import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OptimizedStop } from "@/types/delivery-run";
import { buildRouteLabelRows } from "./buildRouteLabelRows";

function stop(overrides: Partial<OptimizedStop>): OptimizedStop {
  return {
    customer_index: 0,
    customer_name: "Customer",
    customer_phone: "",
    customer_address: "1 Customer St",
    is_first_stop: false,
    is_end_point: false,
    ...overrides,
  };
}

describe("buildRouteLabelRows", () => {
  it("skips synthetic handoff stops", () => {
    const rows = buildRouteLabelRows(
      [
        stop({ customer_name: "A", customer_address: "1 A St" }),
        stop({
          customer_index: 1,
          customer_name: "Meet-up",
          customer_address: "2 Handoff St",
          is_synthetic: true,
          stop_type: "handoff",
        }),
        stop({ customer_index: 2, customer_name: "B", customer_address: "3 B St" }),
      ],
      { "0": 1, "1": 9, "2": 2 }
    );

    assert.deepEqual(rows, [
      ["A", "1 A St"],
      ["B", "3 B St"],
      ["B", "3 B St"],
    ]);
  });
});
