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
    const input = searchParams.get("input") ?? "";
    const trimmed = input.trim();
    if (!trimmed) {
      throw badRequest("Missing input parameter");
    }
    const { GOOGLE_MAPS_API_KEY } = getServerEnv();
    const enc = encodeURIComponent(trimmed);
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${enc}&types=address&components=country:ca&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      return json({ error: data.error_message ?? "Places request failed" }, { status: 500 });
    }
    const predictions = (data.predictions ?? []).map((p: { place_id: string; description: string }) => ({
      place_id: p.place_id,
      description: p.description,
    }));
    return json({ predictions });
  } catch (err) {
    return handleApiError(err);
  }
}
