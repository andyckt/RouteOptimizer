import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { uploadProofImages } from "@/lib/upload/proof";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";
import { sendSms } from "@/lib/openphone/client";
import { getServerEnv } from "@/lib/env";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import type { OptimizedStop } from "@/types/delivery-run";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024;
const DELIVERED_SMS = "您好，今天的餐食已经送达了，请慢用~";

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    const formData = await req.formData();
    const token = formData.get("token");
    if (typeof token !== "string" || !verifyDriverToken(id, token)) {
      throw badRequest("Invalid or missing driver token");
    }

    const stopIndexStr = formData.get("stopIndex");
    const stopIndex =
      typeof stopIndexStr === "string" ? parseInt(stopIndexStr, 10) : NaN;
    if (isNaN(stopIndex) || stopIndex < 0) {
      throw badRequest("Invalid stopIndex");
    }

    const images = formData.getAll("images");
    const files = images.filter(
      (x): x is File => x instanceof File && x.size > 0
    );
    if (files.length === 0 || files.length > 3) {
      throw validationError("Provide 1–3 images (jpg/png/webp, max 10MB each)");
    }

    for (const f of files) {
      if (f.size > MAX_SIZE) {
        throw validationError("Each image must be under 10MB");
      }
      if (!ALLOWED_TYPES.includes(f.type)) {
        throw validationError("Only JPG, PNG, and WebP allowed");
      }
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const route = run.optimized_route;
    if (!route?.stops?.length || stopIndex >= route.stops.length) {
      throw validationError("Invalid stop index");
    }

    const stop = route.stops[stopIndex] as OptimizedStop;

    if (stop.completed) {
      const doc = run.toObject() as {
        _id: { toString(): string };
        [k: string]: unknown;
      };
      return json({
        run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
        idempotent: true,
      });
    }

    const filePayloads = await Promise.all(
      files.map(async (f) => ({
        buffer: Buffer.from(await f.arrayBuffer()),
        name: f.name,
        type: f.type,
      }))
    );
    const urls = await uploadProofImages(id, stopIndex, filePayloads);

    const existing = (stop.proof_of_delivery_images ?? []) as string[];
    const allUrls = [...existing, ...urls];
    stop.proof_of_delivery_images = allUrls;
    stop.proof_of_delivery = allUrls[0];
    stop.completed = true;
    stop.completed_at = new Date().toISOString();

    const allStopsCompleted = route.stops.every(
      (s: { completed?: boolean }) => Boolean(s.completed)
    );
    if (allStopsCompleted) {
      run.status = "completed";
    }

    await run.save();

    const { OPENPHONE_FROM } = getServerEnv();
    const toE164 = toE164NorthAmerica(String(stop.customer_phone ?? ""));
    if (toE164) {
      const smsResult = await sendSms({
        from: OPENPHONE_FROM,
        toE164,
        content: DELIVERED_SMS,
      });
      if (!smsResult.success) {
        const doc = run.toObject() as {
          _id: { toString(): string };
          [k: string]: unknown;
        };
        return json({
          run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
          delivered_sms_sent: false,
          delivered_sms_error: smsResult.error,
        });
      }
    }

    const doc = run.toObject() as {
      _id: { toString(): string };
      [k: string]: unknown;
    };
    return json({
      run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
      ...(toE164 && { delivered_sms_sent: true }),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
