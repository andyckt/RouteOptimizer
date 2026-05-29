import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSyntheticStop,
  getEffectiveServiceTimeMinutes,
  validateServiceTimeMinutes,
  DEFAULT_SERVICE_TIME_MINUTES,
} from "@/lib/stops/synthetic";

describe("isSyntheticStop", () => {
  it("returns true when is_synthetic is true", () => {
    assert.equal(isSyntheticStop({ is_synthetic: true }), true);
  });

  it("returns true when stop_type is handoff", () => {
    assert.equal(isSyntheticStop({ stop_type: "handoff" }), true);
  });

  it("returns false for normal customer stops", () => {
    assert.equal(isSyntheticStop({}), false);
    assert.equal(isSyntheticStop({ stop_type: "customer" }), false);
    assert.equal(isSyntheticStop({ is_synthetic: false }), false);
  });
});

describe("getEffectiveServiceTimeMinutes", () => {
  it("returns 5 for all stops (M4 default)", () => {
    assert.equal(getEffectiveServiceTimeMinutes({}), DEFAULT_SERVICE_TIME_MINUTES);
    assert.equal(
      getEffectiveServiceTimeMinutes({ is_synthetic: true, stop_type: "handoff" }),
      5
    );
  });
});

describe("validateServiceTimeMinutes", () => {
  it("allows undefined or null", () => {
    assert.deepEqual(validateServiceTimeMinutes(undefined, { isSynthetic: false }), {
      ok: true,
    });
    assert.deepEqual(validateServiceTimeMinutes(null, { isSynthetic: true }), {
      ok: true,
    });
  });

  it("rejects non-numbers and non-positive values", () => {
    assert.equal(validateServiceTimeMinutes("5", { isSynthetic: false }).ok, false);
    assert.equal(validateServiceTimeMinutes(0, { isSynthetic: false }).ok, false);
    assert.equal(validateServiceTimeMinutes(-1, { isSynthetic: true }).ok, false);
  });

  it("rejects service time above 5 for normal stops", () => {
    const r = validateServiceTimeMinutes(6, { isSynthetic: false });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /must not exceed 5/);
  });

  it("rejects service time above 5 for handoff stops", () => {
    const r = validateServiceTimeMinutes(6, { isSynthetic: true });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /handoff/);
  });

  it("accepts valid service time up to 5", () => {
    assert.equal(validateServiceTimeMinutes(5, { isSynthetic: false }).ok, true);
    assert.equal(validateServiceTimeMinutes(3, { isSynthetic: true }).ok, true);
  });
});
