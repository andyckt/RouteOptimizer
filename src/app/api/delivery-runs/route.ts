import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";
import { createDeliveryRunFromPayload } from "@/lib/services/delivery-run-service";

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
    await connectDB();
    const runs = await DeliveryRunModel.find().sort({ createdAt: -1 }).lean();
    return json(
      runs.map((r) => ({
        ...sanitizeRunForResponse(r),
        _id: (r as { _id: { toString(): string } })._id.toString(),
      }))
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAdminSession(request);
    const body = await request.json().catch(() => ({}));
    const run = await createDeliveryRunFromPayload({
      run_date: body.run_date,
      driver_name: body.driver_name,
      start_location: body.start_location,
      end_location: body.end_location,
      start_time: body.start_time,
      travel_mode: body.travel_mode,
      customers: body.customers ?? [],
    });
    const sanitized = sanitizeRunForResponse(run.toObject());
    return json({ ...sanitized, _id: run._id.toString() }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
