"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import type { DeliveryRun, DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { isSyntheticStop } from "@/lib/stops/synthetic";

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getStopCoords(
  stop: OptimizedStop,
  customers: DeliveryCustomer[]
): { lat: number; lng: number } | null {
  const c =
    typeof stop.customer_index === "number" &&
    stop.customer_index >= 0 &&
    stop.customer_index < customers.length
      ? customers[stop.customer_index]
      : undefined;
  if (!c) return null;
  if (
    c.geocode_status === "override_success" &&
    typeof c.nearby_lat === "number" &&
    typeof c.nearby_lng === "number"
  ) {
    return { lat: c.nearby_lat, lng: c.nearby_lng };
  }
  if (typeof c.lat === "number" && typeof c.lng === "number") {
    return { lat: c.lat, lng: c.lng };
  }
  return null;
}

function PreviewThumbnails({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      {urls.map((url, j) => (
        // eslint-disable-next-line @next/next/no-img-element -- blob URLs for local file preview
        <img
          key={j}
          src={url}
          alt={`Preview ${j + 1}`}
          className="w-16 h-16 object-cover rounded-lg border border-slate-200"
        />
      ))}
      <span className="text-xs text-slate-600">
        {urls.length} photo{urls.length !== 1 ? "s" : ""} selected
      </span>
    </div>
  );
}

function mapsUrl(stop: OptimizedStop, customers: DeliveryCustomer[]): string {
  const coords = getStopCoords(stop, customers);
  if (coords) {
    return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
  }
  const addr = encodeURIComponent(stop.customer_address ?? "");
  return `https://www.google.com/maps/search/?api=1&query=${addr}`;
}

function ProofOfDeliveryThumbnails({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Proof of delivery</p>
      <div className="flex gap-2 flex-wrap">
        {urls.map((url, j) => {
          const src = url.startsWith("http") ? url : url.startsWith("/") ? url : `/${url}`;
          return (
            <a
              key={j}
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors size-12"
              title={`View proof ${j + 1}`}
            >
              <Image
                src={src}
                alt={`Proof ${j + 1}`}
                width={48}
                height={48}
                className="w-12 h-12 object-cover"
                unoptimized={src.startsWith("/")}
              />
            </a>
          );
        })}
      </div>
    </div>
  );
}

interface DriverRouteViewProps {
  run: DeliveryRun;
  onStart: () => void;
  onUploadProofAndComplete: (stopIndex: number) => void;
  starting: boolean;
  uploading: number | null;
  fileInputRefs: React.MutableRefObject<Map<number, HTMLInputElement | null>>;
  pendingStopIndices?: Set<number>;
  syncingQueue?: boolean;
  pendingCount?: number;
}

