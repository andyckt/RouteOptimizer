import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const token = typeof body.token === "string" ? body.token : undefined;
    if (!token || !verifyDriverToken(id, token)) {
      throw badRequest("Invalid or missing driver token");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const stops = run.optimized_route?.stops ?? [];
    const allCompleted =
      stops.length > 0 &&
      stops.every((s: { completed?: boolean }) => Boolean(s.completed));
    if (!allCompleted) {
      throw validationError("All stops must be completed before completing the run.");
    }

    run.status = "completed";
    await run.save();

    const doc = run.toObject() as { _id: { toString(): string }; [k: string]: unknown };
    return json({ run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() } });
  } catch (err) {
    return handleApiError(err);
  }
}
