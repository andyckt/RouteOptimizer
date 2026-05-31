export type GeocodeConfidence = "high" | "medium" | "low";

/** Maps Google geometry.location_type (+ partial_match) to integration confidence. */
export function confidenceFromLocationType(
  locationType: string | undefined,
  partialMatch: boolean
): GeocodeConfidence {
  const t = (locationType ?? "").toUpperCase();
  let base: GeocodeConfidence;
  if (t === "ROOFTOP") base = "high";
  else if (t === "RANGE_INTERPOLATED" || t === "GEOMETRIC_CENTER") base = "medium";
  else base = "low";

  if (partialMatch && base === "high") return "medium";
  if (partialMatch && base === "medium") return "low";
  return base;
}
