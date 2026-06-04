/**
 * Inbound integration endpoint: create + optimize multiple final runs in one planning session.
 *
 * POST /api/integrations/runs/batch-create-and-optimize
 * Auth: Authorization: Bearer <ROUTE_OPTIMIZER_INBOUND_TOKEN>
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { assertRateLimit } from "@/lib/rate-limit";
import { requireIntegrationAuth } from "@/lib/auth/requireIntegrationAuth";
import { createAndOptimizeIntegrationRun } from "@/lib/integration/createAndOptimizeIntegrationRun";
import { parseBatchPayload, type BatchIncomingBody } from "@/lib/integration/parseBatchPayload";
import { parseIntegrationRunPayload } from "@/lib/integration/parseRunPayload";
import {
  buildBatchIntegrationResponse,
  buildFailedBatchItem,
  deriveBatchHttpStatus,
  integrationResponseToBatchItem,
  type BatchRunItemResult,
} from "@/lib/integration/buildRunIntegrationResponse";
import {
  batchGoogleApiBudgetViolations,
  estimateRunGoogleApiCost,
  logGoogleApiCostEstimate,
  sumGoogleApiCostEstimates,
  GOOGLE_API_BUDGET_EXCEEDED_CODE,
} from "@/lib/integration/googleApiBudget";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    requireIntegrationAuth(req);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `integration-batch-create-optimize:${ip}`,
      windowMs: 60_000,
      maxRequests: 10,
    });

    const origin = req.nextUrl.origin;
    const body = (await req.json().catch(() => null)) as BatchIncomingBody | null;
    if (!body || typeof body !== "object") {
      return json(
        {
          error: "Invalid JSON body",
          code: "BAD_REQUEST",
          planning_session_id: null,
          status: "failed",
          total_requested: 0,
          total_succeeded: 0,
          total_failed: 0,
          runs: [],
          errors: [],
        },
        { status: 400 }
      );
    }

    const parsed = parseBatchPayload(body);
    if (parsed.batchErrors.length > 0 || !parsed.planning_session_id) {
      return json(
        {
          ...buildBatchIntegrationResponse(
            parsed.planning_session_id ?? "",
            [],
            parsed.batchErrors
          ),
          error: "Batch validation failed",
          code: "VALIDATION_ERROR",
        },
        { status: 422 }
      );
    }

    const estimatedItems = parsed.items
      .map((item) => parseIntegrationRunPayload(item))
      .filter((item) => item.errors.length === 0 && item.run && item.sanitizedCustomers)
      .map((item) =>
        estimateRunGoogleApiCost({
          customers: item.sanitizedCustomers!,
          end_location: item.run!.end_location,
        })
      );
    const batchGoogleCostEstimate = sumGoogleApiCostEstimates(estimatedItems);
    const budgetIssues = batchGoogleApiBudgetViolations({
      totalEstimatedBillableUnits:
        batchGoogleCostEstimate.estimated_billable_units,
    });
    if (budgetIssues.length > 0) {
      return json(
        {
          ...buildBatchIntegrationResponse(
            parsed.planning_session_id,
            [],
            budgetIssues
          ),
          error: "Google API budget exceeded",
          code: GOOGLE_API_BUDGET_EXCEEDED_CODE,
          google_cost_estimate: batchGoogleCostEstimate,
        },
        { status: 422 }
      );
    }

    logGoogleApiCostEstimate({
      event: "integration_batch_create_optimize_google_cost_estimate",
      estimate: batchGoogleCostEstimate,
      planning_session_id: parsed.planning_session_id,
    });

    const batchItems: BatchRunItemResult[] = [];

    for (let index = 0; index < parsed.items.length; index++) {
      try {
        const result = await createAndOptimizeIntegrationRun(parsed.items[index], {
          origin,
        });
        batchItems.push(
          integrationResponseToBatchItem(
            index,
            result.itemStatus,
            result.driver_name,
            result.body
          )
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unexpected error processing run.";
        batchItems.push(buildFailedBatchItem(index, message));
      }
    }

    const response = buildBatchIntegrationResponse(
      parsed.planning_session_id,
      batchItems
    );

    return json(response, { status: deriveBatchHttpStatus(batchItems) });
  } catch (err) {
    return handleApiError(err);
  }
}
