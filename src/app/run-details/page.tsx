"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { DeliveryRun, DeliveryCustomer, OptimizedStop } from "@/types/delivery-run";
import { formatLabelsExportFilename } from "@/lib/export-filename";
import {
  getManualReorderValidationMessage,
  parseFixedStopValue,
} from "@/lib/validation/fixed-stop-position";

const RouteMap = dynamic(
  () => import("@/components/run-details/RouteMap"),
  { ssr: false, loading: () => <div className="h-[420px] w-full rounded-xl bg-slate-100 animate-pulse flex items-center justify-center text-slate-500 text-sm">Loading map…</div> }
);

/** Copy text to clipboard. Uses execCommand fallback when Clipboard API fails (e.g. after async). */
function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  const el = document.createElement("textarea");
  el.value = text;
  el.readOnly = true;
  el.style.position = "fixed";
  el.style.top = "0";
  el.style.left = "0";
  el.style.width = "2em";
  el.style.height = "2em";
  el.style.padding = "0";
  el.style.border = "none";
  el.style.outline = "none";
  el.style.boxShadow = "none";
  el.style.background = "transparent";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(el);
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(timeStr: string): string {
  const [h, m] = (timeStr || "09:00").split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString("en-US", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function RunSummarySidebar({
  run,
  totals,
  stopsCount = 0,
}: {
  run: DeliveryRun;
  totals?: { total_distance_km?: number; total_duration_minutes?: number };
  stopsCount?: number;
}) {
  const travelIcon = run.travel_mode === "ebike" ? "🚴" : "🚗";
  return (
    <div className="space-y-4">
      <div className="p-5 border border-slate-200 rounded-2xl bg-white shadow-sm border-t-4 border-t-blue-500">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-blue-500 rounded-full" aria-hidden />
          Run Summary
        </h3>
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-slate-700">
            <span aria-hidden>{travelIcon}</span>
            <span className="capitalize font-medium">{run.travel_mode}</span>
          </p>
          <p className="flex items-start gap-2 text-slate-600">
            <span aria-hidden className="flex-shrink-0">📍</span>
            <span>{run.start_location || "—"}</span>
          </p>
          {totals && (
            <div className="pt-3 mt-3 border-t border-blue-100 space-y-1">
              <p className="text-blue-600 font-semibold">
                {formatDuration(totals.total_duration_minutes ?? 0)} estimated
              </p>
              {run.status === "completed" &&
                run.actual_start_time &&
                (() => {
                  const stops = run.optimized_route?.stops ?? [];
                  const completedAts = stops
                    .filter((s) => s.completed_at)
                    .map((s) => new Date(s.completed_at!).getTime());
                  if (completedAts.length === 0) return null;
                  const latestMs = Math.max(...completedAts);
                  const startMs = new Date(run.actual_start_time).getTime();
                  const durationMinutes = Math.round((latestMs - startMs) / (1000 * 60));
                  if (durationMinutes < 0) return null;
                  return (
                    <p className="text-slate-600 font-semibold">
                      {formatDuration(durationMinutes)} actual
                    </p>
                  );
                })()}
              <p className="text-indigo-600 font-semibold">
                {(totals.total_distance_km ?? 0).toFixed(1)} km total
              </p>
            </div>
          )}
          {stopsCount > 0 && (
            <p className="flex items-center gap-2 text-slate-600 pt-1">
              <span className="font-medium text-slate-900">Stops:</span>
              <span className="font-semibold text-indigo-600">{stopsCount}</span>
            </p>
          )}
          {run.messages_sent_at && (
            <p className="flex items-center gap-2 text-emerald-600 font-medium pt-1">
              <span>✓</span> ETAs sent at{" "}
              {new Date(run.messages_sent_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          {(() => {
            if (run.status !== "completed") return null;
            const stops = run.optimized_route?.stops ?? [];
            const times = stops
              .filter((s) => s.completed_at)
              .map((s) => new Date(s.completed_at!).getTime());
            if (times.length === 0) return null;
            const completionTime = new Date(Math.max(...times)).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <p className="flex items-center gap-2 text-slate-500 font-medium pt-1">
                <span>🏁</span> Completed at {completionTime}
              </p>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function ExportLabelsModal({
  stops,
  labelQuantities,
  setLabelQuantities,
  extraCustomers,
  setExtraCustomers,
  extraForm,
  setExtraForm,
  extrasPlacement,
  setExtrasPlacement,
  onSetAllQuantities,
  onAddExtra,
  onExport,
  onClose,
  exporting,
}: {
  stops: OptimizedStop[];
  labelQuantities: Record<number, number>;
  setLabelQuantities: (q: Record<number, number>) => void;
  extraCustomers: { name: string; address: string; quantity: number }[];
  setExtraCustomers: (c: { name: string; address: string; quantity: number }[]) => void;
  extraForm: { name: string; address: string; quantity: number };
  setExtraForm: (f: { name: string; address: string; quantity: number }) => void;
  extrasPlacement: "top" | "bottom";
  setExtrasPlacement: (p: "top" | "bottom") => void;
  onSetAllQuantities: (qty: number) => void;
  onAddExtra: () => void;
  onExport: (payload: {
    labelQuantities: Record<number, number>;
    extraCustomers: { name: string; address: string; quantity: number }[];
    extrasPlacement: "top" | "bottom";
  }) => void;
  onClose: () => void;
  exporting: boolean;
}) {
  const routeTotal = stops.reduce((sum, _, i) => sum + Math.max(0, labelQuantities[i] ?? 2), 0);
  const extrasTotal = extraCustomers.reduce((sum, ec) => sum + Math.max(0, ec.quantity), 0);
  const totalLabels = routeTotal + extrasTotal;

  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[10000]">
        <div className="p-5 sm:p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Export Delivery Labels</h2>
            <p className="text-slate-600 text-sm mt-1">
              Set how many labels to print for each customer. Labels will be exported in reverse
              route order (first stop printed last).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-sm text-slate-600 self-center font-medium">Quick set:</span>
            {[1, 2, 3, 0].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSetAllQuantities(q)}
                className="min-h-[40px] px-4 py-2 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Set All to {q}
              </button>
            ))}
          </div>

          <h3 className="font-semibold text-sm text-slate-900 mb-2">Customers from this Route</h3>
          <div className="space-y-3 mb-6 max-h-48 overflow-y-auto">
            {stops.map((stop, i) => (
              <div
                key={i}
                className="p-3 border border-slate-200 rounded-xl bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-slate-900">{stop.customer_name}</p>
                  {stop.customer_address && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{stop.customer_address}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm text-slate-600 font-medium">Labels:</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={labelQuantities[i] ?? 2}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setLabelQuantities({
                        ...labelQuantities,
                        [i]: isNaN(v) ? 0 : Math.max(0, Math.min(99, v)),
                      });
                    }}
                    className="w-16 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-sm text-slate-900 mb-2">
            Add Extra Customers (Optional)
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Add customers from other runs that you forgot to print
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-2">
            <input
              type="text"
              placeholder="e.g., John Smith"
              value={extraForm.name}
              onChange={(e) => setExtraForm({ ...extraForm, name: e.target.value })}
              className="flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              min={0}
              max={99}
              value={extraForm.quantity}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setExtraForm({ ...extraForm, quantity: isNaN(v) ? 0 : Math.max(0, Math.min(99, v)) });
              }}
              className="w-20 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="e.g., 123 Main St, Toronto, ON"
              value={extraForm.address}
              onChange={(e) => setExtraForm({ ...extraForm, address: e.target.value })}
              className="flex-1 min-w-0 px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={onAddExtra}
              className="min-h-[44px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 flex items-center justify-center gap-1"
            >
              + Add Customer
            </button>
          </div>
          {extraCustomers.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm text-gray-600">
                  Extra Customers Added ({extraCustomers.length})
                </span>
                <select
                  value={extrasPlacement}
                  onChange={(e) => setExtrasPlacement(e.target.value as "top" | "bottom")}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="bottom">Place extras at: Top</option>
                  <option value="top">Place extras at: Bottom</option>
                </select>
              </div>
              <div className="space-y-2">
                {extraCustomers.map((ec, i) => (
                  <div
                    key={i}
                    className="p-3 border border-slate-200 rounded-xl bg-slate-50 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-sm"
                  >
                    <span className="text-slate-700">{ec.name} — {ec.address}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">{ec.quantity} labels</span>
                      <button
                        type="button"
                        onClick={() =>
                          setExtraCustomers(extraCustomers.filter((_, j) => j !== i))
                        }
                        className="text-red-600 hover:underline font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6 border-t border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-700 mb-1">
            Total Labels: <span className="font-bold text-emerald-600">{totalLabels}</span>
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Customers with quantity &quot;0&quot; will not be included.
          </p>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                onExport({ labelQuantities, extraCustomers, extrasPlacement })
              }
              disabled={exporting || totalLabels === 0}
              className="min-h-[44px] px-5 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {exporting ? "Exporting…" : `Export ${totalLabels} Labels`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunDetailsContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [run, setRun] = useState<DeliveryRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [copyingLink, setCopyingLink] = useState(false);
  const [copyingReverse, setCopyingReverse] = useState(false);
  const [labelsModalOpen, setLabelsModalOpen] = useState(false);
  const [labelQuantities, setLabelQuantities] = useState<Record<number, number>>({});
  const [reorderModalOpen, setReorderModalOpen] = useState(false);
  const [reorderStops, setReorderStops] = useState<OptimizedStop[]>([]);
  const [recalculatingReorder, setRecalculatingReorder] = useState(false);
  const [extraCustomers, setExtraCustomers] = useState<
    { name: string; address: string; quantity: number }[]
  >([]);
  const [extrasPlacement, setExtrasPlacement] = useState<"top" | "bottom">("top");
  const [exportingLabels, setExportingLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStopIndex, setEditingStopIndex] = useState<number | null>(null);
  const [savingStopIndex, setSavingStopIndex] = useState<number | null>(null);
  const [driverLinkModal, setDriverLinkModal] = useState<{ url: string } | null>(null);
  const [cachedDriverLink, setCachedDriverLink] = useState<string | null>(null);
  const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);
  const driverLinkInputRef = useRef<HTMLInputElement>(null);
  const [extraForm, setExtraForm] = useState({
    name: "",
    address: "",
    quantity: 2,
  });

  useEffect(() => {
    if (!copyLinkSuccess) return;
    const t = setTimeout(() => setCopyLinkSuccess(false), 2500);
    return () => clearTimeout(t);
  }, [copyLinkSuccess]);

  useEffect(() => {
    if (!driverLinkModal) return;
    const url = driverLinkModal.url;
    const id = requestAnimationFrame(() => {
      const input = driverLinkInputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(0, url.length);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [driverLinkModal]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    fetch(`/api/delivery-runs/${id}`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data !== null) {
          if (data.error) throw new Error(data.error);
          setRun(data);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load run");
        setRun(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Pre-fetch driver link when run is loaded and not draft, so Copy works without async gap
  useEffect(() => {
    if (!id || !run || run.status === "draft") {
      setCachedDriverLink(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/delivery-runs/${id}/driver-link`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || data.error) return;
        setCachedDriverLink(data.url as string);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [id, run]);

  async function handleOptimize() {
    if (!id) return;
    setError(null);
    setOptimizing(true);
    try {
      const res = await fetch(`/api/delivery-runs/${id}/optimize`, {
        method: "POST",
      });
      const contentType = res.headers.get("content-type") ?? "";
      const text = await res.text();
      if (!contentType.includes("application/json")) {
        const msg = text.length > 200 ? `${text.slice(0, 200)}…` : text || "Server returned non-JSON response";
        throw new Error(msg || "Optimize API error. Check server logs.");
      }
      let data: { error?: string; run?: unknown };
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || "Invalid response from server");
      }
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to optimize route");
      }
      setRun(data.run as DeliveryRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to optimize route");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleCopyReverse() {
    if (!run?.optimized_route?.stops?.length) {
      setError("No optimized route to copy");
      return;
    }
    setError(null);
    setCopyingReverse(true);
    try {
      const stops = [...run.optimized_route.stops].reverse();
      const names = stops.map((s) => s.customer_name ?? "").filter(Boolean);
      const ok = await copyToClipboard(names.join("\n"));
      if (!ok) throw new Error("Could not copy to clipboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy");
    } finally {
      setCopyingReverse(false);
    }
  }

  async function handleUpdateStop(
    stopIndex: number,
    updates: { customer_name?: string; customer_phone?: string; notes?: string }
  ) {
    if (!id || !run?.optimized_route?.stops) return;
    const stop = run.optimized_route.stops[stopIndex];
    if (!stop || typeof stop.customer_index !== "number") return;
    const custIdx = stop.customer_index;
    const customers = run.customers ?? [];
    if (custIdx < 0 || custIdx >= customers.length) return;

    setError(null);
    setSavingStopIndex(stopIndex);
    try {
      const updatedStops = run.optimized_route.stops.map((s, i) =>
        i === stopIndex
          ? {
              ...s,
              customer_name: updates.customer_name ?? s.customer_name,
              customer_phone: updates.customer_phone ?? s.customer_phone,
              notes: updates.notes !== undefined ? updates.notes : s.notes,
            }
          : s
      );
      const updatedCustomers = customers.map((c, i) =>
        i === custIdx
          ? {
              ...c,
              name: updates.customer_name ?? c.name,
              phone: updates.customer_phone ?? c.phone,
              notes: updates.notes !== undefined ? updates.notes : c.notes,
            }
          : c
      );
      const res = await fetch(`/api/delivery-runs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customers: updatedCustomers,
          optimized_route: { ...run.optimized_route, stops: updatedStops },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      const data = await res.json();
      setRun(data);
      setEditingStopIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingStopIndex(null);
    }
  }

  function handleOpenLabelsModal() {
    const stops = run?.optimized_route?.stops ?? [];
    const initial: Record<number, number> = {};
    stops.forEach((_, i) => {
      initial[i] = 2;
    });
    setLabelQuantities(initial);
    setExtraCustomers([]);
    setExtraForm({ name: "", address: "", quantity: 2 });
    setExtrasPlacement("top");
    setLabelsModalOpen(true);
  }

  async function handleExportLabelsSubmit(payload: {
    labelQuantities: Record<number, number>;
    extraCustomers: { name: string; address: string; quantity: number }[];
    extrasPlacement: "top" | "bottom";
  }) {
    if (!id) return;
    setError(null);
    setExportingLabels(true);
    try {
      // Build payload for every stop index so quantities are never lost
      const stops = run?.optimized_route?.stops ?? [];
      const labelQuantitiesPayload: Record<string, number> = {};
      for (let i = 0; i < stops.length; i++) {
        labelQuantitiesPayload[String(i)] = Math.max(
          0,
          Math.min(99, payload.labelQuantities[i] ?? 2)
        );
      }
      const res = await fetch(`/api/delivery-runs/${id}/export/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labelQuantities: labelQuantitiesPayload,
          extraCustomers: payload.extraCustomers.map((ec) => ({
            name: ec.name,
            address: ec.address,
            quantity: ec.quantity,
          })),
          extrasPlacement: payload.extrasPlacement,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = formatLabelsExportFilename(run?.driver_name ?? "", run?.run_date ?? "");
      a.click();
      URL.revokeObjectURL(url);
      setLabelsModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export labels");
    } finally {
      setExportingLabels(false);
    }
  }

  function setAllQuantities(qty: number) {
    const stops = run?.optimized_route?.stops ?? [];
    const next: Record<number, number> = { ...labelQuantities };
    stops.forEach((_, i) => {
      next[i] = qty;
    });
    setLabelQuantities(next);
  }

  function handleAddExtraCustomer() {
    if (!extraForm.name.trim()) return;
    setExtraCustomers((prev) => [
      ...prev,
      { name: extraForm.name.trim(), address: extraForm.address.trim(), quantity: extraForm.quantity },
    ]);
    setExtraForm({ name: "", address: "", quantity: 2 });
  }

  function handleOpenReorderModal() {
    const stops = run?.optimized_route?.stops ?? [];
    setReorderStops(JSON.parse(JSON.stringify(stops)));
    setReorderModalOpen(true);
  }

  function handleCancelReorder() {
    setReorderModalOpen(false);
    setReorderStops([]);
  }

  async function handleApplyReorder() {
    if (!id || reorderStops.length === 0) return;
    setError(null);
    setRecalculatingReorder(true);
    try {
      const res = await fetch(`/api/delivery-runs/${id}/recalculate-manual-route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops: reorderStops }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Recalculation failed");
      setRun(data.run as DeliveryRun);
      setReorderModalOpen(false);
      setReorderStops([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recalculate route");
    } finally {
      setRecalculatingReorder(false);
    }
  }

  async function handleCopyDriverLink() {
    if (!id) return;
    setError(null);
    setDriverLinkModal(null);
    if (cachedDriverLink) {
      const ok = await copyToClipboard(cachedDriverLink);
      if (ok) {
        setCopyLinkSuccess(true);
        return;
      }
      setDriverLinkModal({ url: cachedDriverLink });
      return;
    }
    setCopyingLink(true);
    try {
      const res = await fetch(`/api/delivery-runs/${id}/driver-link`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to get link");
      const url = data.url as string;
      setCachedDriverLink(url);
      const ok = await copyToClipboard(url);
      if (ok) {
        setCopyLinkSuccess(true);
        return;
      }
      setDriverLinkModal({ url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy driver link");
    } finally {
      setCopyingLink(false);
    }
  }

  async function handleCopyFromModal(url: string) {
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopyLinkSuccess(true);
      setDriverLinkModal(null);
    } else {
      setError("Could not copy. Select the link above and copy manually (Cmd+C).");
    }
  }

  if (!id) {
    return (
      <main className="min-h-screen p-6 md:p-8 bg-blue-50/50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Missing run ID.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-blue-600 hover:underline font-medium">
            ← Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen p-6 md:p-8 bg-blue-50/50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
          <p className="text-slate-600">Loading…</p>
        </div>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="min-h-screen p-6 md:p-8 bg-blue-50/50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Run not found.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-blue-600 hover:underline font-medium">
            ← Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const isDraft = run.status === "draft";
  const stops = run.optimized_route?.stops ?? [];
  const totals = run.optimized_route;
  const customers = run.customers ?? [];

  return (
    <main className="min-h-screen bg-blue-50/50">
      <div className="bg-white border-b border-slate-200 shadow-sm border-l-4 border-l-blue-500">
        <div className="px-4 sm:px-6 py-4 md:py-6">
          {/* Utility nav — secondary, top */}
          <div className="flex items-center justify-between mb-5">
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors flex items-center gap-1"
            >
              <span aria-hidden>←</span> Dashboard
            </Link>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                window.location.href = "/login";
              }}
              className="text-slate-500 hover:text-rose-600 text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>

          {/* Primary: date + status */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4 gap-3 mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {formatDate(run.run_date)}
            </h1>
            <span
              className={`inline-flex w-fit px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${
                run.status === "draft"
                  ? "bg-amber-100 text-amber-800"
                  : run.status === "optimized"
                  ? "bg-blue-100 text-blue-800"
                  : run.status === "in_progress"
                  ? "bg-emerald-100 text-emerald-800"
                  : run.status === "completed"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {run.status.replace("_", " ")}
            </span>
          </div>

          {/* Run details — labeled, grouped */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm mb-6">
            <span className="font-medium text-blue-700">
              {run.driver_name || "No driver"}
            </span>
            <span className="text-slate-400" aria-hidden>•</span>
            <span className="text-slate-600">Planned {formatTime(run.start_time)}</span>
            <span className="text-slate-400" aria-hidden>•</span>
            <span className="font-medium text-indigo-700">
              {isDraft ? customers.length : stops.length} {isDraft ? customers.length === 1 : stops.length === 1 ? "stop" : "stops"}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
          <Link
            href={`/edit-run?id=${id}`}
            className="min-h-[44px] px-4 py-2.5 border border-blue-200 rounded-xl hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center gap-2 text-sm font-medium text-blue-700 transition-colors"
          >
            <span aria-hidden>✏️</span> Edit Run
          </Link>
          {isDraft && (
            <button
              type="button"
              onClick={handleOptimize}
              disabled={optimizing || customers.length === 0}
              className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-semibold transition-colors shadow-sm"
            >
              <span aria-hidden>✈️</span>
              {optimizing ? "Optimizing…" : "Optimize Route"}
            </button>
          )}
          {!isDraft && (
            <>
              <button
                type="button"
                onClick={handleCopyDriverLink}
                disabled={copyingLink}
                className={`min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center transition-colors ${
                  copyLinkSuccess
                    ? "border-2 border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border border-blue-300 hover:bg-blue-50 text-blue-700 hover:border-blue-400"
                }`}
              >
                {copyingLink ? "Copying…" : copyLinkSuccess ? "Copied!" : "Copy Driver Link"}
              </button>
              <a
                href={`/api/delivery-runs/${id}/export/route`}
                download="route.xlsx"
                className="min-h-[44px] px-4 py-2.5 border border-emerald-200 rounded-xl hover:bg-emerald-50 flex items-center justify-center text-sm font-medium text-emerald-700 transition-colors"
              >
                Export to Excel
              </a>
              <a
                href={`/api/delivery-runs/${id}/export/reverse`}
                download="reverse.xlsx"
                className="min-h-[44px] px-4 py-2.5 border border-violet-200 rounded-xl hover:bg-violet-50 flex items-center justify-center text-sm font-medium text-violet-700 transition-colors"
              >
                Export Reverse
              </a>
              <button
                type="button"
                onClick={handleCopyReverse}
                disabled={copyingReverse}
                className="min-h-[44px] px-4 py-2.5 border border-teal-200 rounded-xl hover:bg-teal-50 text-sm font-medium text-teal-700 disabled:opacity-50 transition-colors"
              >
                {copyingReverse ? "Copying…" : "Copy Reverse"}
              </button>
              <button
                type="button"
                onClick={handleOpenLabelsModal}
                className="min-h-[44px] px-4 py-2.5 border-2 border-orange-400 text-orange-600 rounded-xl text-sm font-semibold hover:bg-orange-50 transition-colors"
              >
                Export Labels
              </button>
              {run.status === "optimized" && (
                <button
                  type="button"
                  onClick={handleOpenReorderModal}
                  className="min-h-[44px] px-4 py-2.5 border border-indigo-200 rounded-xl hover:bg-indigo-50 text-sm font-medium text-indigo-700 transition-colors"
                >
                  Manually Reorder
                </button>
              )}
            </>
          )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 sm:mx-6 mt-4 p-4 border border-red-200 bg-red-50 text-red-700 rounded-xl flex items-start gap-3">
          <span aria-hidden className="text-lg">⚠</span>
          <span className="flex-1">{error}</span>
        </div>
      )}

      {copyLinkSuccess && (
        <div className="mx-4 sm:mx-6 mt-4 p-4 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-xl flex items-center gap-2 font-medium">
          <span aria-hidden>✓</span>
          Link copied to clipboard
        </div>
      )}

      {labelsModalOpen && (
        <ExportLabelsModal
          stops={stops}
          labelQuantities={labelQuantities}
          setLabelQuantities={setLabelQuantities}
          extraCustomers={extraCustomers}
          setExtraCustomers={setExtraCustomers}
          extraForm={extraForm}
          setExtraForm={setExtraForm}
          extrasPlacement={extrasPlacement}
          setExtrasPlacement={setExtrasPlacement}
          onSetAllQuantities={setAllQuantities}
          onAddExtra={handleAddExtraCustomer}
          onExport={handleExportLabelsSubmit}
          onClose={() => setLabelsModalOpen(false)}
          exporting={exportingLabels}
        />
      )}

      {reorderModalOpen && (
        <ManuallyReorderModal
          stops={reorderStops}
          customers={run?.customers ?? []}
          onReorder={setReorderStops}
          onApply={handleApplyReorder}
          onClose={handleCancelReorder}
          recalculating={recalculatingReorder}
        />
      )}

      {driverLinkModal && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDriverLinkModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg text-slate-900 mb-2">Driver Link</h3>
            <p className="text-sm text-slate-600 mb-3">
              Automatic copy failed. Use the button below or select and copy the link (Cmd+C).
            </p>
            <input
              ref={driverLinkInputRef}
              type="text"
              readOnly
              value={driverLinkModal.url}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-mono bg-slate-50 mb-4"
              onFocus={(e) => e.target.select()}
            />
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={() => setDriverLinkModal(null)}
                className="min-h-[44px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => handleCopyFromModal(driverLinkModal.url)}
                className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 sm:p-6 lg:p-8">
        {isDraft ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <div className="lg:col-span-2">
              <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <span className="text-blue-500" aria-hidden>📍</span> Customer Stops
              </h2>
              {customers.length === 0 ? (
                <div className="p-8 md:p-12 border border-blue-100 rounded-2xl bg-blue-50/50 text-center text-slate-600">
                  No customers yet.{" "}
                  <Link href={`/edit-run?id=${id}`} className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
                    Edit run
                  </Link>{" "}
                  to add customers.
                </div>
              ) : (
                <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                  {customers.map((c: DeliveryCustomer, i: number) => (
                    <CustomerStopCard key={i} customer={c} index={i + 1} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <RunSummarySidebar run={run} stopsCount={customers.length} />
              <div className="p-5 border border-slate-200 rounded-2xl bg-white shadow-sm mt-6 border-l-4 border-l-amber-400">
                <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <span className="text-amber-500" aria-hidden>✨</span> Next Steps
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-slate-600">
                  <li>Click &quot;Optimize Route&quot; to calculate the best route</li>
                  <li>Review the optimized stops and ETAs</li>
                  <li>Copy Driver Link and start the run</li>
                </ol>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
            <div className="lg:col-span-2 space-y-6 lg:space-y-8 order-2 lg:order-1">
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white border-t-4 border-t-blue-500">
                <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-blue-50/80">
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <span aria-hidden>🗺️</span> Route Map
                  </h2>
                </div>
                {run && <RouteMap run={run} />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <span className="text-indigo-500" aria-hidden>📍</span> Optimized Route
                </h2>
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm border-t-4 border-t-indigo-500">
                  <div className="space-y-0 divide-y divide-slate-200">
                    {stops.map((stop: OptimizedStop, i: number) => (
                      <OptimizedStopCard
                        key={i}
                        stop={stop}
                        index={i + 1}
                        stopIndex={i}
                        isEditing={editingStopIndex === i}
                        saving={savingStopIndex === i}
                        onEdit={() => setEditingStopIndex(i)}
                        onDone={(updates) => handleUpdateStop(i, updates)}
                        onCancel={() => setEditingStopIndex(null)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <RunSummarySidebar
                run={run}
                totals={totals}
                stopsCount={totals ? stops.length : run.customers?.length ?? 0}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function CustomerStopCard({
  customer,
  index,
}: {
  customer: DeliveryCustomer;
  index: number;
}) {
  return (
    <div className="p-4 sm:p-5 border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md hover:border-blue-200 transition-all">
      <div className="flex gap-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900">{customer.name}</p>
          <p className="text-sm text-slate-600 flex items-start gap-1 mt-1">
            <span aria-hidden className="flex-shrink-0">📍</span>
            <span>{customer.address}</span>
          </p>
          <p className="text-sm text-slate-600 flex items-center gap-1 mt-0.5">
            <span aria-hidden>📞</span>
            {customer.phone || "—"}
          </p>
          {customer.notes && (
            <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs font-medium text-amber-800 uppercase tracking-wide">Note</p>
              <p className="text-sm text-amber-900">{customer.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableStopRow({
  stop,
  index,
  customers,
}: {
  stop: OptimizedStop;
  index: number;
  customers: DeliveryCustomer[];
}) {
  const ci = stop.customer_index;
  const parsed =
    typeof ci === "number" && ci >= 0 && ci < customers.length
      ? parseFixedStopValue(customers[ci].fixed_stop_position)
      : { ok: true as const, value: null as number | null };
  const fixedLocked = parsed.ok && parsed.value !== null;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index, disabled: fixedLocked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 sm:p-4 border border-slate-200 rounded-xl flex items-center gap-3 bg-white ${isDragging ? "opacity-90 shadow-lg ring-2 ring-blue-400" : ""}`}
    >
      <button
        type="button"
        className={`min-w-[44px] min-h-[44px] flex items-center justify-center touch-none rounded-lg ${
          fixedLocked
            ? "cursor-not-allowed text-slate-300 bg-slate-50"
            : "cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 hover:bg-slate-100"
        }`}
        aria-label={
          fixedLocked
            ? `Stop ${index + 1} has a fixed position and cannot be moved`
            : `Drag to reorder stop ${index + 1}`
        }
        {...attributes}
        {...(fixedLocked ? {} : listeners)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 6h2v2H8V6zm0 5h2v2H8v-2zm0 5h2v2H8v-2zm5-10h2v2h-2V6zm0 5h2v2h-2v-2zm0 5h2v2h-2v-2z" />
        </svg>
      </button>
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm text-slate-900">{stop.customer_name}</p>
          {fixedLocked && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
              Fixed
            </span>
          )}
        </div>
        {stop.customer_address && (
          <p className="text-xs text-slate-500 truncate">{stop.customer_address}</p>
        )}
      </div>
    </div>
  );
}

function ManuallyReorderModal({
  stops,
  customers,
  onReorder,
  onApply,
  onClose,
  recalculating,
}: {
  stops: OptimizedStop[];
  customers: DeliveryCustomer[];
  onReorder: (stops: OptimizedStop[]) => void;
  onApply: () => void;
  onClose: () => void;
  recalculating: boolean;
}) {
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setReorderError(null);
    if (over && active.id !== over.id) {
      const oldIndex = Number(active.id);
      const newIndex = Number(over.id);
      if (!Number.isNaN(oldIndex) && !Number.isNaN(newIndex) && oldIndex >= 0 && newIndex < stops.length) {
        const next = arrayMove(stops, oldIndex, newIndex);
        const msg = getManualReorderValidationMessage(next, customers);
        if (msg) {
          setReorderError(msg);
          return;
        }
        onReorder(next);
      }
    }
  }

  const itemIds = stops.map((_, i) => i);

  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[10000]">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">Manually Reorder Stops</h2>
          <p className="text-slate-600 text-sm mt-1">
            Drag stops to change the delivery sequence. ETAs and distances will be recalculated.
          </p>
          {reorderError && (
            <p className="text-sm text-red-600 mt-2" role="alert">
              {reorderError}
            </p>
          )}
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={itemIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {stops.map((stop, i) => (
                  <SortableStopRow
                    key={`${stop.customer_index}-${stop.customer_name}-${stop.customer_address}`}
                    stop={stop}
                    index={i}
                    customers={customers}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <div className="p-5 sm:p-6 border-t border-slate-200 flex flex-col-reverse sm:flex-row justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={recalculating}
            className="min-h-[44px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={recalculating}
            className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {recalculating ? "Recalculating…" : "Apply & Recalculate"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProofOfDeliveryPreview({ urls }: { urls: string[] }) {
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
              className="block rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
              title={`View proof ${j + 1}`}
            >
              <Image
                src={src}
                alt={`Proof ${j + 1}`}
                width={56}
                height={56}
                className="w-14 h-14 object-cover"
                unoptimized={src.startsWith("/")}
              />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function OptimizedStopCard({
  stop,
  index,
  stopIndex,
  isEditing,
  saving,
  onEdit,
  onDone,
  onCancel,
}: {
  stop: OptimizedStop;
  index: number;
  stopIndex?: number;
  isEditing?: boolean;
  saving?: boolean;
  onEdit?: () => void;
  onDone?: (updates: {
    customer_name: string;
    customer_phone: string;
    notes?: string;
  }) => void;
  onCancel?: () => void;
}) {
  const [draftName, setDraftName] = useState(stop.customer_name ?? "");
  const [draftPhone, setDraftPhone] = useState(stop.customer_phone ?? "");
  const [draftNotes, setDraftNotes] = useState(stop.notes ?? "");

  useEffect(() => {
    if (isEditing) {
      setDraftName(stop.customer_name ?? "");
      setDraftPhone(stop.customer_phone ?? "");
      setDraftNotes(stop.notes ?? "");
    }
  }, [isEditing, stop.customer_name, stop.customer_phone, stop.notes]);

  const hasEditHandlers = onEdit && onDone && onCancel && typeof stopIndex === "number";

  function handleDone() {
    if (!onDone || saving) return;
    onDone({
      customer_name: draftName.trim(),
      customer_phone: draftPhone.trim(),
      notes: draftNotes.trim() || undefined,
    });
  }

  return (
    <div className={`p-4 sm:p-5 transition-colors ${isEditing ? "bg-slate-50" : "hover:bg-slate-50/70"}`}>
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-2">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
              stop.completed ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
            }`}
          >
            {index}
          </div>
          {hasEditHandlers &&
            (isEditing ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={handleDone}
                  disabled={saving}
                  className="min-h-[36px] px-2 text-emerald-600 hover:underline text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Done"}
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={saving}
                  className="text-slate-500 hover:underline text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onEdit}
                className="text-blue-600 hover:underline text-xs font-medium"
              >
                Edit
              </button>
            ))}
        </div>
        <div className="flex-1 min-w-0">
          {isEditing && hasEditHandlers ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Name</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Customer name"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Phone</label>
                <input
                  type="text"
                  value={draftPhone}
                  onChange={(e) => setDraftPhone(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Phone number"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Notes</label>
                <input
                  type="text"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Buzz code, instructions..."
                />
              </div>
              <p className="text-sm text-slate-500 flex items-start gap-1">
                <span aria-hidden className="flex-shrink-0">📍</span>
                <span>{stop.customer_address}</span>
                <span className="text-xs">(read-only)</span>
              </p>
              {stop.completed && stop.completed_at && (
                <p className="text-xs text-slate-600">
                  Delivered at{" "}
                  {new Date(stop.completed_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}
              <ProofOfDeliveryPreview
                urls={stop.completed ? (stop.proof_of_delivery_images ?? []) : []}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-slate-900">{stop.customer_name}</p>
                {stop.completed && (
                  <>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
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
              <p className="text-sm text-slate-600 flex items-start gap-1 mt-0.5">
                <span aria-hidden className="flex-shrink-0">📍</span>
                <span>{stop.customer_address}</span>
              </p>
              <p className="text-sm text-slate-600 flex items-center gap-1 mt-0.5">
                <span aria-hidden>📞</span>
                {stop.customer_phone || "—"}
              </p>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-sm">
                {stop.eta && (
                  <span className="text-blue-600 font-semibold">ETA: {stop.eta}</span>
                )}
                {(stop.distance_from_previous ?? 0) > 0 && (
                  <span className="text-slate-500">
                    {(stop.distance_from_previous ?? 0).toFixed(1)} km from previous
                  </span>
                )}
              </div>
              {stop.notes && (
                <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-xs font-medium text-amber-800 uppercase tracking-wide">Note</p>
                  <p className="text-sm text-amber-900">{stop.notes}</p>
                </div>
              )}
              <ProofOfDeliveryPreview
                urls={stop.completed ? (stop.proof_of_delivery_images ?? []) : []}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RunDetailsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-6 md:p-8 bg-slate-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
            <p className="text-slate-600">Loading…</p>
          </div>
        </main>
      }
    >
      <RunDetailsContent />
    </Suspense>
  );
}
