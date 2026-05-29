import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseIntegrationRunPayload } from "@/lib/integration/parseRunPayload";

const validRun = {
  run_date: "2026-05-28",
  start_location: "100 Front St W, Toronto, ON",
  start_time: "10:30",
};

describe("parseIntegrationRunPayload", () => {
  it("accepts a valid payload with sanitized customers", () => {
    const result = parseIntegrationRunPayload({
      run: validRun,
      customers: [
        { name: "Customer A", phone: "4165550001", address: "250 Yonge St, Toronto" },
      ],
    });
    assert.equal(result.errors.length, 0);
    assert.ok(result.run);
    assert.equal(result.sanitizedCustomers?.length, 1);
    assert.equal(result.sanitizedCustomers?.[0].name, "Customer A");
  });

  it("rejects missing run_date", () => {
    const result = parseIntegrationRunPayload({
      run: { start_location: "Toronto", start_time: "10:30" },
      customers: [{ name: "A", phone: "1", address: "Addr" }],
    });
    assert.ok(result.errors.some((e) => e.field === "run.run_date"));
    assert.equal(result.sanitizedCustomers, null);
  });

  it("rejects duplicate fixed_stop_position", () => {
    const result = parseIntegrationRunPayload({
      run: validRun,
      customers: [
        { name: "A", phone: "1", address: "Addr A", fixed_stop_position: 2 },
        { name: "B", phone: "2", address: "Addr B", fixed_stop_position: 2 },
      ],
    });
    assert.ok(result.errors.length > 0);
    assert.match(
      result.errors[0].message,
      /same fixed stop position/i
    );
    assert.equal(result.errors[0].customer_index, 1);
    assert.equal(result.sanitizedCustomers, null);
  });

  it("rejects synthetic stop without address or coords", () => {
    const result = parseIntegrationRunPayload({
      run: validRun,
      customers: [
        {
          name: "Meet up",
          phone: "",
          is_synthetic: true,
          stop_type: "handoff",
        },
      ],
    });
    assert.ok(
      result.errors.some((e) =>
        e.message.includes("handoff stop requires address or valid lat/lng")
      )
    );
  });
});
