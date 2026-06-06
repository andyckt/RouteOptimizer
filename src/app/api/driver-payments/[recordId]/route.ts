/**
 * Admin API: single payment record — hours override + recompute.
 * PUT /api/driver-payments/[recordId]
 */

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverPaymentRecordModel } from "@/models/DriverPaymentRecord";
import { DriverModel } from "@/models/Driver";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { computeRunPayment } from "@/lib/payments/computeRunPayment";
import { rebuildDriverTab } from "@/lib/sheets/payrollSheet";
import type { Driver } from "@/types/driver";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ recordId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { recordId } = await params;
    if (!mongoose.Types.ObjectId.isValid(recordId)) throw badRequest("Invalid record ID");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

    const { hours_override, override_reason, clear_override } = body as {
      hours_override?: number;
      override_reason?: string;
      clear_override?: boolean;
    };

    if (!clear_override && typeof hours_override !== "number")
      throw badRequest("hours_override must be a number, or pass clear_override: true");
    if (typeof hours_override === "number" && hours_override < 0)
      throw badRequest("hours_override must be non-negative");

    await connectDB();
    const record = await DriverPaymentRecordModel.findById(recordId);
    if (!record) throw notFound("Payment record not found");

    const run = await DeliveryRunModel.findById(record.run_id).lean() as unknown as {
      _id: { toString(): string };
      run_date: string;
      driver_name: string;
      actual_start_time?: string | null;
      optimized_route?: {
        stops?: { completed_at?: string }[];
        total_distance_km?: number;
        return_distance_km?: number;
      } | null;
    } | null;
    if (!run) throw notFound("Associated run not found");

    let driver: Pick<Driver, "_id" | "hourly_rate" | "fuel_rate_per_km" | "start_date" | "deposit_weeks"> | null = null;
    if (record.driver_id) {
      const d = await DriverModel.findById(record.driver_id).lean() as unknown as (Driver & { _id: { toString(): string } }) | null;
      if (d) {
        driver = {
          _id: d._id.toString(),
          hourly_rate: d.hourly_rate,
          fuel_rate_per_km: d.fuel_rate_per_km,
          start_date: d.start_date,
          deposit_weeks: d.deposit_weeks,
        };
      }
    }

    const hoursOverride = clear_override ? null : (hours_override ?? null);

    const computed = computeRunPayment({
      runId: record.run_id,
      run,
      driver,
      hoursOverride,
      overrideReason: clear_override ? undefined : override_reason,
    });

    Object.assign(record, computed);
    await record.save();

    // Best-effort sheet rebuild
    if (driver) {
      const fullDriver = await DriverModel.findById(record.driver_id).lean() as unknown as Driver | null;
      if (fullDriver) rebuildDriverTab(fullDriver).catch(() => {});
    }

    return json({ ...record.toObject(), _id: record._id.toString() });
  } catch (err) {
    return handleApiError(err);
  }
}
