"use client";

import { useState, useEffect } from "react";
import { AddSingleCustomer } from "./AddSingleCustomer";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export interface CustomerRow {
  name: string;
  phone: string;
  address: string;
  notes?: string;
  geocode_status?: string;
  geocode_error?: string;
  nearby_address_override?: string;
  nearby_lat?: number;
  nearby_lng?: number;
  lat?: number;
  lng?: number;
  is_first_stop?: boolean;
  is_end_point?: boolean;
}

interface CustomersEditorProps {
  customers: CustomerRow[];
  onSave: (customers: CustomerRow[]) => Promise<void>;
  onParseAndAdd: (text: string) => Promise<void>;
  onGeocode: () => Promise<void>;
  onValidateOverride: (index: number, address: string) => Promise<void>;
  saveBlocked: boolean;
  saveBlockMessage?: string;
  /** Called with current customers when Save & Optimize is triggered */
  onSaveAndOptimize?: (customers: CustomerRow[]) => Promise<void>;
  /** Called when save or save-and-optimize fails */
  onError?: (message: string) => void;
  /** Toggle a customer as the route end point; pass null to clear */
  onSetEndPoint: (index: number | null) => Promise<void>;
}

export function CustomersEditor({
  customers,
  onSave,
  onParseAndAdd,
  onGeocode,
  onValidateOverride,
  saveBlocked,
  saveBlockMessage,
  onSaveAndOptimize,
  onError,
  onSetEndPoint,
}: CustomersEditorProps) {
  const [localCustomers, setLocalCustomers] = useState<CustomerRow[]>(customers);
  const [pastedText, setPastedText] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [geocodeLoading, setGeocodeLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [overrideIndex, setOverrideIndex] = useState<number | null>(null);
  const [overrideInput, setOverrideInput] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [endPointLoadingIndex, setEndPointLoadingIndex] = useState<number | null>(null);

  useEffect(() => {
    setLocalCustomers(customers);
  }, [customers]);

  function updateCustomer(index: number, updates: Partial<CustomerRow>) {
    setLocalCustomers((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  }

  async function handleParse() {
    if (!pastedText.trim()) return;
    setParseLoading(true);
    try {
      await onParseAndAdd(pastedText);
      setPastedText("");
    } finally {
      setParseLoading(false);
    }
  }

  async function handleGeocode() {
    setGeocodeLoading(true);
    try {
      await onGeocode();
    } finally {
      setGeocodeLoading(false);
    }
  }

  const hasFailedWithoutOverride = localCustomers.some(
    (c) =>
      c.geocode_status === "failed" && !(c.nearby_address_override?.trim())
  );
  const effectiveSaveBlocked = saveBlocked || hasFailedWithoutOverride;
  const effectiveSaveBlockMessage =
    saveBlockMessage ??
    (hasFailedWithoutOverride
      ? "Fix failed geocodes or add nearby address overrides before saving."
      : undefined);

  async function handleSave(andOptimize = false) {
    if (effectiveSaveBlocked && !andOptimize) return;
    if (andOptimize && effectiveSaveBlocked) return;
    setSaveLoading(true);
    try {
      if (andOptimize && onSaveAndOptimize) {
        await onSaveAndOptimize(localCustomers);
      } else {
        await onSave(localCustomers);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      onError?.(msg);
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleValidateOverride() {
    if (overrideIndex === null || !overrideInput.trim()) return;
    await onValidateOverride(overrideIndex, overrideInput);
    setOverrideIndex(null);
    setOverrideInput("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <span aria-hidden>📍</span> Add Single Customer
        </h3>
        <AddSingleCustomer onParseAndAdd={onParseAndAdd} />
      </div>

      <div>
        <h3 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
          <span aria-hidden>📋</span> Paste Customer List
        </h3>
        <p className="text-sm text-slate-600 mb-1">
          Copy and paste your customer data here. Paste data from Excel, Google
          Sheets, or any format. Each address will be automatically validated and
          geocoded.
        </p>
        <p className="text-xs text-slate-500 mb-2">
          Tab-delimited: Name [TAB] Address [TAB] Phone. Notes in parentheses
          (e.g. Buzz code: 123) are extracted automatically.
        </p>
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder={`John Smith\t123 Main St Toronto ON M5V 1A1\t4161234567\nJane Doe\tUnit 506 456 Queen St W\t4169876543`}
          className="w-full border border-slate-200 rounded-xl px-4 py-3 h-24 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          rows={4}
        />
        <button
          type="button"
          onClick={handleParse}
          disabled={parseLoading || !pastedText.trim()}
          className="mt-3 min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {parseLoading ? "Parsing & geocoding…" : "Parse & Add Customers"}
        </button>
      </div>

      <div>
        <h3 className="font-semibold text-slate-800 mb-2">Geocode</h3>
        <p className="text-xs text-slate-500 mb-2">
          Re-run geocoding for pending or failed addresses. Parse & Add already
          geocodes new customers.
        </p>
        <button
          type="button"
          onClick={handleGeocode}
          disabled={geocodeLoading || customers.length === 0}
          className="min-h-[44px] px-5 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          {geocodeLoading ? "Geocoding…" : "Geocode All"}
        </button>
      </div>

      {effectiveSaveBlocked && effectiveSaveBlockMessage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-4 flex items-start gap-3">
          <span aria-hidden className="text-lg">⚠</span>
          <span className="flex-1 text-sm">{effectiveSaveBlockMessage}</span>
        </div>
      )}

      <div>
        <h3 className="font-semibold text-slate-800 mb-3">Customers ({localCustomers.length})</h3>
        <div className="border border-slate-200 rounded-xl overflow-hidden overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left text-slate-700 font-semibold w-12"></th>
                <th className="p-3 text-left text-slate-700 font-semibold">Name</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Address</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Phone</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Notes</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Status</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Override</th>
              </tr>
            </thead>
            <tbody>
              {localCustomers.map((c, i) => (
                <tr key={i} className="border-t border-slate-200 hover:bg-slate-50/50 transition-colors">
                  <td className="p-3 align-top">
                    <div className="flex flex-col gap-1.5 items-start">
                      {editingIndex === i ? (
                        <button
                          type="button"
                          onClick={() => setEditingIndex(null)}
                          className="text-emerald-600 hover:text-emerald-700 text-xs font-semibold"
                        >
                          Done
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingIndex(i)}
                          className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          const newIndex = c.is_end_point ? null : i;
                          setEndPointLoadingIndex(i);
                          try {
                            await onSetEndPoint(newIndex);
                          } catch (err) {
                            onError?.(err instanceof Error ? err.message : "Failed to set end location");
                          } finally {
                            setEndPointLoadingIndex(null);
                          }
                        }}
                        disabled={
                          endPointLoadingIndex !== null ||
                          (!c.is_end_point &&
                            c.geocode_status !== "success" &&
                            c.geocode_status !== "override_success")
                        }
                        title={
                          !c.is_end_point &&
                          c.geocode_status !== "success" &&
                          c.geocode_status !== "override_success"
                            ? "Geocode this address successfully before setting as end location"
                            : c.is_end_point
                            ? "Remove as route end location"
                            : "Set as route end location"
                        }
                        className={
                          c.is_end_point
                            ? "text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                            : "text-xs font-medium px-2 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors disabled:opacity-40 whitespace-nowrap"
                        }
                      >
                        {endPointLoadingIndex === i
                          ? "…"
                          : c.is_end_point
                          ? "End ✓"
                          : "Set End"}
                      </button>
                    </div>
                  </td>
                  <td className="p-3 align-top">
                    {editingIndex === i ? (
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) =>
                          updateCustomer(i, { name: e.target.value })
                        }
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 min-w-0 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Name"
                      />
                    ) : (
                      <span className="text-slate-800">{c.name}</span>
                    )}
                  </td>
                  <td className="p-3 align-top min-w-[180px]">
                    {editingIndex === i ? (
                      <AddressAutocomplete
                        value={c.address}
                        onChange={(v) =>
                          updateCustomer(i, {
                            address: v,
                            geocode_status: "pending",
                            nearby_address_override: undefined,
                            nearby_lat: undefined,
                            nearby_lng: undefined,
                          })
                        }
                        onSelectDetails={(d) => {
                          updateCustomer(i, {
                            address: d.address,
                            lat: d.lat,
                            lng: d.lng,
                            geocode_status: "success",
                            geocode_error: undefined,
                            nearby_address_override: undefined,
                            nearby_lat: undefined,
                            nearby_lng: undefined,
                          });
                        }}
                        placeholder="Start typing address..."
                        className="border border-slate-200 rounded-lg px-3 py-2 w-full min-w-0 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    ) : (
                      <span className="text-slate-700">{c.address}</span>
                    )}
                  </td>
                  <td className="p-3 align-top">
                    {editingIndex === i ? (
                      <input
                        type="text"
                        value={c.phone}
                        onChange={(e) =>
                          updateCustomer(i, { phone: e.target.value })
                        }
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 min-w-0 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Phone"
                      />
                    ) : (
                      <span className="text-slate-700">{c.phone}</span>
                    )}
                  </td>
                  <td className="p-3 align-top min-w-[120px]">
                    {editingIndex === i ? (
                      <input
                        type="text"
                        value={c.notes ?? ""}
                        onChange={(e) =>
                          updateCustomer(i, {
                            notes: e.target.value.trim() || undefined,
                          })
                        }
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 min-w-0 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Buzz code, notes..."
                      />
                    ) : (
                      <span className="text-slate-600">{c.notes ?? ""}</span>
                    )}
                  </td>
                  <td className="p-3 align-top">
                    <span
                      className={
                        c.geocode_status === "success" ||
                        c.geocode_status === "override_success"
                          ? "text-emerald-600 font-medium"
                          : c.geocode_status === "failed"
                            ? "text-red-600 font-medium"
                            : "text-slate-500"
                      }
                    >
                      {c.geocode_status ?? "pending"}
                    </span>
                    {c.geocode_error && (
                      <span className="block text-xs text-red-600 mt-0.5">
                        {c.geocode_error}
                      </span>
                    )}
                  </td>
                  <td className="p-3 align-top">
                    {editingIndex === i ? null : overrideIndex === i ? (
                      <div className="flex gap-2 flex-wrap">
                        <AddressAutocomplete
                          value={overrideInput}
                          onChange={setOverrideInput}
                          placeholder="Start typing address..."
                          className="border border-slate-200 rounded-lg px-3 py-2 flex-1 min-w-0 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={handleValidateOverride}
                          className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors"
                        >
                          Validate
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideIndex(null);
                            setOverrideInput("");
                          }}
                          className="px-3 py-2 text-slate-600 text-sm hover:text-slate-800 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOverrideIndex(i)}
                        className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                      >
                        Add override
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={effectiveSaveBlocked || saveLoading}
          className="min-h-[44px] px-5 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saveLoading ? "Saving…" : "Save Run"}
        </button>
        {onSaveAndOptimize && (
          <button
            type="button"
            onClick={() => handleSave(true)}
            disabled={
              effectiveSaveBlocked ||
              saveLoading ||
              localCustomers.length === 0
            }
            className="min-h-[44px] px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {saveLoading ? "Saving & Optimizing…" : "Save & Optimize Route"}
          </button>
        )}
      </div>
    </div>
  );
}
