import type { OptimizedStop } from "@/types/delivery-run";
import { isSyntheticStop } from "@/lib/stops/synthetic";

export function buildRouteLabelRows(
  stops: OptimizedStop[],
  labelQuantities: Record<string, number>
): [string, string][] {
  const labelRows: [string, string][] = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (isSyntheticStop(s)) continue;
    const qty = Math.max(
      0,
      Math.floor(
        labelQuantities[String(i)] ??
          labelQuantities[i as unknown as string] ??
          2
      )
    );
    for (let j = 0; j < qty; j++) {
      labelRows.push([
        s.customer_name ?? "",
        s.customer_address ?? "",
      ]);
    }
  }
  return labelRows;
}
