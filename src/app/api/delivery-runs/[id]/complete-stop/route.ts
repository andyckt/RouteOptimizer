import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";
import { sendSms } from "@/lib/openphone/client";
import { getServerEnv } from "@/lib/env";
import { toE164NorthAmerica } from "@/lib/phone/e164";

const DELIVERED_SMS = "您好，今天的餐食已经送达了，请慢用~";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { token?: string; stopIndex?: number };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const token = typeof body.token === "string" ? body.token : undefined;
    if (!token || !verifyDriverToken(id, token)) {
      throw badRequest("Invalid or missing driver token");
    }

    const stopIndex =
      typeof body.stopIndex === "number"
        ? body.stopIndex
        : typeof body.stopIndex === "string"
          ? parseInt(body.stopIndex, 10)
          : NaN;
    if (isNaN(stopIndex) || stopIndex < 0) {
      throw badRequest("Invalid stopIndex");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const route = run.optimized_route;
    if (!route?.stops?.length || stopIndex >= route.stops.length) {
      throw validationError("Invalid stop index");
    }

    const stop = route.stops[stopIndex] as Record<string, unknown>;
    stop.completed = true;
    stop.completed_at = new Date().toISOString();

    const allStopsCompleted = route.stops.every(
      (s: { completed?: boolean }) => Boolean(s.completed)
    );
    if (allStopsCompleted) {
      run.status = "completed";
    }

    await run.save();

    // Send "delivered" SMS to customer
    const { OPENPHONE_FROM } = getServerEnv();
    const toE164 = toE164NorthAmerica(String(stop.customer_phone ?? ""));
    if (toE164) {
      const smsResult = await sendSms({
        from: OPENPHONE_FROM,
        toE164,
        content: DELIVERED_SMS,
      });
      if (!smsResult.success) {
        // Still return success; stop is completed; include SMS failure for transparency
        const doc = run.toObject() as { _id: { toString(): string }; [k: string]: unknown };
        return json({
          run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
          delivered_sms_sent: false,
          delivered_sms_error: smsResult.error,
        });
      }
    }

    const doc = run.toObject() as { _id: { toString(): string }; [k: string]: unknown };
    return json({
      run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
      ...(toE164 && { delivered_sms_sent: true }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
