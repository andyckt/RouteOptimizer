import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
import { getServerEnv } from "@/lib/env";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get("place_id") ?? "";
    const trimmed = placeId.trim();
    if (!trimmed) {
      throw badRequest("Missing place_id parameter");
    }
    const { GOOGLE_MAPS_API_KEY } = getServerEnv();
    const enc = encodeURIComponent(trimmed);
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${enc}&fields=formatted_address,geometry&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" || !data.result) {
      return json({ error: data.error_message ?? "Place details not found" }, { status: 404 });
    }
    const loc = data.result.geometry?.location;
    const address = data.result.formatted_address ?? "";
    if (!loc?.lat || !loc?.lng) {
      return json({ error: "Place has no coordinates" }, { status: 404 });
    }
    return json({
      address,
      lat: loc.lat,
      lng: loc.lng,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
