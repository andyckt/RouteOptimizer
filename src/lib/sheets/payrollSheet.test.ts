import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDriverTabRows } from "@/lib/sheets/payrollSheet";
import type { DriverPaymentRecord } from "@/types/driver-payment";

const baseDriver = {
  start_date: "2026-05-21",
  deposit_weeks: 2,
  payout_cadence_weeks: 2,
  hourly_rate: 22,
  fuel_rate_per_km: 0.15,
};

function makeRecord(
  run_date: string,
  overrides: Partial<Pick<DriverPaymentRecord, "hours_effective" | "subtotal_labor" | "fuel_amount" | "total" | "pay_week_index" | "is_deposit_week" | "status">> = {}
): Pick<
  DriverPaymentRecord,
  | "run_date" | "hours_effective" | "subtotal_labor" | "fuel_amount" | "total"
  | "total_distance_km" | "billable_distance_km" | "fuel_rate_snapshot" | "hourly_rate_snapshot"
  | "pay_week_index" | "is_deposit_week" | "status"
> {
  const weekIndex = overrides.pay_week_index ?? 0;
  return {
    run_date,
    hours_effective: overrides.hours_effective ?? 2.6,
    subtotal_labor: overrides.subtotal_labor ?? 57.2,
    fuel_amount: overrides.fuel_amount ?? 6.0,
    total: overrides.total ?? 63.2,
    total_distance_km: 52.1,
    billable_distance_km: 42.1,
    fuel_rate_snapshot: 0.15,
    hourly_rate_snapshot: 22,
    pay_week_index: weekIndex,
    is_deposit_week: overrides.is_deposit_week ?? weekIndex < 2,
    status: overrides.status ?? "computed",
  };
}

describe("buildDriverTabRows", () => {
  it("returns empty array for no records", () => {
    assert.deepEqual(buildDriverTabRows(baseDriver, []), []);
  });

  it("produces rows including all 7 days of the week", () => {
    const record = makeRecord("2026-05-21");
    const rows = buildDriverTabRows(baseDriver, [record]);
    // Week 0 has 7 date rows + 1 summary row
    const dateRows = rows.filter(r => r.date.startsWith("2026-05-"));
    assert.ok(dateRows.length === 7);
  });

  it("saturdays have 0 for time and total", () => {
    const record = makeRecord("2026-05-21"); // Thu start
    const rows = buildDriverTabRows(baseDriver, [record]);
    const saturdayRow = rows.find(r => r.date === "2026-05-23"); // Sat
    assert.ok(saturdayRow !== undefined);
    assert.equal(saturdayRow!.time, 0);
    assert.equal(saturdayRow!.total, 0);
  });

  it("aggregates multiple runs on same day", () => {
    const r1 = makeRecord("2026-05-21", { hours_effective: 2, subtotal_labor: 44, fuel_amount: 5, total: 49 });
    const r2 = makeRecord("2026-05-21", { hours_effective: 1, subtotal_labor: 22, fuel_amount: 3, total: 25 });
    const rows = buildDriverTabRows(baseDriver, [r1, r2]);
    const dayRow = rows.find(r => r.date === "2026-05-21" && typeof r.time === "number" && r.time > 0);
    assert.ok(dayRow !== undefined);
    assert.equal(dayRow!.time, 3);
    assert.equal(dayRow!.total, 74);
  });

  it("deposit week summary row includes 'deposit' in note or week label", () => {
    const record = makeRecord("2026-05-21");
    const rows = buildDriverTabRows(baseDriver, [record]);
    const summaryRow = rows.find(r => r.note && r.note.toLowerCase().includes("deposit"));
    assert.ok(summaryRow !== undefined);
  });

  it("non-deposit week produces payable summary row", () => {
    const record = makeRecord("2026-06-04", {
      pay_week_index: 2,
      is_deposit_week: false,
      total: 50,
    });
    const rows = buildDriverTabRows(baseDriver, [record]);
    const payableRow = rows.find(r => r.note && r.note.toLowerCase().includes("payable"));
    assert.ok(payableRow !== undefined);
  });

  it("marks records with pending_rate as 'pending rate' in note", () => {
    const record = makeRecord("2026-05-21", { status: "pending_rate" });
    const rows = buildDriverTabRows(baseDriver, [record]);
    const dayRow = rows.find(r => r.date === "2026-05-21" && r.note === "pending rate");
    assert.ok(dayRow !== undefined);
  });
});
