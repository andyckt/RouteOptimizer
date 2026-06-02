/**
 * Read-only fetch of DeliveryRun documents for runs-by-date integration.
 */

import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import {
  buildRunsByDateResponse,
  type RunsByDateResponse,
  type LeanRunForByDate,
} from "@/lib/integration/buildRunsByDateResponse";
import type { ParsedRunsByDateQuery } from "@/lib/integration/parseRunsByDateQuery";

export function buildRunsByDateMongoFilter(
  parsed: ParsedRunsByDateQuery
): Record<string, unknown> {
  const filter: Record<string, unknown> = { run_date: parsed.date };
  if (!parsed.includeDrafts) {
    filter.status = { $in: ["optimized", "in_progress", "completed"] };
  }
  return filter;
}

export function filterRunsWithRoute<T extends { optimized_route?: { stops?: unknown[] } }>(
  runs: T[],
  requireRoute: boolean
): T[] {
  if (!requireRoute) return runs;
  return runs.filter((r) => (r.optimized_route?.stops?.length ?? 0) > 0);
}

export async function fetchRunsByDate(
  parsed: ParsedRunsByDateQuery
): Promise<RunsByDateResponse> {
  await connectDB();
  const filter = buildRunsByDateMongoFilter(parsed);
  const runs = (await DeliveryRunModel.find(filter)
    .sort({ createdAt: 1, driver_name: 1 })
    .lean()) as unknown as LeanRunForByDate[];
  const filtered = filterRunsWithRoute(runs, parsed.requireRoute);
  return buildRunsByDateResponse(parsed, filtered);
}
