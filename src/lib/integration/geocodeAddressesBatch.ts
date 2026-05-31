import { ApiError } from "@/lib/http/errors";
import { geocodeAddressDetailed } from "@/lib/google/geocoding";
import type { ParsedGeocodeAddress } from "@/lib/integration/parseGeocodeAddressesPayload";

export const GEOCODE_RATE_LIMIT_RETRY_SECONDS = 60;

export interface GeocodeAddressResultRow {
  client_ref: string;
  input_address: string;
  formatted_address?: string;
  lat?: number;
  lng?: number;
  geocode_status: string;
  confidence: "high" | "medium" | "low";
  location_type?: string;
  provider: "google";
  status: "success" | "failed";
  error?: string;
}

export interface GeocodeAddressesBatchResponse {
  status: "completed";
  total_requested: number;
  total_succeeded: number;
  total_failed: number;
  results: GeocodeAddressResultRow[];
  errors: [];
}

/** Builds the query sent to Google; response keeps original `address` as input_address. */
export function buildGeocodeQuery(item: ParsedGeocodeAddress): string {
  const parts = [item.address];
  const addrLower = item.address.toLowerCase();
  if (item.area && !addrLower.includes(item.area.toLowerCase())) {
    parts.push(item.area);
  }
  if (item.country && !addrLower.includes(item.country.toLowerCase())) {
    parts.push(item.country);
  }
  return parts.join(", ");
}

export async function geocodeAddressesBatch(
  addresses: ParsedGeocodeAddress[]
): Promise<GeocodeAddressesBatchResponse> {
  const results: GeocodeAddressResultRow[] = [];

  for (const item of addresses) {
    const query = buildGeocodeQuery(item);
    const detailed = await geocodeAddressDetailed(query);

    if (!detailed.ok) {
      if (detailed.rate_limited) {
        throw new ApiError(429, detailed.error, "RATE_LIMITED");
      }
      results.push({
        client_ref: item.client_ref,
        input_address: item.address,
        geocode_status: detailed.geocode_status,
        confidence: detailed.confidence,
        provider: detailed.provider,
        status: "failed",
        error: detailed.error,
      });
      continue;
    }

    results.push({
      client_ref: item.client_ref,
      input_address: item.address,
      formatted_address: detailed.formatted_address,
      lat: detailed.lat,
      lng: detailed.lng,
      geocode_status: detailed.geocode_status,
      confidence: detailed.confidence,
      location_type: detailed.location_type,
      provider: detailed.provider,
      status: "success",
    });
  }

  const total_succeeded = results.filter((r) => r.status === "success").length;

  return {
    status: "completed",
    total_requested: addresses.length,
    total_succeeded,
    total_failed: addresses.length - total_succeeded,
    results,
    errors: [],
  };
}
