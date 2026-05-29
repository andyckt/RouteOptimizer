/**
 * Batch envelope validation for batch-create-and-optimize.
 */

import type { ValidationIssue } from "@/lib/integration/buildRunIntegrationResponse";
import type {
  IncomingBody,
  IncomingCustomer,
  IncomingRun,
} from "@/lib/integration/parseRunPayload";

export const MAX_BATCH_RUNS = 10;

export interface BatchIncomingBody {
  planning_session_id?: unknown;
  created_by_integration?: unknown;
  runs?: unknown;
}

export interface ParsedBatchPayload {
  batchErrors: ValidationIssue[];
  planning_session_id: string | null;
  created_by_integration: string;
  items: IncomingBody[];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function parseBatchPayload(body: BatchIncomingBody): ParsedBatchPayload {
  const batchErrors: ValidationIssue[] = [];
  const planning_session_id = asString(body.planning_session_id)?.trim() ?? "";
  const created_by_integration =
    asString(body.created_by_integration)?.trim() || "kapioo-admin";

  if (!planning_session_id) {
    batchErrors.push({
      field: "planning_session_id",
      message: "planning_session_id is required.",
    });
  }

  const runsRaw = body.runs;
  if (!Array.isArray(runsRaw) || runsRaw.length === 0) {
    batchErrors.push({
      field: "runs",
      message: "runs must be a non-empty array.",
    });
    return {
      batchErrors,
      planning_session_id: null,
      created_by_integration,
      items: [],
    };
  }

  if (runsRaw.length > MAX_BATCH_RUNS) {
    batchErrors.push({
      field: "runs",
      message: `At most ${MAX_BATCH_RUNS} runs are allowed per batch.`,
    });
  }

  const items: IncomingBody[] = [];

  runsRaw.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      batchErrors.push({
        field: `runs[${index}]`,
        message: "Each run entry must be an object.",
      });
      return;
    }

    const entry = item as Record<string, unknown>;
    const idempotency_key = asString(entry.idempotency_key)?.trim();
    const external_id = asString(entry.external_id)?.trim();

    if (!idempotency_key && !external_id) {
      batchErrors.push({
        field: `runs[${index}]`,
        message: "Each run must include idempotency_key or external_id.",
      });
    }

    if (!entry.run || typeof entry.run !== "object") {
      batchErrors.push({
        field: `runs[${index}].run`,
        message: "run is required.",
      });
    }

    if (!Array.isArray(entry.customers) || entry.customers.length === 0) {
      batchErrors.push({
        field: `runs[${index}].customers`,
        message: "customers must be a non-empty array.",
      });
    }

    items.push({
      idempotency_key: entry.idempotency_key,
      external_id: entry.external_id,
      planning_session_id,
      created_by_integration,
      run: entry.run as IncomingRun,
      customers: entry.customers as IncomingCustomer[],
    });
  });

  return {
    batchErrors,
    planning_session_id: planning_session_id || null,
    created_by_integration,
    items,
  };
}
