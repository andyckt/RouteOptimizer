import { getServerEnv } from "@/lib/env";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted?: string;
}

export async function geocodeAddress(address: string | undefined | null): Promise<GeocodeResult | null> {
  const { GOOGLE_MAPS_API_KEY } = getServerEnv();
  const trimmed = typeof address === "string" ? address.trim() : "";
  if (!trimmed) return null;
  const enc = encodeURIComponent(trimmed);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${enc}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    return null;
  }
  const loc = data.results[0].geometry?.location;
  if (!loc?.lat || !loc?.lng) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    formatted: data.results[0].formatted_address,
  };
}
