import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName,
  matchDriver,
  deriveActualHours,
  payWeekIndex,
  isDepositWeek,
  computeRunPayment,
} from "@/lib/payments/computeRunPayment";

// ---------------------------------------------------------------------------
// normalizeName
// ---------------------------------------------------------------------------
describe("normalizeName", () => {
  it("lowercases and trims", () => {
    assert.equal(normalizeName("  DT  "), "dt");
  });
  it("collapses internal whitespace", () => {
    assert.equal(normalizeName("Donald  T"), "donald t");
  });
});

// ---------------------------------------------------------------------------
// matchDriver
// ---------------------------------------------------------------------------
const fakeDrivers = [
  { _id: "d1", display_name: "Marco", aliases: ["marco", "marc"] },
  { _id: "d2", display_name: "DT", aliases: ["dt", "donald t"] },
];

describe("matchDriver", () => {
  it("matches by exact normalized alias", () => {
    const d = matchDriver("DT", fakeDrivers);
    assert.equal(d?._id, "d2");
  });
  it("matches case-insensitively", () => {
    const d = matchDriver("dt", fakeDrivers);
    assert.equal(d?._id, "d2");
  });
  it("returns null for unrecognized name", () => {
    assert.equal(matchDriver("Unknown", fakeDrivers), null);
  });
  it("matches multi-word alias", () => {
    const d = matchDriver("Donald T", fakeDrivers);
    assert.equal(d?._id, "d2");
  });
});

// ---------------------------------------------------------------------------
// deriveActualHours
// ---------------------------------------------------------------------------
describe("deriveActualHours", () => {
  it("returns null when actual_start_time is missing", () => {
    assert.equal(
      deriveActualHours({
        optimized_route: { stops: [{ completed_at: "2026-05-31T18:00:00.000Z" }] },
      }),
      null
    );
  });

  it("returns null when no stops have completed_at", () => {
    assert.equal(
      deriveActualHours({
        actual_start_time: "2026-05-31T14:00:00.000Z",
        optimized_route: { stops: [{}] },
      }),
      null
    );
  });

  it("computes hours from start to max completed_at", () => {
    const hours = deriveActualHours({
      actual_start_time: "2026-05-31T14:00:00.000Z",
      optimized_route: {
        stops: [
          { completed_at: "2026-05-31T16:00:00.000Z" },
          { completed_at: "2026-05-31T18:00:00.000Z" },
        ],
      },
    });
    // 18:00 - 14:00 = 4h
    assert.equal(hours, 4);
  });

  it("uses max completed_at across stops", () => {
    const hours = deriveActualHours({
      actual_start_time: "2026-05-31T10:00:00.000Z",
      optimized_route: {
        stops: [
          { completed_at: "2026-05-31T12:30:00.000Z" },
          { completed_at: "2026-05-31T13:00:00.000Z" },
        ],
      },
    });
    // 13:00 - 10:00 = 3h
    assert.equal(hours, 3);
  });
});

// ---------------------------------------------------------------------------
// payWeekIndex
// ---------------------------------------------------------------------------
describe("payWeekIndex", () => {
  it("week 0 on start date", () => {
    assert.equal(payWeekIndex("2026-05-21", "2026-05-21"), 0);
  });
  it("week 0 on day 6", () => {
    assert.equal(payWeekIndex("2026-05-27", "2026-05-21"), 0);
  });
  it("week 1 on day 7", () => {
    assert.equal(payWeekIndex("2026-05-28", "2026-05-21"), 1);
  });
  it("returns -1 for run before driver start", () => {
    assert.equal(payWeekIndex("2026-05-20", "2026-05-21"), -1);
  });
});

// ---------------------------------------------------------------------------
// isDepositWeek
// ---------------------------------------------------------------------------
describe("isDepositWeek", () => {
  it("true for week 0 when 2 deposit weeks", () => {
    assert.equal(isDepositWeek(0, 2), true);
  });
  it("true for week 1 when 2 deposit weeks", () => {
    assert.equal(isDepositWeek(1, 2), true);
  });
  it("false for week 2 when 2 deposit weeks", () => {
    assert.equal(isDepositWeek(2, 2), false);
  });
  it("false for any week when 0 deposit weeks", () => {
    assert.equal(isDepositWeek(0, 0), false);
  });
  it("false for week index -1 (before start)", () => {
    assert.equal(isDepositWeek(-1, 2), false);
  });
});

