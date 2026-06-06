/**
 * Admin API: unassigned payment records (no driver profile match).
 * GET  /api/driver-payments/unassigned   — list unassigned records
 * POST /api/driver-payments/unassigned   — assign a raw name to a driver (adds alias, recomputes)
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverPaymentRecordModel } from "@/models/DriverPaymentRecord";
import { DriverModel } from "@/models/Driver";
import { normalizeName } from "@/lib/payments/computeRunPayment";
import { recomputeDriverPayments } from "@/lib/payments/recordRunPayment";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);
    await connectDB();

    const records = await DriverPaymentRecordModel.find({
      driver_id: null,
    })
      .sort({ run_date: 1 })
      .lean();

    // Group by raw driver name for easier admin display
    const grouped = new Map<string, typeof records>();
    for (const r of records) {
      const key = r.driver_name_raw;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(r);
    }

    const groupList: { driver_name_raw: string; count: number; records: unknown[] }[] = [];
    grouped.forEach((recs, name) => {
      groupList.push({
        driver_name_raw: name,
        count: recs.length,
        records: recs.map(r => ({ ...r, _id: (r._id as unknown as { toString(): string }).toString() })),
      });
    });

    return json(groupList);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdminSession(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

    const { driver_name_raw, driver_id } = body as { driver_name_raw?: string; driver_id?: string };
    if (!driver_name_raw || typeof driver_name_raw !== "string")
      throw badRequest("driver_name_raw is required");
    if (!driver_id || typeof driver_id !== "string")
      throw badRequest("driver_id is required");

    await connectDB();
    const driver = await DriverModel.findById(driver_id);
    if (!driver) throw notFound("Driver not found");

    // Add alias if not already present
    const normalizedAlias = normalizeName(driver_name_raw);
    if (!driver.aliases.includes(normalizedAlias)) {
      driver.aliases = [...driver.aliases, normalizedAlias];
      await driver.save();
    }

    // Recompute and re-assign all unassigned records with this raw name
    const unassigned = await DriverPaymentRecordModel.find({
      driver_id: null,
      driver_name_raw: { $regex: new RegExp(`^${driver_name_raw.trim()}$`, "i") },
    });

    // Update driver_id so recomputeDriverPayments can pick them up
    await DriverPaymentRecordModel.updateMany(
      { driver_id: null, driver_name_raw: { $regex: new RegExp(`^${driver_name_raw.trim()}$`, "i") } },
      { $set: { driver_id: driver_id } }
    );

    // Recompute all affected records
    recomputeDriverPayments(driver_id).catch(() => {});

    return json({
      assigned_count: unassigned.length,
      alias_added: normalizedAlias,
      driver_id,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
