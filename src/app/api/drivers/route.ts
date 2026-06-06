/**
 * Admin API: manage driver pay profiles.
 * GET  /api/drivers        — list all (active by default)
 * POST /api/drivers        — create a new driver profile
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverModel } from "@/models/Driver";
import { normalizeName } from "@/lib/payments/computeRunPayment";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);
    await connectDB();

    const includeInactive = req.nextUrl.searchParams.get("include_inactive") === "true";
    const filter = includeInactive ? {} : { active: true };
    const drivers = await DriverModel.find(filter).sort({ display_name: 1 }).lean();
    return json(
      drivers.map((d) => ({
        ...d,
        _id: (d._id as { toString(): string }).toString(),
      }))
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdminSession(req);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

    const {
      display_name,
      hourly_rate,
      fuel_rate_per_km = 0,
      start_date,
      deposit_weeks = 0,
      payout_cadence_weeks = 2,
      currency = "CAD",
      notes,
      extra_aliases = [],
    } = body as Record<string, unknown>;

    if (!display_name || typeof display_name !== "string")
      throw badRequest("display_name is required");
    if (typeof hourly_rate !== "number" || hourly_rate < 0)
      throw badRequest("hourly_rate must be a non-negative number");
    if (!start_date || typeof start_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start_date))
      throw badRequest("start_date must be YYYY-MM-DD");

    await connectDB();

    // Build aliases: always include normalized display_name + any extras
    const aliases = Array.from(
      new Set([
        normalizeName(display_name as string),
        ...((extra_aliases as string[]).map(normalizeName)),
      ])
    );

    const driver = await DriverModel.create({
      display_name,
      aliases,
      hourly_rate,
      fuel_rate_per_km,
      start_date,
      deposit_weeks,
      payout_cadence_weeks,
      currency,
      notes,
      active: true,
    });

    return json(
      { ...driver.toObject(), _id: driver._id.toString() },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
