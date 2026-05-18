import { NextRequest } from "next/server";
import { parseDeterministic } from "@/lib/parsing/deterministic-customer-parser";
import { geocodeAddress } from "@/lib/google/geocoding";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest } from "@/lib/http/errors";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { sanitizeCustomers } from "@/lib/normalization/delivery-run";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

function toDeliveryCustomer(
  p: { name: string; address: string; phone: string; notes: string; order_ids?: string[] }
): DeliveryCustomer {
  return {
    name: p.name,
    phone: p.phone,
    address: p.address,
    notes: p.notes || undefined,
    is_first_stop: false,
    is_end_point: false,
    geocode_status: "pending",
    ...(p.order_ids && p.order_ids.length > 0 ? { order_ids: p.order_ids } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    requireAdminSession(request);
    const body = await request.json().catch(() => ({}));
    const pastedText = typeof body.text === "string" ? body.text : "";
    if (!pastedText.trim()) {
      throw badRequest("Missing pasted text");
    }

    const parsed = parseDeterministic(pastedText);
    const customers: DeliveryCustomer[] = parsed.map(toDeliveryCustomer);

    for (const c of customers) {
      const addr = (c.address ?? "").trim();
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

    return json({
      customers: sanitizeCustomers(customers),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
