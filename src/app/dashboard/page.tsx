"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { RunIntegrationMetadata } from "@/components/runs/RunIntegrationMetadata";
import { hasRunIntegrationMetadata } from "@/lib/integration/displayRunMetadata";

interface RunSummary {
  _id: string;
  run_date: string;
  driver_name: string;
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  created_by_integration?: string;
  status: string;
  actual_start_time?: string;
  optimized_route?: {
    total_duration_minutes?: number;
    stops?: Array<{ completed?: boolean; completed_at?: string }>;
  };
  customers?: unknown[];
  createdAt?: string;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getCompletionTime(run: RunSummary): string | null {
  if (run.status !== "completed") return null;
  const stops = run.optimized_route?.stops ?? [];
  const completedAts = stops
    .filter((s) => s.completed_at)
    .map((s) => new Date(s.completed_at!).getTime());
  if (completedAts.length === 0) return null;
  const latest = Math.max(...completedAts);
  return new Date(latest).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getActualCompletionDuration(run: RunSummary): number | null {
  if (run.status !== "completed") return null;
  if (!run.actual_start_time) return null;
  const stops = run.optimized_route?.stops ?? [];
  const completedAts = stops
    .filter((s) => s.completed_at)
    .map((s) => new Date(s.completed_at!).getTime());
  if (completedAts.length === 0) return null;
  const latestMs = Math.max(...completedAts);
  const startMs = new Date(run.actual_start_time).getTime();
  const durationMinutes = Math.round((latestMs - startMs) / (1000 * 60));
  return durationMinutes >= 0 ? durationMinutes : null;
}

function filterRuns(
  runs: RunSummary[],
  searchQuery: string,
  dateFilter: string,
  customDate: string
): RunSummary[] {
  let result = runs;

  // Date filter
  if (dateFilter !== "all") {
    const today = new Date().toISOString().slice(0, 10);
    const todayDate = new Date(today);

    if (dateFilter === "today") {
      result = result.filter((r) => r.run_date === today);
    } else if (dateFilter === "yesterday") {
      const yesterday = new Date(todayDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      result = result.filter((r) => r.run_date === yesterdayStr);
    } else if (dateFilter === "week") {
      const weekStart = new Date(todayDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartStr = weekStart.toISOString().slice(0, 10);
      result = result.filter((r) => r.run_date >= weekStartStr && r.run_date <= today);
    } else if (dateFilter === "month") {
      const monthStart = today.slice(0, 7);
      result = result.filter((r) => r.run_date.startsWith(monthStart));
    } else if (dateFilter === "custom" && customDate) {
      result = result.filter((r) => r.run_date === customDate);
    }
  }

  // Search filter (driver name, date, status)
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (r) =>
        (r.driver_name ?? "").toLowerCase().includes(q) ||
        (r.run_date ?? "").toLowerCase().includes(q) ||
        (r.status ?? "").toLowerCase().includes(q) ||
        (r.planning_session_id ?? "").toLowerCase().includes(q) ||
        (r.external_id ?? "").toLowerCase().includes(q) ||
        (r.created_by_integration ?? "").toLowerCase().includes(q)
    );
  }

  return result;
}

export default function DashboardPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [customDate, setCustomDate] = useState("");
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<RunSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filteredRuns = filterRuns(runs, searchQuery, dateFilter, customDate);

  const closeDeleteModal = useCallback(() => {
    if (deletingId !== null) return;
    setConfirmDeleteRun(null);
    setDeleteError(null);
  }, [deletingId]);

  useEffect(() => {
    if (!confirmDeleteRun) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDeleteModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDeleteRun, closeDeleteModal]);

  async function performDelete(run: RunSummary) {
    setDeleteError(null);
    setDeletingId(run._id);
    try {
      const res = await fetch(`/api/delivery-runs/${run._id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 401) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${redirect}`;
        return;
      }
      if (res.ok || res.status === 404) {
        setRuns((prev) => prev.filter((r) => r._id !== run._id));
        setConfirmDeleteRun(null);
        return;
      }
      const text = await res.text();
      let message = "Could not delete run";
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) message = j.error;
      } catch {
        if (text) message = text.slice(0, 120);
      }
      setDeleteError(message);
    } catch {
      setDeleteError("Network error. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    fetch("/api/delivery-runs", { credentials: "include" })
      .then((r) => {
        if (r.status === 401) {
          const redirect = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = `/login?redirect=${redirect}`;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data !== null && Array.isArray(data)) setRuns(data);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-blue-50/50">
      {confirmDeleteRun && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-run-title"
          aria-describedby="delete-run-desc"
          onClick={closeDeleteModal}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 sm:p-6 border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-run-title" className="text-lg font-bold text-slate-900">
              Delete this run?
            </h2>
            <p id="delete-run-desc" className="mt-2 text-sm text-slate-600">
              <span className="font-medium text-slate-800">
                {confirmDeleteRun.run_date}
              </span>
              {" · "}
              {confirmDeleteRun.driver_name || "Unnamed driver"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              This cannot be undone. Driver links for this run will stop working.
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                disabled={deletingId !== null}
                onClick={closeDeleteModal}
                className="min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingId !== null}
                onClick={() => performDelete(confirmDeleteRun)}
                className="min-h-[44px] px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId ? "Deleting…" : "Delete run"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b border-slate-200 shadow-sm border-l-4 border-l-blue-500">
        <div className="px-4 sm:px-6 py-4 md:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Kapioo Route Optimizer
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/create-run"
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center"
              >
                Create New Run
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
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-blue-500 overflow-hidden">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div
                  className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin"
                  aria-hidden
                />
                <p className="text-slate-600">Loading…</p>
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-12 px-4">
                <p className="text-slate-600 mb-4">No runs yet. Create one to get started.</p>
                <Link
                  href="/create-run"
                  className="inline-block min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
                >
                  Create New Run
                </Link>
              </div>
            ) : (
              <>
                {/* Search and date filter */}
                <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 min-w-0">
                      <label htmlFor="dashboard-search" className="sr-only">
                        Search runs
                      </label>
                      <input
                        id="dashboard-search"
                        type="text"
                        placeholder="Search by driver, date, or status..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="dashboard-date-filter" className="sr-only">
                        Filter by date
                      </label>
                      <select
                        id="dashboard-date-filter"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="all">All dates</option>
                        <option value="today">Today</option>
                        <option value="yesterday">Yesterday</option>
                        <option value="week">This week</option>
                        <option value="month">This month</option>
                        <option value="custom">Specific date</option>
                      </select>
                      {dateFilter === "custom" && (
                        <input
                          type="date"
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      )}
                    </div>
                  </div>
                  {filteredRuns.length < runs.length && (
                    <p className="mt-2 text-xs text-slate-500">
                      Showing {filteredRuns.length} of {runs.length} runs
                    </p>
                  )}
                </div>

                {/* Mobile: Run cards */}
                <div className="block md:hidden p-4 space-y-4">
                  {filteredRuns.length === 0 ? (
                    <p className="text-slate-500 text-center py-8">
                      No runs match your filters. Try adjusting search or date.
                    </p>
                  ) : (
                    filteredRuns.map((r) => {
                    const stops = r.optimized_route?.stops ?? [];
                    const totalStops =
                      stops.length > 0 ? stops.length : r.customers?.length ?? 0;
                    const completedCount = stops.filter((s) => s.completed).length;
                    const duration = r.optimized_route?.total_duration_minutes;
                    const actualDuration = getActualCompletionDuration(r);
                    const completionTime = getCompletionTime(r);
                    return (
                      <div
                        key={r._id}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-slate-900 font-medium">{r.run_date}</span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                              r.status === "completed"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {r.status}
                          </span>
                        </div>
                        <p className={`font-medium text-slate-900 ${hasRunIntegrationMetadata(r) ? "mb-1" : "mb-3"}`}>
                          {r.driver_name || "—"}
                        </p>
                        {hasRunIntegrationMetadata(r) && (
                          <div className="mb-3">
                            <RunIntegrationMetadata run={r} variant="compact" />
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 mb-4">
                          <span>Est. {duration != null ? formatDuration(duration) : "—"}</span>
                          <span>Actual {actualDuration != null ? formatDuration(actualDuration) : "—"}</span>
                          <span>Stops: {totalStops}</span>
                          <span>
                            Completed: {totalStops > 0 ? `${completedCount}/${totalStops}` : "—"}
                          </span>
                        </div>
                        {completionTime && (
                          <p className="text-xs text-slate-500 mb-3">Done: {completionTime}</p>
                        )}
                        <div className="flex gap-2">
                          <Link
                            href={`/edit-run?id=${r._id}`}
                            className="flex-1 min-h-[40px] rounded-lg border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 flex items-center justify-center transition-colors"
                          >
                            Edit
                          </Link>
                          <Link
                            href={`/run-details?id=${r._id}`}
                            className="flex-1 min-h-[40px] rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center justify-center transition-colors"
                          >
                            Details
                          </Link>
                        </div>
                        <button
                          type="button"
                          disabled={deletingId !== null}
                          onClick={() => {
                            setDeleteError(null);
                            setConfirmDeleteRun(r);
                          }}
                          className="mt-2 w-full min-h-[40px] rounded-lg border border-red-200 text-red-700 font-medium hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  })
                  )}
                </div>

                {/* Desktop: Table */}
                <div className="hidden md:block overflow-x-auto">
                  {filteredRuns.length === 0 ? (
                    <div className="py-12 text-center text-slate-500">
                      No runs match your filters. Try adjusting search or date.
                    </div>
                  ) : (
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="p-3 text-slate-700 font-semibold">Date</th>
                        <th className="p-3 text-slate-700 font-semibold">Driver</th>
                        <th className="p-3 text-slate-700 font-semibold">Status</th>
                        <th className="p-3 text-slate-700 font-semibold">Estimated Duration</th>
                        <th className="p-3 text-slate-700 font-semibold">Actual duration</th>
                        <th className="p-3 text-slate-700 font-semibold">Stops</th>
                        <th className="p-3 text-slate-700 font-semibold">Completed</th>
                        <th className="p-3 text-slate-700 font-semibold">Completion time</th>
                        <th className="p-3 text-slate-700 font-semibold w-[1%] whitespace-nowrap">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((r) => {
                        const stops = r.optimized_route?.stops ?? [];
                        const totalStops =
                          stops.length > 0 ? stops.length : r.customers?.length ?? 0;
                        const completedCount = stops.filter((s) => s.completed).length;
                        const duration = r.optimized_route?.total_duration_minutes;
                        const actualDuration = getActualCompletionDuration(r);
                        const completionTime = getCompletionTime(r);
                        return (
                          <tr key={r._id} className="border-t border-slate-200 hover:bg-slate-50/50 transition-colors">
                            <td className="p-3 text-slate-700">{r.run_date}</td>
                            <td className="p-3 text-slate-700">
                              <div className="font-medium">{r.driver_name || "—"}</div>
                              <RunIntegrationMetadata run={r} variant="compact" />
                            </td>
                            <td className="p-3">
                              <span
                                className={`capitalize ${
                                  r.status === "completed"
                                    ? "text-emerald-600 font-medium"
                                    : "text-slate-700"
                                }`}
                              >
                                {r.status}
                              </span>
                            </td>
                            <td className="p-3 text-slate-700">
                              {duration != null ? formatDuration(duration) : "—"}
                            </td>
                            <td className="p-3 text-slate-700">
                              {actualDuration != null
                                ? formatDuration(actualDuration)
                                : "—"}
                            </td>
                            <td className="p-3 text-slate-700">{totalStops}</td>
                            <td className="p-3 text-slate-700">
                              {totalStops > 0 ? `${completedCount}/${totalStops}` : "—"}
                            </td>
                            <td className="p-3 text-slate-700">
                              {completionTime ?? "—"}
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <Link
                                  href={`/edit-run?id=${r._id}`}
                                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                                >
                                  Edit
                                </Link>
                                <Link
                                  href={`/run-details?id=${r._id}`}
                                  className="text-blue-600 hover:text-blue-700 font-medium transition-colors"
                                >
                                  Details
                                </Link>
                                <button
                                  type="button"
                                  disabled={deletingId !== null}
                                  onClick={() => {
                                    setDeleteError(null);
                                    setConfirmDeleteRun(r);
                                  }}
                                  className="text-red-600 hover:text-red-700 font-medium transition-colors disabled:opacity-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
