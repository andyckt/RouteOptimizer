import { getServerEnv } from "@/lib/env";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DirectionsLeg {
  distanceMeters: number;
  durationSeconds: number;
  polyline?: string;
}

export async function getDirectionsLeg(
  origin: LatLng,
  destination: LatLng,
  travelMode: "driving" | "ebike",
  departureTime?: Date | number
): Promise<DirectionsLeg | null> {
  const { GOOGLE_MAPS_API_KEY } = getServerEnv();
  const mode = travelMode === "ebike" ? "bicycling" : "driving";

  // Google Directions API rejects departure_time values in the past.
  // Clamp to at least the current second so a run whose scheduled start
  // time has already passed (common when the admin is in a far-ahead
  // timezone like HKT) still gets a valid traffic-aware response.
  // ETA labels in the caller are computed from the scheduled time, not
  // from this clamped value, so displayed times are unaffected.
  const nowSec = Math.floor(Date.now() / 1000);
  const depSec =
    departureTime !== undefined
      ? typeof departureTime === "number"
        ? departureTime
        : Math.floor(departureTime.getTime() / 1000)
      : undefined;
  const effectiveDepSec = depSec !== undefined ? Math.max(depSec, nowSec) : undefined;
  const departureParam =
    effectiveDepSec !== undefined
      ? `&departure_time=${effectiveDepSec}`
      : "&departure_time=now";
  const url =
    "https://maps.googleapis.com/maps/api/directions/json" +
    `?origin=${origin.lat},${origin.lng}` +
    `&destination=${destination.lat},${destination.lng}` +
    `&mode=${mode}` +
    departureParam +
    `&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) return null;

  const leg = data.routes[0].legs[0];
  const distanceMeters = Number(leg.distance?.value ?? 0);
  // For driving: prefer duration_in_traffic when available (used for both
  // departure_time=now and explicit future departure_time)
  const useTrafficDuration =
    mode === "driving" && typeof leg.duration_in_traffic?.value === "number";
  const durationSeconds = Number(
    useTrafficDuration ? leg.duration_in_traffic?.value : leg.duration?.value ?? 0
  );
  return {
    distanceMeters,
    durationSeconds,
    polyline: data.routes?.[0]?.overview_polyline?.points,
  };
}

