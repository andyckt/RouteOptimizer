import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { geocodeAddress } from "@/lib/google/geocoding";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { sanitizeCustomers } from "@/lib/normalization/delivery-run";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireAdminSession(request);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }
    const body = await request.json().catch(() => ({}));
    const customerIndex = body.customerIndex;
    const validateOverride = body.validateOverride === true;
    const overrideAddress = typeof body.overrideAddress === "string" ? body.overrideAddress : undefined;

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const rawCustomers = JSON.parse(JSON.stringify(run.customers ?? []));
    const customers = sanitizeCustomers(rawCustomers as DeliveryCustomer[]);

    if (validateOverride && overrideAddress !== undefined && typeof customerIndex === "number") {
      const customer = customers[customerIndex];
      if (!customer) throw badRequest("Invalid customer index");
      const result = await geocodeAddress(overrideAddress);
      if (result) {
        customer.nearby_lat = result.lat;
        customer.nearby_lng = result.lng;
        customer.nearby_address_override = overrideAddress.trim();
        customer.geocode_status = "override_success";
        customer.geocode_error = undefined;
      } else {
        customer.geocode_error = "Could not geocode override address";
      }
      run.customers = sanitizeCustomers(customers);
      await run.save();
      return json({
        customerIndex,
        geocode_status: customer.geocode_status,
        geocode_error: customer.geocode_error,
        nearby_lat: customer.nearby_lat,
        nearby_lng: customer.nearby_lng,
      });
    }

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      if (c.geocode_status === "override_success") continue;
      const addrRaw = c.nearby_address_override ?? c.address ?? "";
      const addr = typeof addrRaw === "string" ? addrRaw.trim() : "";
      if (!addr) {
        c.geocode_status = "failed";
        c.geocode_error = "No address to geocode";
        continue;
      }
      const result = await geocodeAddress(addr);
      if (result) {
        c.lat = result.lat;
        c.lng = result.lng;
        c.geocode_status = "success";
        c.geocode_error = undefined;
      } else {
        c.geocode_status = "failed";
        c.geocode_error = `Could not geocode: ${addr}`;
      }
    }
    run.customers = sanitizeCustomers(customers);
    await run.save();

    return json({
      customers: customers.map((c) => ({
        geocode_status: c.geocode_status,
        geocode_error: c.geocode_error,
        lat: c.lat,
        lng: c.lng,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
