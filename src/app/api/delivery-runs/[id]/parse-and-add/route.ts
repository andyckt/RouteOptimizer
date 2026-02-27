import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { parseDeterministic } from "@/lib/parsing/deterministic-customer-parser";
import { geocodeAddress } from "@/lib/google/geocoding";
import type { DeliveryCustomer } from "@/types/delivery-run";
import {
  sanitizeCustomers,
  sanitizeRunForResponse,
} from "@/lib/normalization/delivery-run";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

function toDeliveryCustomer(
  p: { name: string; address: string; phone: string; notes: string }
): DeliveryCustomer {
  return {
    name: p.name,
    phone: p.phone,
    address: p.address,
    notes: p.notes || undefined,
    is_first_stop: false,
    is_end_point: false,
    geocode_status: "pending",
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireAdminSession(request);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    const body = await request.json().catch(() => ({}));
    const pastedText = typeof body.text === "string" ? body.text : "";
    if (!pastedText.trim()) {
      throw badRequest("Missing pasted text");
    }

    const parsed = parseDeterministic(pastedText);
    const newCustomers: DeliveryCustomer[] = parsed.map(toDeliveryCustomer);

    for (const nc of newCustomers) {
      const addr = (nc.address ?? "").trim();
      if (!addr) {
        nc.geocode_status = "failed";
        nc.geocode_error = "No address to geocode";
        continue;
      }
      const result = await geocodeAddress(addr);
      if (result) {
        nc.lat = result.lat;
        nc.lng = result.lng;
        nc.geocode_status = "success";
        nc.geocode_error = undefined;
      } else {
        nc.geocode_status = "failed";
        nc.geocode_error = `Could not geocode: ${addr}`;
      }
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const existing = sanitizeCustomers((run.customers ?? []) as DeliveryCustomer[]);
    const merged = [...existing];
    for (const nc of newCustomers) {
      const dup = merged.find(
        (e) =>
          e.address === nc.address &&
          (e.phone === nc.phone || (!e.phone && !nc.phone))
      );
      if (!dup) merged.push(nc);
    }
    run.customers = sanitizeCustomers(merged);
    await run.save();

    const sanitized = sanitizeRunForResponse(run.toObject());
    return json({
      added: newCustomers.length,
      total: sanitized.customers.length,
      customers: sanitized.customers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
