/**
 * Admin API: single driver CRUD.
 * GET    /api/drivers/[id]   — get profile
 * PUT    /api/drivers/[id]   — update profile; recomputes affected payment records on rate/alias changes
 * DELETE /api/drivers/[id]   — soft delete (sets active: false)
 */

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import type { Driver } from "@/types/driver";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverModel } from "@/models/Driver";
import { normalizeName } from "@/lib/payments/computeRunPayment";
import { recomputeDriverPayments } from "@/lib/payments/recordRunPayment";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid driver ID");
    await connectDB();
    const driver = await DriverModel.findById(id).lean() as unknown as (Driver & { _id: { toString(): string } }) | null;
    if (!driver) throw notFound("Driver not found");
    return json({ ...driver, _id: driver._id.toString() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid driver ID");
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

    await connectDB();
    const driver = await DriverModel.findById(id);
    if (!driver) throw notFound("Driver not found");

    const rateChanged =
      (body.hourly_rate !== undefined && body.hourly_rate !== driver.hourly_rate) ||
      (body.fuel_rate_per_km !== undefined && body.fuel_rate_per_km !== driver.fuel_rate_per_km);

    // Snapshot rate history on rate change
    if (rateChanged) {
      const entry = {
        hourly_rate: driver.hourly_rate,
        fuel_rate_per_km: driver.fuel_rate_per_km,
        changed_at: new Date().toISOString(),
      };
      driver.rate_history = [...(driver.rate_history ?? []), entry];
    }

    const allowed = [
      "display_name",
      "hourly_rate",
      "fuel_rate_per_km",
      "start_date",
      "deposit_weeks",
      "payout_cadence_weeks",
      "currency",
      "active",
      "notes",
      "extra_aliases",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined && key !== "extra_aliases") {
        (driver as Record<string, unknown>)[key] = body[key];
      }
    }

    // Rebuild aliases if display_name or extra_aliases changed
    if (body.display_name || body.extra_aliases) {
      const extras: string[] = Array.isArray(body.extra_aliases) ? body.extra_aliases : [];
      driver.aliases = Array.from(
        new Set([normalizeName(driver.display_name), ...extras.map(normalizeName)])
      );
    }

    await driver.save();

    const saved = { ...driver.toObject(), _id: driver._id.toString() };

    // If rate or aliases changed, recompute payment records in the background
    if (rateChanged || body.display_name || body.extra_aliases) {
      recomputeDriverPayments(id).catch(() => {});
    }

    return json(saved);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw badRequest("Invalid driver ID");
    await connectDB();
    const driver = await DriverModel.findById(id);
    if (!driver) throw notFound("Driver not found");
    // Soft delete — preserves payment history
    driver.active = false;
    await driver.save();
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
