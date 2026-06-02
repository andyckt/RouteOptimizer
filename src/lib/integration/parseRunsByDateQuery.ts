/**
 * Query parameter parsing for GET /api/integrations/runs/by-date.
 */

import { ApiError } from "@/lib/http/errors";
import { RUN_DATE_RE } from "@/lib/integration/parseRunPayload";

export interface ParsedRunsByDateQuery {
  date: string;
  includeDrafts: boolean;
  requireRoute: boolean;
}

export function parseRunsByDateQuery(params: URLSearchParams): ParsedRunsByDateQuery {
  const date = params.get("date")?.trim();
  if (!date) {
    throw new ApiError(400, "date query parameter is required", "VALIDATION_ERROR");
  }
  if (!RUN_DATE_RE.test(date)) {
    throw new ApiError(
      400,
      "date must be in YYYY-MM-DD format",
      "VALIDATION_ERROR"
    );
  }

  const includeDrafts = params.get("include_drafts") === "true";
  const requireRoute = params.get("require_route") !== "false";

  return { date, includeDrafts, requireRoute };
}
