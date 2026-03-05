import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { getR2ConfigFromEnv } from "@/lib/r2/client";
import { createPresignedUploadUrls } from "@/lib/r2/client";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/**
 * Returns presigned URLs for direct browser upload to R2.
 * Client uploads files to these URLs, then calls complete-with-proof with the public URLs.
 * Returns 404 with useFormDataFallback: true when R2 is not configured.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { token?: string; stopIndex?: number; files?: Array<{ name: string; type: string }> };
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

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length < 1 || files.length > 3) {
      throw validationError("Provide 1–3 files");
    }

    for (const f of files) {
      if (typeof f?.name !== "string" || typeof f?.type !== "string") {
        throw validationError("Each file must have name and type");
      }
      if (!ALLOWED_TYPES.includes(f.type)) {
        throw validationError(`Invalid type: ${f.type}. Use JPG, PNG, WebP, or HEIC.`);
      }
    }

    const r2Config = getR2ConfigFromEnv();
    if (!r2Config) {
      return json(
        { useFormDataFallback: true, message: "R2 not configured; use FormData upload" },
        { status: 404 }
      );
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const route = run.optimized_route;
    if (!route?.stops?.length || stopIndex >= route.stops.length) {
      throw validationError("Invalid stop index");
    }

    const uploads = await createPresignedUploadUrls(r2Config, id, stopIndex, files);
    return json({
      uploads: uploads.map((u) => ({
        uploadUrl: u.uploadUrl,
        publicUrl: u.publicUrl,
        contentType: u.contentType,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
