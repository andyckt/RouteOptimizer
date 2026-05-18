"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { RunForm, type RunFormData } from "@/components/runs/RunForm";
import { AddSingleCustomer } from "@/components/runs/AddSingleCustomer";
import type { DeliveryCustomer } from "@/types/delivery-run";
import {
  CUSTOMER_PASTE_FORMAT_LINES,
  CUSTOMER_PASTE_PLACEHOLDER,
} from "@/lib/parsing/order-ids-input";

function todayYYYYMMDD(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function CreateRunPage() {
  const router = useRouter();
  const today = todayYYYYMMDD();

  const [runDetails, setRunDetails] = useState<RunFormData>({
    run_date: today,
    driver_name: "",
    start_location: "",
    end_location: "",
    start_time: "09:00",
    travel_mode: "driving",
  });
  const [customers, setCustomers] = useState<DeliveryCustomer[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleParseAndGeocode() {
    if (!pastedText.trim()) return;
    setError(null);
    setParseLoading(true);
    try {
      const res = await fetch("/api/parse-and-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pastedText }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to parse");
      }
      const data = await res.json();
      const parsed = (data.customers ?? []) as DeliveryCustomer[];
      setCustomers((prev) => {
        const merged = [...prev];
        for (const nc of parsed) {
          const dup = merged.find(
            (e) =>
              e.address === nc.address &&
              (e.phone === nc.phone || (!e.phone && !nc.phone))
          );
          if (!dup) merged.push(nc);
        }
        return merged;
      });
      setPastedText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse");
    } finally {
      setParseLoading(false);
    }
  }

  async function handleCreate() {
    setError(null);
    setCreateLoading(true);
    try {
      const res = await fetch("/api/delivery-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_date: runDetails.run_date ?? today,
          driver_name: runDetails.driver_name ?? "",
          start_location: runDetails.start_location ?? "",
          end_location: runDetails.end_location || undefined,
          start_time: runDetails.start_time ?? "09:00",
          travel_mode: runDetails.travel_mode ?? "driving",
          customers,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create run");
      }
      const run = await res.json();
      router.push(`/run-details?id=${run._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-blue-50/50">
      <div className="bg-white border-b border-slate-200 shadow-sm border-l-4 border-l-blue-500">
        <div className="px-4 sm:px-6 py-4 md:py-6">
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
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
            Create New Delivery Run
          </h1>
          <p className="text-slate-600">Set up a new delivery route for optimization.</p>
        </div>
      </div>

      <div className="p-4 sm:p-6 lg:p-8">
        <div className="space-y-6 lg:space-y-8 max-w-3xl mx-auto">
          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-blue-500 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-blue-50/80">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1 h-5 bg-blue-500 rounded-full" aria-hidden />
                Run Details
              </h2>
            </div>
            <div className="p-5 sm:p-6">
              <RunForm
                value={runDetails}
                onChange={setRunDetails}
                showSubmit={false}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-indigo-500 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-indigo-50/80">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1 h-5 bg-indigo-500 rounded-full" aria-hidden />
                Paste Customer List
              </h3>
            </div>
            <div className="p-5 sm:p-6">
              <p className="text-sm text-slate-600 mb-2">
                Copy and paste your customer data here. Paste data from Excel, Google
                Sheets, or any format. Each address will be automatically validated
                and geocoded.
              </p>
              <div className="text-xs text-slate-500 mb-3 space-y-1">
                {CUSTOMER_PASTE_FORMAT_LINES.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={CUSTOMER_PASTE_PLACEHOLDER}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 min-h-[120px] font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={5}
              />
              <button
                type="button"
                onClick={handleParseAndGeocode}
                disabled={parseLoading || !pastedText.trim()}
                className="mt-3 min-h-[44px] px-5 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 font-medium transition-colors"
              >
                {parseLoading ? "Parsing & geocoding…" : "Parse & Add Customers"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-emerald-500 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-emerald-50/80">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="w-1 h-5 bg-emerald-500 rounded-full" aria-hidden />
                Add Single Customer
              </h3>
            </div>
            <div className="p-5 sm:p-6">
              <AddSingleCustomer onAdd={(c) => setCustomers((prev) => [...prev, c])} />
            </div>
          </div>

          {customers.length > 0 && (
            <div className="rounded-2xl border border-slate-200 shadow-sm bg-white border-t-4 border-t-violet-500 overflow-hidden">
              <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-violet-50/80">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span className="w-1 h-5 bg-violet-500 rounded-full" aria-hidden />
                  Customers ({customers.length})
                </h3>
              </div>
              <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="p-3 text-left font-medium text-slate-700 w-20">Actions</th>
                      <th className="p-3 text-left font-medium text-slate-700">Kapioo order IDs</th>
                      <th className="p-3 text-left font-medium text-slate-700">Name</th>
                      <th className="p-3 text-left font-medium text-slate-700">Address</th>
                      <th className="p-3 text-left font-medium text-slate-700">Phone</th>
                      <th className="p-3 text-left font-medium text-slate-700">Geocode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c, i) => (
                      <tr key={i} className="border-t border-slate-200 hover:bg-slate-50/50">
                        <td className="p-3">
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Remove this customer from the list?")) {
                                setCustomers((prev) => prev.filter((_, idx) => idx !== i));
                              }
                            }}
                            title="Remove customer from list"
                            className="text-xs font-medium px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
                          >
                            Remove
                          </button>
                        </td>
                        <td className="p-3 text-slate-600 font-mono text-xs">
                          {c.order_ids?.length ? c.order_ids.join(", ") : "—"}
                        </td>
                        <td className="p-3 text-slate-900">{c.name}</td>
                        <td className="p-3 text-slate-600">{c.address}</td>
                        <td className="p-3 text-slate-600">{c.phone}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              c.geocode_status === "success" ||
                              c.geocode_status === "override_success"
                                ? "bg-emerald-100 text-emerald-800"
                                : c.geocode_status === "failed"
                                ? "bg-red-100 text-red-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {c.geocode_status ?? "pending"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 p-4 flex items-start gap-3">
              <span aria-hidden className="text-lg">⚠</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={createLoading || !runDetails.start_location?.trim()}
              className="min-h-[44px] px-6 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
            >
              <span aria-hidden>📁</span>
              {createLoading ? "Creating…" : "Create Delivery Run"}
            </button>
            <Link
              href="/dashboard"
              className="min-h-[44px] px-6 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 font-medium flex items-center justify-center transition-colors"
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
