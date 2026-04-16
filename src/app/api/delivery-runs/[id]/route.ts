import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { assertSaveGate } from "@/lib/validation/save-gates";
import { assertFixedStopPositionsValid } from "@/lib/validation/fixed-stop-position";
import { geocodeAddress } from "@/lib/google/geocoding";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import {
  sanitizeCustomers,
  sanitizeRunForResponse,
  sanitizeStops,
} from "@/lib/normalization/delivery-run";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    await connectDB();
    const run = await DeliveryRunModel.findById(id).lean();
    if (!run) throw notFound("Delivery run not found");

    const doc = run as {
      _id: { toString(): string };
      start_location?: string;
      optimized_route?: { start_lat?: number; start_lng?: number };
      [k: string]: unknown;
    };

    if (
      doc.optimized_route &&
      doc.start_location?.trim() &&
      (doc.optimized_route.start_lat == null || doc.optimized_route.start_lng == null)
    ) {
      const geo = await geocodeAddress(doc.start_location);
      if (geo) {
        const runDoc = await DeliveryRunModel.findById(id);
        if (runDoc?.optimized_route) {
          runDoc.optimized_route.start_lat = geo.lat;
          runDoc.optimized_route.start_lng = geo.lng;
          await runDoc.save();
        }
        if (!doc.optimized_route) doc.optimized_route = {};
        doc.optimized_route.start_lat = geo.lat;
        doc.optimized_route.start_lng = geo.lng;
      }
    }

    return json({ ...sanitizeRunForResponse(doc), _id: doc._id.toString() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    requireAdminSession(request);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    const body = await request.json().catch(() => ({}));
    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const customers = sanitizeCustomers(body.customers ?? run.customers);
    assertSaveGate(customers);
    assertFixedStopPositionsValid(customers);

    const updates: Record<string, unknown> = {};
    const allowed = [
      "run_date",
      "driver_name",
      "start_location",
      "end_location",
      "start_time",
      "actual_start_time",
      "travel_mode",
      "customers",
      "status",
      "optimized_route",
      "messages_sent",
      "messages_sent_at",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (updates.customers) {
      updates.customers = sanitizeCustomers(
        updates.customers as Record<string, unknown>[]
      );
    }
    if (
      updates.optimized_route &&
      typeof updates.optimized_route === "object" &&
      updates.optimized_route !== null
    ) {
      const route = updates.optimized_route as Record<string, unknown>;
      if (Array.isArray(route.stops)) {
        updates.optimized_route = {
          ...route,
          stops: sanitizeStops(route.stops),
        };
      }
    }
    Object.assign(run, updates);
    await run.save();

    const saved = sanitizeRunForResponse(run.toObject());
    return json({
      ...saved,
      _id: run._id.toString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    await connectDB();
    const deleted = await DeliveryRunModel.findByIdAndDelete(id);
    if (!deleted) throw notFound("Delivery run not found");
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
