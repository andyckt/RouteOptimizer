/**
 * Admin API: manually trigger Google Sheets rebuild for one or all drivers.
 * POST /api/driver-payments/sync?driver_id=   — rebuild one driver's tab
 * POST /api/driver-payments/sync              — rebuild all active drivers
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverModel } from "@/models/Driver";
import { rebuildDriverTab } from "@/lib/sheets/payrollSheet";
import { getSheetsConfig } from "@/lib/sheets/client";
import type { Driver } from "@/types/driver";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    requireAdminSession(req);

    if (!getSheetsConfig()) {
      return json({
        status: "disabled",
        message: "GOOGLE_SHEETS_PAYROLL_SPREADSHEET_ID is not configured. Records are still computed in the DB.",
      });
    }

    await connectDB();
    const driverId = req.nextUrl.searchParams.get("driver_id");

    if (driverId) {
      const driver = await DriverModel.findById(driverId).lean() as unknown as (Driver & { _id: { toString(): string } }) | null;
      if (!driver) return json({ error: "Driver not found" }, { status: 404 });
      await rebuildDriverTab(driver);
      return json({ status: "ok", rebuilt: [driver.display_name] });
    }

    const drivers = await DriverModel.find({ active: true }).lean() as unknown as (Driver & { _id: { toString(): string } })[];
    const results: { name: string; status: string }[] = [];
    for (const driver of drivers) {
      try {
        await rebuildDriverTab(driver);
        results.push({ name: driver.display_name, status: "ok" });
      } catch (err) {
        results.push({ name: driver.display_name, status: err instanceof Error ? err.message : "failed" });
      }
    }
    return json({ status: "done", results });
  } catch (err) {
    return handleApiError(err);
  }
}
