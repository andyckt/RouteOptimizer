import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { verifyDriverToken } from "@/lib/security/driverToken";
import type { OptimizedStop } from "@/types/delivery-run";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024;

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
    const stopIndex = typeof stopIndexStr === "string" ? parseInt(stopIndexStr, 10) : NaN;
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

    const uploadDir = path.join(
      process.cwd(),
      "public",
      "uploads",
      id,
      String(stopIndex)
    );
    await fs.mkdir(uploadDir, { recursive: true });

    const urls: string[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop() || "jpg";
      const safeExt = ["jpg", "jpeg", "png", "webp"].includes(ext.toLowerCase())
        ? ext.toLowerCase()
        : "jpg";
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
      const filepath = path.join(uploadDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filepath, buffer);
      urls.push(`/uploads/${id}/${stopIndex}/${filename}`);
    }

    const stop = route.stops[stopIndex] as OptimizedStop;
    const existing = (stop.proof_of_delivery_images ?? []) as string[];
    const allUrls = [...existing, ...urls];
    stop.proof_of_delivery_images = allUrls;
    stop.proof_of_delivery = allUrls[0];

    await run.save();

    return json({
      stop: {
        ...stop,
        proof_of_delivery_images: allUrls,
        proof_of_delivery: allUrls[0],
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