export function DriverRouteView({
  run,
  onStart,
  onUploadProofAndComplete,
  starting,
  uploading,
  fileInputRefs,
  pendingStopIndices = new Set(),
  syncingQueue = false,
  pendingCount = 0,
}: DriverRouteViewProps) {
  const stops = useMemo(() => run.optimized_route?.stops ?? [], [run.optimized_route?.stops]);
  const customers = run.customers ?? [];
  const isStarted = run.status === "in_progress" || run.status === "completed";
  const totalStops = stops.length;

  const [selectedPreviews, setSelectedPreviews] = useState<Record<number, string[]>>({});
  const [expandedStops, setExpandedStops] = useState<Set<number>>(() => new Set());
  const nextStopRef = useRef<HTMLDivElement>(null);

  const nextStopIndex = stops.findIndex((s) => !s.completed);

  function toggleExpanded(i: number) {
    setExpandedStops((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  useEffect(() => {
    const prev = selectedPreviews;
    return () => {
      Object.values(prev).flat().forEach((u) => URL.revokeObjectURL(u));
    };
  }, [selectedPreviews]);

  useEffect(() => {
    stops.forEach((stop, idx) => {
      if (stop.completed && selectedPreviews[idx]) {
        setSelectedPreviews((p) => {
          const urls = p[idx];
          if (urls) urls.forEach((u) => URL.revokeObjectURL(u));
          const next = { ...p };
          delete next[idx];
          return next;
        });
      }
    });
  }, [stops, selectedPreviews]);

  const hasScrolledToNext = useRef(false);
  useEffect(() => {
    if (nextStopIndex >= 0 && !hasScrolledToNext.current) {
      hasScrolledToNext.current = true;
      const id = setTimeout(() => {
        nextStopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(id);
    }
  }, [nextStopIndex]);

  function handleFileChange(stopIndex: number, files: FileList | null) {
    if (!files || files.length === 0) {
      setSelectedPreviews((prev) => {
        const urls = prev[stopIndex];
        if (urls) urls.forEach((u) => URL.revokeObjectURL(u));
        const next = { ...prev };
        delete next[stopIndex];
        return next;
      });
      return;
    }
    const fileList = Array.from(files).slice(0, 3);
    const urls = fileList.map((f) => URL.createObjectURL(f));
    setSelectedPreviews((prev) => {
      const old = prev[stopIndex];
      if (old) old.forEach((u) => URL.revokeObjectURL(u));
      return { ...prev, [stopIndex]: urls };
    });
  }
  const completedCount = stops.filter((s) => s.completed).length;
  const actualDurationMinutes = run.optimized_route?.total_duration_minutes ?? 0;
  const driverPageDuration = Math.max(0, actualDurationMinutes - 15); // Driver_Page_Duration: display only

  const statusLabel = run.status.replace("_", " ");
  const startTimeStr =
    run.actual_start_time
      ? new Date(run.actual_start_time).toLocaleTimeString("en-US", {
          hour12: true,
          hour: "2-digit",
          minute: "2-digit",
        })
      : run.start_time;

  return (
    <div className="min-h-screen bg-slate-50" role="main">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 sm:py-5">
        {/* Row 1: Date + Status */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 gap-1 mb-4">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {formatDate(run.run_date)}
          </h1>
          <span
            className={`inline-flex w-fit px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
              run.status === "draft"
                ? "bg-amber-100 text-amber-800"
                : run.status === "optimized"
                ? "bg-blue-100 text-blue-800"
                : run.status === "in_progress"
                ? "bg-emerald-100 text-emerald-800"
                : run.status === "completed"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {statusLabel}
          </span>
        </div>

        {/* Row 2: Run details — grouped in a subtle card */}
        <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0.5">Driver</p>
              <p className="font-semibold text-slate-900">{run.driver_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0.5">Depot</p>
              <p className="text-slate-700 truncate" title={run.start_location || undefined}>
                {run.start_location || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0.5">Start time</p>
              <p className="text-slate-700">{startTimeStr}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-0.5">Duration</p>
              <p className="text-slate-700">{formatDuration(driverPageDuration)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-slate-200 text-slate-700">
              {totalStops} stop{totalStops !== 1 ? "s" : ""}
              {isStarted && totalStops > 0 && (
                <span className={completedCount === totalStops ? " text-emerald-600 font-semibold" : ""}>
                  {" · "}{completedCount}/{totalStops}
                </span>
              )}
            </span>
            {pendingCount > 0 && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                {pendingCount} pending
              </span>
            )}
            {syncingQueue && (
              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                Syncing…
              </span>
            )}
          </div>
        </div>

        {/* Row 3: Progress bar */}
        {totalStops > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>Progress</span>
              <span>{completedCount}/{totalStops}</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  completedCount === totalStops ? "bg-emerald-600" : "bg-blue-600"
                }`}
                style={{ width: `${(completedCount / totalStops) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Row 4: Actions / Status */}
        <div className="flex flex-wrap gap-2">
          {run.status === "optimized" && (
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              {starting ? "Starting…" : "Start Delivery"}
            </button>
          )}
          {run.messages_sent && (
            <span className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium">
              <span aria-hidden>✓</span>
              ETAs sent
              {run.messages_sent_at
                ? ` at ${new Date(run.messages_sent_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                : ""}
            </span>
          )}
          {run.status === "completed" && (
            <span className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-medium">
              <span aria-hidden>✓</span>
              Run completed
            </span>
          )}
        </div>
      </header>

      <div className="p-4 sm:p-6 space-y-4 max-w-2xl mx-auto">
        <h2 className="text-base font-semibold text-slate-900 px-1">Stops</h2>
        {stops.length === 0 ? (
          <p className="text-slate-500">No stops in this route.</p>
        ) : (
          stops.map((stop, i) => {
            const isCompleted = stop.completed;
            const isExpanded = !isCompleted || expandedStops.has(i);
            const isCurrent = isStarted && !isCompleted && stops.slice(0, i).every((s) => s.completed);
            const isNextStop = i === nextStopIndex;

            if (isCompleted && !isExpanded) {
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleExpanded(i)}
                  className="w-full text-left p-4 rounded-xl border bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50 transition-colors"
                  aria-expanded="false"
                  aria-label={`Expand stop ${i + 1}: ${stop.customer_name}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold bg-emerald-600 text-white">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block font-semibold text-slate-900 truncate">{stop.customer_name}</span>
                      {isSyntheticStop(stop) && (
                        <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800">
                          Handoff
                        </span>
                      )}
                      {stop.customer_address && (
                        <span className="block text-xs text-slate-500 truncate mt-0.5">{stop.customer_address}</span>
                      )}
                      <span className="text-xs text-slate-600">
                        Delivered
                        {stop.completed_at
                          ? ` at ${new Date(stop.completed_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : ""}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 flex-shrink-0 transition-colors mt-0.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      Expand
                    </span>
                  </div>
                </button>
              );
            }

            return (
              <div
                key={i}
                ref={isNextStop ? nextStopRef : undefined}
                className={`p-4 sm:p-5 rounded-xl border ${
                  isCompleted
                    ? "bg-emerald-50/60 border-emerald-200"
                    : isCurrent
                      ? "bg-white border-l-4 border-l-blue-500 border-slate-200"
                      : "bg-white border-slate-200"
                }`}
              >
                <div className="flex gap-4">
                  <div
                    className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isCompleted ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-base font-semibold text-slate-900">{stop.customer_name}</span>
                        {isSyntheticStop(stop) && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-violet-100 text-violet-800">
                            Handoff
                          </span>
                        )}
                        {stop.completed && (
                          <>
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                              Delivered
                            </span>
                            {stop.completed_at && (
                              <span className="text-xs text-slate-600">
                                at{" "}
                                {new Date(stop.completed_at).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      {stop.completed && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(i)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 border border-slate-200 transition-colors flex-shrink-0"
                          aria-label="Collapse"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                          Collapse
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5 select-text">
                      {stop.customer_address}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">
                      {stop.customer_phone ? (
                        <a
                          href={`tel:${stop.customer_phone.replace(/\D/g, "")}`}
                          className="text-blue-600 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded"
                        >
                          {stop.customer_phone}
                        </a>
                      ) : (
                        <span>No phone</span>
                      )}
                    </p>
                    {stop.notes && (
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                        <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-0.5">
                          Note
                        </p>
                        <p className="text-sm font-medium text-amber-900">
                          {stop.notes}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
                      {stop.eta && (
                        <span className="text-blue-600 font-medium text-sm">
                          ETA: {stop.eta}
                        </span>
                      )}
                      <a
                        href={mapsUrl(stop, customers)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors text-sm w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      >
                        Navigate
                      </a>
                    </div>
                    {stop.proof_of_delivery_images?.length ? (
                      <ProofOfDeliveryThumbnails urls={stop.proof_of_delivery_images} />
                    ) : null}
                    {!stop.completed && isStarted ? (
                      pendingStopIndices.has(i) ? (
                        <p className="mt-3 text-sm text-amber-700 font-medium flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" aria-hidden />
                          Completing when online...
                        </p>
                      ) : (
                        <div className="mt-3 flex flex-col gap-2">
                          {selectedPreviews[i]?.length ? (
                            <PreviewThumbnails urls={selectedPreviews[i]} />
                          ) : null}
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            ref={(inputEl) => {
                              if (inputEl) fileInputRefs.current.set(i, inputEl);
                            }}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                            multiple
                            id={`proof-${i}`}
                            className="sr-only"
                            onChange={(e) => handleFileChange(i, e.currentTarget.files)}
                          />
                          <label
                            htmlFor={`proof-${i}`}
                            className="min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors cursor-pointer text-sm focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2"
                          >
                            {selectedPreviews[i]?.length ? "Change photos" : "Choose photos"}
                          </label>
                          <button
                            type="button"
                            onClick={() => onUploadProofAndComplete(i)}
                            disabled={uploading === i}
                            aria-busy={uploading === i}
                            className="min-h-[44px] px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                          >
                            {uploading === i
                              ? "Uploading..."
                              : "Upload proof and complete"}
                          </button>
                          </div>
                        </div>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {isStarted && nextStopIndex >= 0 && (
        <button
          type="button"
          onClick={() => nextStopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="fixed bottom-6 right-4 z-50 min-h-[44px] px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold shadow-lg hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          aria-label="Scroll to next stop"
        >
          Next stop ({nextStopIndex + 1})
        </button>
      )}
    </div>
  );
}
