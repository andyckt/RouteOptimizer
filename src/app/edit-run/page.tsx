"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { RunForm, type RunFormData } from "@/components/runs/RunForm";
import {
  CustomersEditor,
  type CustomerRow,
} from "@/components/runs/CustomersEditor";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { getFixedStopPositionValidationMessage } from "@/lib/validation/fixed-stop-position";
import { RunIntegrationMetadata } from "@/components/runs/RunIntegrationMetadata";

interface RunData {
  _id: string;
  run_date: string;
  driver_name: string;
  start_location: string;
  end_location?: string;
  start_time: string;
  travel_mode: "driving" | "ebike";
  customers: CustomerRow[];
  planning_session_id?: string;
  external_id?: string;
  idempotency_key?: string;
  created_by_integration?: string;
}

function EditRunContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [run, setRun] = useState<RunData | null>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      .catch(() => setRun(null))
      .finally(() => setLoading(false));
  }, [id]);

  const fixedStopInvalidMsg = useMemo(
    () =>
      getFixedStopPositionValidationMessage(
        (run?.customers ?? []) as DeliveryCustomer[]
      ),
    [run?.customers]
  );

  if (!id) {
    return (
      <main className="min-h-screen bg-blue-50/50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-600">Missing run ID</p>
          <Link href="/dashboard" className="mt-3 inline-block text-blue-600 hover:underline font-medium">
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-blue-50/50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
          <p className="text-slate-600">Loading…</p>
        </div>
      </main>
    );
  }

  if (!run) {
    return (
      <main className="min-h-screen bg-blue-50/50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-red-600">Run not found</p>
          <Link href="/dashboard" className="mt-3 inline-block text-blue-600 hover:underline font-medium">
            Back to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const customers = run.customers ?? [];
  const hasFailedWithoutOverride = customers.some(
    (c) =>
      c.geocode_status === "failed" &&
      !(c.nearby_address_override?.trim())
  );
  const saveBlocked = hasFailedWithoutOverride;
  const saveBlockMessage = hasFailedWithoutOverride
    ? "Fix failed geocodes or add nearby address overrides before saving."
    : undefined;

  async function handleSaveForm(data: RunFormData) {
    const res = await fetch(`/api/delivery-runs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        customers: run?.customers,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to save");
    }
    const updated = await res.json();
    setRun(updated);
    router.push(`/run-details?id=${id}`);
  }

  async function handleSaveCustomers(customersToSave: CustomerRow[]) {
    if (saveBlocked || !run) return;
    const res = await fetch(`/api/delivery-runs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_date: run.run_date,
        driver_name: run.driver_name,
        start_location: run.start_location,
        end_location: run.end_location,
        start_time: run.start_time,
        travel_mode: run.travel_mode,
        customers: customersToSave,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to save");
    }
    const updated = await res.json();
    setRun(updated);
    router.push(`/run-details?id=${id}`);
  }

  async function handleOptimize() {
    if (!id) return;
    setError(null);
    setOptimizing(true);
    try {
      const res = await fetch(`/api/delivery-runs/${id}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        const msg = data.error ?? data.message ?? "Failed to optimize";
        throw new Error(typeof msg === "string" ? msg : "Failed to optimize route");
      }
      router.push(`/run-details?id=${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to optimize route");
    } finally {
      setOptimizing(false);
    }
  }

  async function handleSaveAndOptimize(customersToSave: CustomerRow[]) {
    if (saveBlocked || !run || !id) return;
    setError(null);
    const saveRes = await fetch(`/api/delivery-runs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_date: run.run_date,
        driver_name: run.driver_name,
        start_location: run.start_location,
        end_location: run.end_location,
        start_time: run.start_time,
        travel_mode: run.travel_mode,
        customers: customersToSave,
      }),
    });
    if (!saveRes.ok) {
      const err = await saveRes.json();
      throw new Error(err.error ?? "Failed to save");
    }
    const optimizeRes = await fetch(`/api/delivery-runs/${id}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!optimizeRes.ok) {
      const data = await optimizeRes.json();
      const msg = data.error ?? data.message ?? "Failed to optimize";
      throw new Error(typeof msg === "string" ? msg : "Failed to optimize route");
    }
    router.push(`/run-details?id=${id}`);
  }

  async function handleParseAndAdd(text: string) {
    const res = await fetch(`/api/delivery-runs/${id}/parse-and-add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to parse");
    }
    const data = await res.json();
    setRun((prev) =>
      prev
        ? { ...prev, customers: data.customers ?? prev.customers }
        : prev
    );
  }

  async function handleAddStructuredCustomer(customer: DeliveryCustomer) {
    if (saveBlocked || !run) return;
    const customersToSave = [...(run.customers ?? []), customer];
    const res = await fetch(`/api/delivery-runs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_date: run.run_date,
        driver_name: run.driver_name,
        start_location: run.start_location,
        end_location: run.end_location,
        start_time: run.start_time,
        travel_mode: run.travel_mode,
        customers: customersToSave,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to add customer");
    }
    const updated = await res.json();
    setRun(updated);
  }

  async function handleGeocode() {
    const res = await fetch(`/api/delivery-runs/${id}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to geocode");
    }
    const data = await res.json();
    if (data.customers) {
      setRun((prev) =>
        prev
          ? {
              ...prev,
              customers: prev.customers.map((c, i) => ({
                ...c,
                ...data.customers[i],
              })),
            }
          : prev
      );
    } else {
      const runRes = await fetch(`/api/delivery-runs/${id}`);
      const runData = await runRes.json();
      setRun(runData);
    }
  }

  async function handleSetEndPoint(index: number | null) {
    if (!run) return;
    const previousRun = run;
    const updatedCustomers = run.customers.map((c, i) => ({
      ...c,
      is_end_point: index !== null ? i === index : false,
    }));
    setRun({ ...run, customers: updatedCustomers });
    try {
      const res = await fetch(`/api/delivery-runs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          run_date: run.run_date,
          driver_name: run.driver_name,
          start_location: run.start_location,
          end_location: run.end_location,
          start_time: run.start_time,
          travel_mode: run.travel_mode,
          customers: updatedCustomers,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to update end location");
      }
      const updated = await res.json();
      setRun(updated);
    } catch (err) {
      setRun(previousRun);
      setError(err instanceof Error ? err.message : "Failed to update end location");
    }
  }

  async function handleRemoveCustomer(index: number) {
    if (!run) return;
    const previousRun = run;
    const updatedCustomers = run.customers.filter((_, i) => i !== index);
    setRun({ ...run, customers: updatedCustomers });
    try {
      const res = await fetch(`/api/delivery-runs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          run_date: run.run_date,
          driver_name: run.driver_name,
          start_location: run.start_location,
          end_location: run.end_location,
          start_time: run.start_time,
          travel_mode: run.travel_mode,
          customers: updatedCustomers,
          optimized_route: { stops: [] },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to remove customer");
      }
      const updated = await res.json();
      setRun(updated);
    } catch (err) {
      setRun(previousRun);
      setError(err instanceof Error ? err.message : "Failed to remove customer");
      throw err;
    }
  }

  async function handleValidateOverride(index: number, address: string) {
    const res = await fetch(`/api/delivery-runs/${id}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        validateOverride: true,
        customerIndex: index,
        overrideAddress: address,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to validate override");
    }
    const runRes = await fetch(`/api/delivery-runs/${id}`);
    const runData = await runRes.json();
    setRun(runData);
  }

  return (
    <main className="min-h-screen bg-blue-50/50">
      <div className="bg-white border-b border-slate-200 shadow-sm border-l-4 border-l-blue-500">
        <div className="px-4 sm:px-6 py-4 md:py-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors flex items-center gap-1"
              >
                <span aria-hidden>←</span> Dashboard
              </Link>
              <Link
                href={`/run-details?id=${id}`}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
              >
                View Run Details
              </Link>
            </div>
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Edit Run
            </h1>
            <button
              type="button"
              onClick={handleOptimize}
              disabled={
                optimizing ||
                customers.length === 0 ||
                saveBlocked ||
                Boolean(fixedStopInvalidMsg)
              }
              title={
                fixedStopInvalidMsg
                  ? fixedStopInvalidMsg
                  : saveBlocked
                    ? saveBlockMessage
                    : undefined
              }
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              <span aria-hidden>✈️</span>
              {optimizing ? "Optimizing…" : "Optimize Route"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="space-y-6 lg:space-y-8 max-w-4xl mx-auto">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-4 flex items-start gap-3">
              <span aria-hidden className="text-lg">⚠</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-blue-500 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-blue-50/80">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1 h-5 bg-blue-500 rounded-full" aria-hidden />
                Run Details
              </h2>
            </div>
            <div className="p-5 sm:p-6">
              <RunIntegrationMetadata run={run} variant="detail" />
              <RunForm
                initial={{
                  run_date: run.run_date,
                  driver_name: run.driver_name,
                  start_location: run.start_location,
                  end_location: run.end_location,
                  start_time: run.start_time,
                  travel_mode: run.travel_mode,
                }}
                onSubmit={handleSaveForm}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-emerald-500 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-emerald-50/80">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1 h-5 bg-emerald-500 rounded-full" aria-hidden />
                Customers
              </h2>
            </div>
            <div className="p-5 sm:p-6">
              <CustomersEditor
                customers={customers}
                onSave={handleSaveCustomers}
                onSaveAndOptimize={handleSaveAndOptimize}
                onParseAndAdd={handleParseAndAdd}
                onAddStructured={handleAddStructuredCustomer}
                onGeocode={handleGeocode}
                onValidateOverride={handleValidateOverride}
                saveBlocked={saveBlocked}
                saveBlockMessage={saveBlockMessage}
                onError={setError}
                onSetEndPoint={handleSetEndPoint}
                onRemoveCustomer={handleRemoveCustomer}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function EditRunPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-blue-50/50 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" aria-hidden />
            <p className="text-slate-600">Loading…</p>
          </div>
        </main>
      }
    >
      <EditRunContent />
    </Suspense>
  );
}
