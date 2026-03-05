"use client";

import { useSearchParams } from "next/navigation";
import {
  loadError,
  photoQueuedOffline,
  startError,
  unexpectedError,
} from "@/lib/driver-errors";
import { compressImagesForUpload } from "@/lib/image/compress-for-upload";
import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import type { DeliveryRun } from "@/types/delivery-run";
import { DriverRouteView } from "@/components/driver/DriverRouteView";
import {
  addPending,
  getAllForRun,
  remove,
  getPendingCountForRun,
} from "@/lib/offline/completeQueue";
import { tryCompleteWithProof } from "@/lib/offline/uploadWithRetry";

function DriverRouteContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const token = searchParams.get("token");
  const [run, setRun] = useState<DeliveryRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const fileInputRefs = useRef<Map<number, HTMLInputElement | null>>(new Map());
  const uploadingRef = useRef(false);

  const [pendingStopIndices, setPendingStopIndices] = useState<Set<number>>(
    () => new Set()
  );

  const refreshPendingCount = useCallback(async () => {
    if (!id) return;
    const items = await getAllForRun(id);
    setPendingCount(items.length);
    setPendingStopIndices(new Set(items.map((p) => p.stopIndex)));
  }, [id]);

  const processQueue = useCallback(async () => {
    if (!id || !token) return;
    const items = await getAllForRun(id);
    if (items.length === 0) return;
    setSyncingQueue(true);
    setError(null);
    for (const item of items) {
      if (item.id == null) continue;
      const result = await tryCompleteWithProof(
        item.runId,
        item.stopIndex,
        item.token,
        item.images
      );
      if (result.ok && result.run) {
        await remove(item.id);
        setRun(result.run as unknown as DeliveryRun);
        await refreshPendingCount();
      } else if (!result.isRetryable) {
        await remove(item.id);
        setError(result.error ?? "Failed to complete");
        await refreshPendingCount();
      }
    }
    setSyncingQueue(false);
  }, [id, token, refreshPendingCount]);

  useEffect(() => {
    if (!id || !token) {
      setLoading(false);
      return;
    }
    fetch(`/api/delivery-runs/${id}/driver?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const text = await r.text();
        try {
          const data = JSON.parse(text);
          if (!r.ok || data.error) throw new Error(loadError(r.status, data?.error));
          return data;
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message.startsWith("[")) throw parseErr;
          throw new Error(loadError(r.status));
        }
      })
      .then((data) => {
        setRun(data);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : loadError(0, "Unknown error"));
        setRun(null);
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  useEffect(() => {
    if (!id) return;
    refreshPendingCount();
  }, [id, run, refreshPendingCount]);

  useEffect(() => {
    if (!id || !run || !token) return;
    getPendingCountForRun(id).then((count) => {
      if (count > 0) processQueue();
    });
  }, [id, token, run, processQueue]);

  useEffect(() => {
    const handler = () => {
      if (id && token) processQueue();
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [id, token, processQueue]);

  async function handleStart() {
    if (!id || !token) return;
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/delivery-runs/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const text = await res.text();
      let data: { run?: unknown; error?: string; eta_sms_result?: unknown };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(startError(res.status));
      }
      if (!res.ok) throw new Error(startError(res.status, data.error));
      setRun(data.run);
      setShowStartConfirm(false);
      const eta = data.eta_sms_result;
      if (eta?.failed_customers?.length) {
        setError(
          `Started. ETA SMS: sent ${eta.total_sent}, failed ${eta.total_failed}: ${eta.failed_customers
            .map(
              (f: { customer_name: string; error: string }) =>
                `${f.customer_name}: ${f.error}`
            )
            .join("; ")}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : unexpectedError("Could not start"));
    } finally {
      setStarting(false);
    }
  }

  function handleStartClick() {
    setShowStartConfirm(true);
  }

  async function handleUploadProofAndComplete(stopIndex: number) {
    if (!id || !token) return;
    if (uploadingRef.current) return;
    const input = fileInputRefs.current.get(stopIndex);
    if (!input?.files?.length) {
      setError("Please select 1-3 images to upload.");
      return;
    }
    const rawFiles = Array.from(input.files).slice(0, 3);
    if (rawFiles.some((f) => f.size > 10 * 1024 * 1024)) {
      setError("Each image must be under 10MB.");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (rawFiles.some((f) => !allowed.includes(f.type))) {
      setError("Only JPG, PNG, WebP, or HEIC allowed.");
      return;
    }

    setError(null);
    uploadingRef.current = true;
    setUploading(stopIndex);
    try {
      const files = await compressImagesForUpload(rawFiles);
      const queueId = await addPending(id, stopIndex, token, files);
      const result = await tryCompleteWithProof(id, stopIndex, token, files);
      if (result.ok && result.run) {
        await remove(queueId);
        setRun(result.run as unknown as DeliveryRun);
        input.value = "";
        await refreshPendingCount();
      } else if (result.isRetryable) {
        setError(photoQueuedOffline());
        await refreshPendingCount();
      } else {
        await remove(queueId);
        setError(result.error ?? "Failed to upload/complete");
        await refreshPendingCount();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : unexpectedError("Upload failed")
      );
    } finally {
      uploadingRef.current = false;
      setUploading(null);
    }
  }

  if (!id || !token) {
    return (
      <main className="min-h-screen p-8 bg-slate-50 flex items-center justify-center">
        <p className="text-red-600">Missing run ID or token.</p>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen p-8 bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
          <p className="text-slate-600">Loading...</p>
        </div>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="min-h-screen p-8 bg-slate-50 flex items-center justify-center">
        <p className="text-red-600">{error ?? "Run not found."}</p>
      </main>
    );
  }

  return (
    <>
      {error && (
        <div className="mx-4 sm:mx-6 mt-4 p-4 border border-red-200 bg-red-50 text-red-700 rounded-xl flex items-start justify-between gap-3">
          <span className="flex-1 min-w-0 text-sm">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-red-600 hover:bg-red-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <DriverRouteView
        run={run}
        onStart={handleStartClick}
        onUploadProofAndComplete={handleUploadProofAndComplete}
        starting={starting}
        uploading={uploading}
        fileInputRefs={fileInputRefs}
        pendingStopIndices={pendingStopIndices}
        syncingQueue={syncingQueue}
        pendingCount={pendingCount}
      />
      {showStartConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-confirm-title"
        >
          <div className="bg-white rounded-xl shadow-xl p-5 sm:p-6 max-w-md mx-4">
            <h2 id="start-confirm-title" className="text-lg font-bold text-slate-900 mb-2">
              Start Delivery
            </h2>
            <p className="text-slate-600 text-sm mb-5">
              This will send ETA notifications to all customers. Continue?
            </p>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setShowStartConfirm(false)}
                disabled={starting}
                className="min-h-[44px] px-4 py-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl disabled:opacity-50 transition-colors font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStart}
                disabled={starting}
                className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                {starting ? "Starting…" : "Start Delivery"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function DriverRoutePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-8 bg-slate-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
            <p className="text-slate-600">Loading...</p>
          </div>
        </main>
      }
    >
      <DriverRouteContent />
    </Suspense>
  );
}
