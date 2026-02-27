import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";
import { verifyDriverToken } from "@/lib/security/driverToken";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    const token = req.nextUrl.searchParams.get("token");
    if (!token || !verifyDriverToken(id, token)) {
      return json({ error: "Invalid or missing driver token" }, { status: 403 });
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id).lean();
    if (!run) throw notFound("Delivery run not found");

    const doc = run as { _id: { toString(): string }; [k: string]: unknown };
    return json({ ...sanitizeRunForResponse(doc), _id: doc._id.toString() });
  } catch (err) {
    return handleApiError(err);
  }
}