// ---------------------------------------------------------------------------
// computeRunPayment
// ---------------------------------------------------------------------------
const baseRun = {
  run_date: "2026-05-31",
  driver_name: "Marco",
  actual_start_time: "2026-05-31T14:00:00.000Z",
  optimized_route: {
    stops: [
      { completed_at: "2026-05-31T16:36:00.000Z" },
    ],
    total_distance_km: 52.1,
    return_distance_km: 10.0,
  },
};

const baseDriver = {
  _id: "d1",
  hourly_rate: 22,
  fuel_rate_per_km: 0.15,
  start_date: "2026-05-21",
  deposit_weeks: 2,
};

describe("computeRunPayment", () => {
  it("produces pending_rate with zeros when driver is null", () => {
    const result = computeRunPayment({
      runId: "run1",
      run: baseRun,
      driver: null,
    });
    assert.equal(result.status, "pending_rate");
    assert.equal(result.total, 0);
    assert.equal(result.driver_id, null);
  });

  it("computes correct amounts", () => {
    const result = computeRunPayment({
      runId: "run1",
      run: baseRun,
      driver: baseDriver,
    });
    // hours: (16:36-14:00) = 2.6h
    assert.ok(result.hours_actual !== null);
    // billable km = 52.1 - 10.0 = 42.1
    assert.equal(result.billable_distance_km, 42.1);
    // subtotal = 2.6 * 22
    const expectedSubtotal = Math.round(2.6 * 22 * 100) / 100;
    assert.equal(result.subtotal_labor, expectedSubtotal);
    // fuel = 42.1 * 0.15
    const expectedFuel = Math.round(42.1 * 0.15 * 100) / 100;
    assert.equal(result.fuel_amount, expectedFuel);
    assert.equal(result.total, Math.round((expectedSubtotal + expectedFuel) * 100) / 100);
    assert.equal(result.status, "computed");
  });

  it("uses override when provided", () => {
    const result = computeRunPayment({
      runId: "run1",
      run: baseRun,
      driver: baseDriver,
      hoursOverride: 3,
      overrideReason: "admin adj",
    });
    assert.equal(result.hours_effective, 3);
    assert.equal(result.hours_override, 3);
    assert.equal(result.override_reason, "admin adj");
    assert.equal(result.subtotal_labor, Math.round(3 * 22 * 100) / 100);
  });

  it("is deposit week in week 1 with 2 deposit weeks", () => {
    // run_date = 2026-05-28 = day 7 from 2026-05-21 = week 1
    const run = { ...baseRun, run_date: "2026-05-28" };
    const result = computeRunPayment({ runId: "r", run, driver: baseDriver });
    assert.equal(result.pay_week_index, 1);
    assert.equal(result.is_deposit_week, true);
  });

  it("not deposit week in week 2 with 2 deposit weeks", () => {
    // run_date = 2026-06-04 = day 14 from 2026-05-21 = week 2
    const run = { ...baseRun, run_date: "2026-06-04" };
    const result = computeRunPayment({ runId: "r", run, driver: baseDriver });
    assert.equal(result.pay_week_index, 2);
    assert.equal(result.is_deposit_week, false);
  });

  it("status needs_review when no hours and no override", () => {
    const run = { ...baseRun, actual_start_time: null, optimized_route: { stops: [] } };
    const result = computeRunPayment({ runId: "r", run, driver: baseDriver });
    assert.equal(result.status, "needs_review");
    assert.equal(result.hours_effective, 0);
  });

  it("fuel is 0 when fuel_rate is 0", () => {
    const driver = { ...baseDriver, fuel_rate_per_km: 0 };
    const result = computeRunPayment({ runId: "r", run: baseRun, driver });
    assert.equal(result.fuel_amount, 0);
    assert.equal(result.total, result.subtotal_labor);
  });

  it("billable km is total when no return leg", () => {
    const run = {
      ...baseRun,
      optimized_route: {
        stops: baseRun.optimized_route.stops,
        total_distance_km: 40,
        return_distance_km: 0,
      },
    };
    const result = computeRunPayment({ runId: "r", run, driver: baseDriver });
    assert.equal(result.billable_distance_km, 40);
  });

  it("snaps hourly and fuel rates from driver profile", () => {
    const result = computeRunPayment({ runId: "r", run: baseRun, driver: baseDriver });
    assert.equal(result.hourly_rate_snapshot, 22);
    assert.equal(result.fuel_rate_snapshot, 0.15);
  });
});
