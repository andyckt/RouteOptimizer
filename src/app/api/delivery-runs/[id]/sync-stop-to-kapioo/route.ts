/**
 * Admin-only retry endpoint for Kapioo Admin sync of a single completed stop.
 *
 * - Never touches `completed` / `completed_at` / `proof_of_delivery*` fields.
 * - Re-reads `stop.order_ids` (the SSOT) at call time so admin edits to the stop are honored.
 * - Increments `kapioo_sync.attempts` by 1.
 * - Idempotent server-side via Kapioo Admin's own `updated/skipped/missing` semantics.
 *
 * No driver token path — drivers do not see or trigger Kapioo sync UI.
 */

import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { sanitizeRunForResponse } from "@/lib/normalization/delivery-run";
import { runKapiooSync } from "@/lib/kapioo/sync";
import type { KapiooSyncState, OptimizedStop } from "@/types/delivery-run";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { stopIndex?: unknown };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const stopIndex =
      typeof body.stopIndex === "number"
        ? body.stopIndex
        : typeof body.stopIndex === "string"
          ? parseInt(body.stopIndex, 10)
          : NaN;
    if (!Number.isInteger(stopIndex) || stopIndex < 0) {
      throw badRequest("Invalid stopIndex");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const stops = (run.optimized_route?.stops ?? []) as OptimizedStop[];
    if (stopIndex >= stops.length) {
      throw validationError("Stop index is out of range");
    }
    const stop = stops[stopIndex];
    if (!stop?.completed) {
      throw validationError("Stop is not completed yet");
    }
    if (!stop.proof_of_delivery_images || stop.proof_of_delivery_images.length === 0) {
      throw validationError("Stop has no proof-of-delivery image to send");
    }

    const priorAttempts = stop.kapioo_sync?.attempts ?? 0;
    const driverName =
      typeof run.driver_name === "string" ? run.driver_name : undefined;

    const kapiooSync: KapiooSyncState = await runKapiooSync({
      runId: id,
      stopIndex,
      stop,
      driverName,
      priorAttempts,
    });

    const prefix = `optimized_route.stops.${stopIndex}`;
    await DeliveryRunModel.updateOne(
      { _id: id },
      { $set: { [prefix + ".kapioo_sync"]: kapiooSync } }
    );

    const refreshed = await DeliveryRunModel.findById(id).lean();
    const doc = (refreshed ?? run.toObject()) as {
      _id: { toString(): string };
      [k: string]: unknown;
    };
    return json({
      run: { ...sanitizeRunForResponse(doc), _id: doc._id.toString() },
      kapioo_sync: kapiooSync,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
