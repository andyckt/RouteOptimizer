/**
 * Non-blocking service: compute and upsert a DriverPaymentRecord when a run completes.
 * Errors are caught and logged; they must never propagate into the run completion flow.
 */

import { connectDB } from "@/lib/mongodb";
import { DriverModel } from "@/models/Driver";
import { DriverPaymentRecordModel } from "@/models/DriverPaymentRecord";
import { computeRunPayment, matchDriver } from "@/lib/payments/computeRunPayment";
import type { Driver } from "@/types/driver";

type MinimalRun = {
  _id: { toString(): string };
  run_date: string;
  driver_name: string;
  status: string;
  actual_start_time?: string | null;
  optimized_route?: {
    stops?: { completed_at?: string }[];
    total_distance_km?: number;
    return_distance_km?: number;
  } | null;
};

/**
 * Upsert a payment record for a single completed run.
 * Preserves any existing hours_override / override_reason on re-compute.
 * Best-effort: never throws.
 */
export async function recordRunPayment(run: MinimalRun): Promise<void> {
  if (run.status !== "completed") return;
  const runId = run._id.toString();
  try {
    await connectDB();

    const drivers = await DriverModel.find({ active: true }).lean() as unknown as (Driver & { _id: { toString(): string } })[];
    const matched = matchDriver(run.driver_name, drivers.map(d => ({ _id: d._id.toString(), display_name: d.display_name, aliases: d.aliases })));
    const driver = matched ? drivers.find(d => d._id.toString() === matched._id) ?? null : null;

    // Preserve existing override if one was previously set
    const existing = await DriverPaymentRecordModel.findOne({ run_id: runId }).lean() as unknown as { hours_override?: number | null; override_reason?: string; sheet_sync?: unknown } | null;
    const hoursOverride = existing?.hours_override ?? null;
    const overrideReason = existing?.override_reason;

    const computed = computeRunPayment({
      runId,
      run,
      driver: driver ? {
        _id: driver._id.toString(),
        hourly_rate: driver.hourly_rate,
        fuel_rate_per_km: driver.fuel_rate_per_km,
        start_date: driver.start_date,
        deposit_weeks: driver.deposit_weeks,
      } : null,
      hoursOverride,
      overrideReason,
    });

    await DriverPaymentRecordModel.findOneAndUpdate(
      { run_id: runId },
      {
        $set: {
          ...computed,
          run_id: runId,
          sheet_sync: (existing as { sheet_sync?: unknown } | null)?.sheet_sync ?? { status: "pending", attempts: 0 },
        },
      },
      { upsert: true, new: true }
    );

    // Attempt sheet rebuild best-effort (imported lazily to avoid loading googleapis at boot)
    try {
      const { rebuildDriverTab } = await import("@/lib/sheets/payrollSheet");
      if (driver) {
        await rebuildDriverTab(driver);
      }
    } catch (sheetErr) {
      console.warn("[payment] sheet rebuild skipped:", sheetErr instanceof Error ? sheetErr.message : sheetErr);
    }
  } catch (err) {
    console.error("[payment] recordRunPayment failed for run", runId, err instanceof Error ? err.message : err);
  }
}

/**
 * Recompute all payment records for a specific driver (after rate or alias change).
 * Also re-matches unassigned records whose driver_name_raw now matches this driver.
 * Best-effort per record.
 */
export async function recomputeDriverPayments(driverId: string): Promise<void> {
  try {
    await connectDB();
    const driver = await DriverModel.findById(driverId).lean() as unknown as (Driver & { _id: { toString(): string } }) | null;
    if (!driver) return;

    const driverInput = {
      _id: driver._id.toString(),
      hourly_rate: driver.hourly_rate,
      fuel_rate_per_km: driver.fuel_rate_per_km,
      start_date: driver.start_date,
      deposit_weeks: driver.deposit_weeks,
    };

    // Find all records assigned to this driver OR with pending_rate + matching alias
    const { DeliveryRunModel } = await import("@/models/DeliveryRun");

    // Assigned records
    const assignedRecords = await DriverPaymentRecordModel.find({ driver_id: driverId }).lean();
    // Unassigned records whose raw name matches this driver's aliases
    const unassignedRecords = await DriverPaymentRecordModel.find({
      driver_id: null,
      status: "pending_rate",
    }).lean();

    const normalizedAliases = driver.aliases.map(a => a.toLowerCase().trim());

    const toRecompute = [
      ...assignedRecords,
      ...unassignedRecords.filter(r =>
        normalizedAliases.includes(r.driver_name_raw.toLowerCase().trim())
      ),
    ];

    for (const record of toRecompute) {
      try {
        const run = await DeliveryRunModel.findById(record.run_id).lean() as unknown as MinimalRun | null;
        if (!run) continue;

        const computed = computeRunPayment({
          runId: record.run_id,
          run,
          driver: driverInput,
          hoursOverride: record.hours_override ?? null,
          overrideReason: record.override_reason,
        });

        await DriverPaymentRecordModel.findOneAndUpdate(
          { run_id: record.run_id },
          { $set: { ...computed, run_id: record.run_id } },
          { upsert: true }
        );
      } catch (err) {
        console.warn("[payment] recompute failed for record", record.run_id, err instanceof Error ? err.message : err);
      }
    }

    // Rebuild the sheet for this driver
    try {
      const { rebuildDriverTab } = await import("@/lib/sheets/payrollSheet");
      await rebuildDriverTab(driver);
    } catch (sheetErr) {
      console.warn("[payment] sheet rebuild after recompute skipped:", sheetErr instanceof Error ? sheetErr.message : sheetErr);
    }
  } catch (err) {
    console.error("[payment] recomputeDriverPayments failed for driver", driverId, err instanceof Error ? err.message : err);
  }
}
