import { getServerEnv } from "@/lib/env";
import {
  confidenceFromLocationType,
  type GeocodeConfidence,
} from "@/lib/google/geocodeConfidence";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted?: string;
}

export type GeocodeDetailedSuccess = {
  ok: true;
  lat: number;
  lng: number;
  formatted_address: string;
  geocode_status: "OK";
  location_type: string;
  partial_match: boolean;
  confidence: GeocodeConfidence;
  provider: "google";
};

export type GeocodeDetailedFailure = {
  ok: false;
  geocode_status: string;
  confidence: "low";
  provider: "google";
  error: string;
  rate_limited?: boolean;
};

export type GeocodeDetailedResult = GeocodeDetailedSuccess | GeocodeDetailedFailure;

const GOOGLE_RATE_LIMIT_STATUSES = new Set(["OVER_QUERY_LIMIT", "RESOURCE_EXHAUSTED"]);

function geocodeErrorMessage(status: string): string {
  if (status === "ZERO_RESULTS") return "Address could not be geocoded";
  if (status === "INVALID_REQUEST") return "Invalid geocode request";
  if (GOOGLE_RATE_LIMIT_STATUSES.has(status)) {
    return "Geocoding provider rate limit exceeded. Please retry shortly.";
  }
  return "Address could not be geocoded";
}

export async function geocodeAddress(
  address: string | undefined | null
): Promise<GeocodeResult | null> {
  const detailed = await geocodeAddressDetailed(address);
  if (!detailed.ok) return null;
  return {
    lat: detailed.lat,
    lng: detailed.lng,
    formatted: detailed.formatted_address,
  };
}

export async function geocodeAddressDetailed(
  address: string | undefined | null
): Promise<GeocodeDetailedResult> {
  const { GOOGLE_MAPS_API_KEY } = getServerEnv();
  const trimmed = typeof address === "string" ? address.trim() : "";
  if (!trimmed) {
    return {
      ok: false,
      geocode_status: "INVALID_REQUEST",
      confidence: "low",
      provider: "google",
      error: "Address is required",
    };
  }

  const enc = encodeURIComponent(trimmed);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${enc}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      partial_match?: boolean;
      geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
    }>;
  };

  const status = data.status ?? "UNKNOWN_ERROR";

  if (status !== "OK" || !data.results?.[0]) {
    return {
      ok: false,
      geocode_status: status,
      confidence: "low",
      provider: "google",
      error: geocodeErrorMessage(status),
      rate_limited: GOOGLE_RATE_LIMIT_STATUSES.has(status),
    };
  }

  const first = data.results[0];
  const loc = first.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") {
    return {
      ok: false,
      geocode_status: "UNKNOWN_ERROR",
      confidence: "low",
      provider: "google",
      error: "Address could not be geocoded",
    };
  }

  const locationType = first.geometry?.location_type ?? "";
  const partialMatch = Boolean(first.partial_match);

  return {
    ok: true,
    lat: loc.lat,
    lng: loc.lng,
    formatted_address: first.formatted_address ?? trimmed,
    geocode_status: "OK",
    location_type: locationType,
    partial_match: partialMatch,
    confidence: confidenceFromLocationType(locationType, partialMatch),
    provider: "google",
  };
}
