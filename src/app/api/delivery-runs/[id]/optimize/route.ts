import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest } from "@/lib/http/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { optimizeDeliveryRunById } from "@/lib/services/delivery-run-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `optimize:${ip}`,
      windowMs: 60_000,
      maxRequests: 10,
    });

    const run = await optimizeDeliveryRunById(id);

    return json({
      run: {
        ...run.toObject(),
        _id: run._id.toString(),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
