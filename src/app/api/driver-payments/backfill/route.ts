/**
 * Admin API: backfill payment records for completed runs in a date range.
 * POST /api/driver-payments/backfill?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 * Queries all completed runs in the date range and triggers recordRunPayment for each.
 * Returns count of processed runs and any errors.
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { recordRunPayment } from "@/lib/payments/recordRunPayment";

export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  try {
    requireAdminSession(req);

    const startDate = req.nextUrl.searchParams.get("start_date");
    const endDate = req.nextUrl.searchParams.get("end_date");

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDate || !dateRegex.test(startDate)) {
      return json({ error: "start_date is required and must be YYYY-MM-DD format" }, { status: 400 });
    }
    if (!endDate || !dateRegex.test(endDate)) {
      return json({ error: "end_date is required and must be YYYY-MM-DD format" }, { status: 400 });
    }

    if (startDate > endDate) {
      return json({ error: "start_date must be <= end_date" }, { status: 400 });
    }

    await connectDB();

    // Query all completed runs in the date range
    const runs = await DeliveryRunModel.find({
      run_date: { $gte: startDate, $lte: endDate },
      status: "completed",
    })
      .lean()
      .select("_id run_date driver_name status actual_start_time optimized_route")
      .sort({ run_date: 1 });

    if (runs.length === 0) {
      return json({
        status: "ok",
        message: "No completed runs found in date range",
        processed: 0,
        failed: 0,
      });
    }

    // Process each run
    let processed = 0;
    let failed = 0;
    const errors: { run_id: string; error: string }[] = [];

    for (const run of runs) {
      try {
        await recordRunPayment(run as unknown as MinimalRun);
        processed++;
      } catch (err) {
        failed++;
        errors.push({
          run_id: (run._id as { toString(): string }).toString(),
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return json({
      status: "ok",
      date_range: { start: startDate, end: endDate },
      total_runs: runs.length,
      processed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
