"use client";

import { useState } from "react";
import {
  hasRunIntegrationMetadata,
  shortenDisplayId,
  type RunIntegrationFields,
} from "@/lib/integration/displayRunMetadata";

function integrationSourceLabel(source: string): string {
  const trimmed = source.trim();
  if (trimmed.length <= 20) return trimmed;
  return shortenDisplayId(trimmed, 18);
}

export function RunIntegrationMetadata({
  run,
  variant,
  onCopy,
}: {
  run: RunIntegrationFields;
  variant: "compact" | "detail";
  onCopy?: (text: string) => void | Promise<void>;
}) {
  const [copying, setCopying] = useState(false);

  if (!hasRunIntegrationMetadata(run)) return null;

  const sessionId = run.planning_session_id?.trim();
  const createdBy = run.created_by_integration?.trim();
  const externalId = run.external_id?.trim();
  const idempotencyKey = run.idempotency_key?.trim();

  if (variant === "compact") {
    return (
      <div className="flex flex-col gap-1 min-w-0">
        {createdBy && (
          <span className="inline-flex w-fit px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-indigo-50 text-indigo-800 border border-indigo-100">
            Integration
          </span>
        )}
        {sessionId && (
          <p
            className="text-xs text-slate-500 truncate"
            title={sessionId}
          >
            Planning session · {shortenDisplayId(sessionId)}
          </p>
        )}
      </div>
    );
  }

  async function handleCopy(text: string) {
    if (!onCopy) return;
    setCopying(true);
    try {
      await onCopy(text);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs space-y-2 mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Integration
      </p>
      {sessionId && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-slate-600 font-medium shrink-0">Planning session</span>
          <span
            className="font-mono text-slate-800 break-all"
            title={sessionId}
          >
            {shortenDisplayId(sessionId, 24)}
          </span>
          {onCopy && (
            <button
              type="button"
              onClick={() => void handleCopy(sessionId)}
              disabled={copying}
              className="text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
            >
              {copying ? "Copying…" : "Copy"}
            </button>
          )}
        </div>
      )}
      {createdBy && (
        <p>
          <span className="text-slate-600 font-medium">Created by: </span>
          <span className="text-slate-800">{integrationSourceLabel(createdBy)}</span>
        </p>
      )}
      {externalId && (
        <p>
          <span className="text-slate-600 font-medium">External ID: </span>
          <span className="font-mono text-slate-800 break-all">{externalId}</span>
        </p>
      )}
      {idempotencyKey && (
        <p>
          <span className="text-slate-600 font-medium">Idempotency key: </span>
          <span className="font-mono text-slate-700 break-all text-[11px]">
            {idempotencyKey}
          </span>
        </p>
      )}
    </div>
  );
}
