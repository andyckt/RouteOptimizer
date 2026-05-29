export interface RunIntegrationFields {
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  created_by_integration?: string;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasRunIntegrationMetadata(run: RunIntegrationFields): boolean {
  return (
    nonEmpty(run.planning_session_id) ||
    nonEmpty(run.external_id) ||
    nonEmpty(run.idempotency_key) ||
    nonEmpty(run.created_by_integration)
  );
}

/** Shorten long IDs for cards; full value should go in title/tooltip. */
export function shortenDisplayId(id: string, max = 12): string {
  const trimmed = id.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
