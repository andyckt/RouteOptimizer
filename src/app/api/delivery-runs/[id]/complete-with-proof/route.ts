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
import { getR2ConfigFromEnv } from "@/lib/r2/client";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import type { KapiooSyncState, OptimizedStop } from "@/types/delivery-run";
import { runKapiooSync } from "@/lib/kapioo/sync";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_SIZE = 10 * 1024 * 1024;
const DELIVERED_SMS = "您好，今天的餐食已送达，您可在订单详情中查看送达照片喔~";

/** Validates that URLs are from our R2 bucket or local /uploads/ path */
function validateImageUrls(urls: string[], runId: string): void {
  const r2Config = getR2ConfigFromEnv();
  const base = r2Config?.publicUrl?.replace(/\/$/, "") ?? "";

  for (const url of urls) {
    if (typeof url !== "string" || url.length < 10) {
      throw validationError("Invalid image URL");
    }
    const hasRunId = url.includes(runId);
    const fromUploads = url.startsWith("/uploads/");
    const fromR2 = base && url.startsWith(base);
    if (!hasRunId || (!fromUploads && !fromR2)) {
      throw validationError("Image URL must be from our storage");
    }
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const reqId = `req-${Date.now().toString(36)}`;
  try {
    const { id } = await params;
    const contentLength = req.headers.get("content-length");
    const contentType = req.headers.get("content-type") ?? "";
    console.log(
      JSON.stringify({
        event: "complete_with_proof_start",
        reqId,
        runId: id,
        contentLength: contentLength ? parseInt(contentLength, 10) : null,
        mode: contentType.includes("application/json") ? "json" : "form",
      })
    );
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let token: string;
    let stopIndex: number;
    let urls: string[];

    if (contentType.includes("application/json")) {
      let body: { token?: string; stopIndex?: number; imageUrls?: string[] };
      try {
        body = await req.json();
      } catch {
        throw badRequest("Invalid JSON body");
      }
      token = typeof body.token === "string" ? body.token : "";
      if (!token || !verifyDriverToken(id, token)) {
        throw badRequest("Invalid or missing driver token");
      }
      stopIndex =
        typeof body.stopIndex === "number"
          ? body.stopIndex
          : typeof body.stopIndex === "string"
            ? parseInt(body.stopIndex, 10)
            : NaN;
      if (isNaN(stopIndex) || stopIndex < 0) {
        throw badRequest("Invalid stopIndex");
      }
      const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls : [];
      if (imageUrls.length < 1 || imageUrls.length > 3) {
        throw validationError("Provide 1–3 image URLs");
      }
      validateImageUrls(imageUrls, id);
      urls = imageUrls;
      console.log(
        JSON.stringify({
          event: "complete_with_proof_direct_upload",
          reqId,
          runId: id,
          stopIndex,
          urlCount: urls.length,
        })
      );
    } else {
      const formData = await req.formData();
      token = typeof formData.get("token") === "string" ? formData.get("token") as string : "";
      if (!token || !verifyDriverToken(id, token)) {
        throw badRequest("Invalid or missing driver token");
      }
      const stopIndexStr = formData.get("stopIndex");
      stopIndex =
        typeof stopIndexStr === "string" ? parseInt(stopIndexStr, 10) : NaN;
      if (isNaN(stopIndex) || stopIndex < 0) {
        throw badRequest("Invalid stopIndex");
      }
      const images = formData.getAll("images");
      const files = images.filter(
        (x): x is File => x instanceof File && x.size > 0
      );
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      console.log(
        JSON.stringify({
          event: "complete_with_proof_images",
          reqId,
          runId: id,
          stopIndex,
          fileCount: files.length,
          totalBytes,
        })
      );
      if (files.length === 0 || files.length > 3) {
        throw validationError("Provide 1–3 images (jpg/png/webp, max 10MB each)");
      }
      for (const f of files) {
        if (f.size > MAX_SIZE) {
          throw validationError("Each image must be under 10MB");
        }
        if (!ALLOWED_TYPES.includes(f.type)) {
          throw validationError("Only JPG, PNG, WebP, or HEIC allowed");
        }
      }
      const filePayloads = await Promise.all(
        files.map(async (f) => ({
          buffer: Buffer.from(await f.arrayBuffer()),
          name: f.name,
          type: f.type,
        }))
      );
      urls = await uploadProofImages(id, stopIndex, filePayloads);
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

    const existing = (stop.proof_of_delivery_images ?? []) as string[];
    const allUrls = [...existing, ...urls];
    const completedAt = new Date().toISOString();

    // Atomic update: only set completed if not already completed.
    // Prevents double-SMS when driver double-taps or offline queue retries.
    const prefix = `optimized_route.stops.${stopIndex}`;
    const updatedRun = await DeliveryRunModel.findOneAndUpdate(
      {
        _id: id,
        [prefix + ".completed"]: { $ne: true },
      },
      {
        $set: {
          [prefix + ".proof_of_delivery_images"]: allUrls,
          [prefix + ".proof_of_delivery"]: allUrls[0],
          [prefix + ".completed"]: true,
          [prefix + ".completed_at"]: completedAt,
        },
      },
      { new: true }
    );

    if (!updatedRun) {
      // Another request already completed this stop (race / retry). Return idempotent.
      const current = await DeliveryRunModel.findById(id).lean();
      const doc = current as {
        _id: { toString(): string };
        [k: string]: unknown;
      };
      return json({
        run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
        idempotent: true,
      });
    }

    const routeAfter = updatedRun.optimized_route;
    const allStopsCompleted =
      routeAfter?.stops?.every(
        (s: { completed?: boolean }) => Boolean(s.completed)
      ) ?? false;
    if (allStopsCompleted) {
      await DeliveryRunModel.updateOne(
        { _id: id },
        { $set: { status: "completed" } }
      );
    }

    const stopAfter = routeAfter?.stops?.[stopIndex] as OptimizedStop | undefined;
    const { OPENPHONE_FROM } = getServerEnv();
    const rawPhone = String(stopAfter?.customer_phone ?? stop.customer_phone ?? "");
    const toE164 = toE164NorthAmerica(rawPhone);
    console.log(
      JSON.stringify({
        event: "complete_with_proof_success",
        reqId,
        runId: id,
        stopIndex,
        customerName: stopAfter?.customer_name ?? stop.customer_name,
        smsTo: toE164 ? "sent" : "skipped",
      })
    );

    // Run SMS and Kapioo Admin sync in parallel so driver latency stays close to
    // max(SMS, Kapioo) rather than sum. Both are tolerant to failure: neither can
    // roll back the local completion that already succeeded above.
    const smsPromise =
      toE164
        ? sendSms({
            from: OPENPHONE_FROM,
            toE164,
            content: DELIVERED_SMS,
          })
        : Promise.resolve({ success: true as const });

    const kapiooStop = (routeAfter?.stops?.[stopIndex] ?? stop) as OptimizedStop;
    const kapiooPromise = runKapiooSync({
      runId: id,
      stopIndex,
      stop: kapiooStop,
      driverName: typeof updatedRun.driver_name === "string" ? updatedRun.driver_name : undefined,
      // First completion path: no prior attempts. The retry endpoint reads existing attempts itself.
      priorAttempts: 0,
    });

    const [smsSettled, kapiooSettled] = await Promise.allSettled([smsPromise, kapiooPromise]);

    // Persist the Kapioo sync outcome. We only attempt the field write for the first-completion
    // branch; concurrent retries that hit the idempotent branch above return early without
    // touching kapioo_sync, so they don't clobber a successful prior write.
    let kapiooSync: KapiooSyncState | null = null;
    if (kapiooSettled.status === "fulfilled") {
      kapiooSync = kapiooSettled.value;
    } else {
      // Defensive: runKapiooSync never throws, but if something escaped, record it.
      const reason = "admin-api-5xx" as const;
      kapiooSync = {
        status: "failed",
        reason,
        attempted_at: new Date().toISOString(),
        attempts: 1,
        error_message:
          kapiooSettled.reason instanceof Error
            ? kapiooSettled.reason.message
            : String(kapiooSettled.reason ?? "Unknown error"),
      };
    }
    if (kapiooSync) {
      try {
        await DeliveryRunModel.updateOne(
          { _id: id },
          { $set: { [prefix + ".kapioo_sync"]: kapiooSync } }
        );
      } catch (persistErr) {
        // Logging only — failing to write the audit field must not fail the driver request.
        console.error(
          JSON.stringify({
            event: "complete_with_proof_kapioo_persist_failed",
            reqId,
            runId: id,
            stopIndex,
            error:
              persistErr instanceof Error ? persistErr.message : String(persistErr),
          })
        );
      }
      console.log(
        JSON.stringify({
          event: "complete_with_proof_kapioo_sync",
          reqId,
          runId: id,
          stopIndex,
          status: kapiooSync.status,
          reason: kapiooSync.reason,
          updated: kapiooSync.updated_order_ids?.length ?? 0,
          skipped: kapiooSync.skipped_order_ids?.length ?? 0,
          missing: kapiooSync.missing_order_ids?.length ?? 0,
        })
      );
    }

    let smsSuccess = true;
    let smsError: string | undefined;
    if (smsSettled.status === "fulfilled") {
      if (!smsSettled.value.success) {
        smsSuccess = false;
        smsError = smsSettled.value.error;
      }
    } else {
      smsSuccess = false;
      smsError =
        smsSettled.reason instanceof Error
          ? smsSettled.reason.message
          : String(smsSettled.reason);
    }
    if (toE164 && !smsSuccess) {
      console.error(
        JSON.stringify({
          event: "complete_with_proof_sms_failed",
          reqId,
          runId: id,
          toE164,
          error: smsError,
        })
      );
    }

    // Re-read to include the freshly-persisted kapioo_sync field in the response.
    const finalRun = (await DeliveryRunModel.findById(id).lean()) ?? updatedRun.toObject();
    const doc = finalRun as {
      _id: { toString(): string };
      [k: string]: unknown;
    };
    if (toE164 && !smsSuccess) {
      return json({
        run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
        delivered_sms_sent: false,
        delivered_sms_error: smsError,
      });
    }
    return json({
      run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
      ...(toE164 && { delivered_sms_sent: true }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "complete_with_proof_error",
        reqId,
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : undefined,
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    return handleApiError(err);
  }
}
