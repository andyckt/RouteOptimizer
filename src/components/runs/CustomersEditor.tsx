"use client";

import { useState, useEffect, useMemo } from "react";
import { AddSingleCustomer } from "./AddSingleCustomer";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { DeliveryCustomer, StopType } from "@/types/delivery-run";
import { isSyntheticStop } from "@/lib/stops/synthetic";
import { HandoffBadge } from "@/components/stops/HandoffBadge";
import { MeetupBadge } from "@/components/stops/MeetupBadge";
import { getFixedStopPositionValidationMessage } from "@/lib/validation/fixed-stop-position";
import {
  CUSTOMER_PASTE_FORMAT_LINES,
  CUSTOMER_PASTE_PLACEHOLDER,
} from "@/lib/parsing/order-ids-input";

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
  fixed_stop_position?: number | null;
  order_ids?: string[];
  is_synthetic?: boolean;
  stop_type?: StopType;
  meetup_note?: string;
}

interface CustomersEditorProps {
  customers: CustomerRow[];
  onSave: (customers: CustomerRow[]) => Promise<void>;
  onParseAndAdd: (text: string) => Promise<void>;
  onAddStructured?: (customer: DeliveryCustomer) => Promise<void>;
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
  /** Remove a customer from the list by index */
  onRemoveCustomer?: (index: number) => Promise<void>;
}

const DEFAULT_MEETUP_NOTE = "Meet-up with another driver";

export function CustomersEditor({
  customers,
  onSave,
  onParseAndAdd,
  onAddStructured,
  onGeocode,
  onValidateOverride,
  saveBlocked,
  saveBlockMessage,
  onSaveAndOptimize,
  onError,
  onSetEndPoint,
  onRemoveCustomer,
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
  const [deleteLoadingIndex, setDeleteLoadingIndex] = useState<number | null>(null);

  useEffect(() => {
    setLocalCustomers(customers);
  }, [customers]);

  function updateCustomer(index: number, updates: Partial<CustomerRow>) {
    setLocalCustomers((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  }

  function toggleMeetupNote(index: number) {
    setLocalCustomers((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        return {
          ...c,
          meetup_note: c.meetup_note ? undefined : DEFAULT_MEETUP_NOTE,
        };
      })
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
  const fixedStopMessage = useMemo(
    () =>
      getFixedStopPositionValidationMessage(
        localCustomers as DeliveryCustomer[]
      ),
    [localCustomers]
  );
  const effectiveSaveBlocked =
    saveBlocked || hasFailedWithoutOverride || Boolean(fixedStopMessage);
  const effectiveSaveBlockMessage =
    saveBlockMessage ??
    fixedStopMessage ??
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
        <AddSingleCustomer onParseAndAdd={onParseAndAdd} onAddStructured={onAddStructured} />
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
        <div className="text-xs text-slate-500 mb-2 space-y-1">
          {CUSTOMER_PASTE_FORMAT_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder={CUSTOMER_PASTE_PLACEHOLDER}
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
                <th className="p-3 text-left text-slate-700 font-semibold">Kapioo order IDs</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Name</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Address</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Phone</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Notes</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Meet-up</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Status</th>
                <th className="p-3 text-left text-slate-700 font-semibold">Override</th>
                <th className="p-3 text-left text-slate-700 font-semibold whitespace-nowrap min-w-[110px]">
                  Fixed Stop
                </th>
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
                      {!isSyntheticStop(c) && (
                        <button
                          type="button"
                          onClick={() => toggleMeetupNote(i)}
                          className={
                            c.meetup_note
                              ? "text-xs font-semibold px-2 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors whitespace-nowrap"
                              : "text-xs font-semibold px-2 py-1 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors whitespace-nowrap"
                          }
                          aria-pressed={Boolean(c.meetup_note)}
                          title={c.meetup_note ? "Remove meet-up marker" : "Mark this customer stop as a meet-up"}
                        >
                          {c.meetup_note ? "Meet-up ✓" : "+ Meet-up"}
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
                      {onRemoveCustomer && (
                        <button
                          type="button"
                          onClick={async () => {
                            setEditingIndex((prev) =>
                              prev === i ? null : prev !== null && prev > i ? prev - 1 : prev
                            );
                            if (overrideIndex === i) {
                              setOverrideIndex(null);
                              setOverrideInput("");
                            } else {
                              setOverrideIndex((prev) =>
                                prev !== null && prev > i ? prev - 1 : prev
                              );
                            }
                            setDeleteLoadingIndex(i);
                            try {
                              await onRemoveCustomer(i);
                            } catch (err) {
                              onError?.(err instanceof Error ? err.message : "Failed to remove customer");
                            } finally {
                              setDeleteLoadingIndex(null);
                            }
                          }}
                          disabled={deleteLoadingIndex !== null}
                          title="Remove customer from list"
                          className="text-xs font-medium px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {deleteLoadingIndex === i ? "…" : "Remove"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="p-3 align-top min-w-[140px]">
                    <span className="text-slate-600 font-mono text-xs break-all">
                      {c.order_ids?.length ? c.order_ids.join(", ") : "—"}
                    </span>
                  </td>
                  <td className="p-3 align-top">
                    {editingIndex === i ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={c.name}
                          onChange={(e) =>
                            updateCustomer(i, { name: e.target.value })
                          }
                          className="flex-1 min-w-[8rem] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Name"
                        />
                        {isSyntheticStop(c) && <HandoffBadge />}
                        {c.meetup_note && <MeetupBadge />}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-800">{c.name}</span>
                        {isSyntheticStop(c) && <HandoffBadge />}
                        {c.meetup_note && <MeetupBadge />}
                      </div>
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
                  <td className="p-3 align-top min-w-[180px]">
                    {editingIndex === i ? (
                      <div className="space-y-2">
                        {c.meetup_note && (
                          <input
                            type="text"
                            value={c.meetup_note}
                            onChange={(e) =>
                              updateCustomer(i, {
                                meetup_note: e.target.value,
                              })
                            }
                            className="w-full border border-violet-200 rounded-lg px-3 py-2 min-w-0 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                            placeholder="Meet driver name/phone..."
                          />
                        )}
                        {!c.meetup_note && (
                          <span className="text-xs text-slate-400">Use the Meet-up button on the left</span>
                        )}
                      </div>
                    ) : c.meetup_note ? (
                      <div className="space-y-2">
                        <MeetupBadge />
                        <p className="text-violet-800 text-xs font-medium">{c.meetup_note}</p>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
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
                  <td className="p-3 align-top">
                    <span className="sr-only">Fixed stop position</span>
                    <input
                      type="number"
                      min={1}
                      max={localCustomers.length}
                      step={1}
                      inputMode="numeric"
                      value={
                        c.fixed_stop_position == null ||
                        c.fixed_stop_position === undefined
                          ? ""
                          : c.fixed_stop_position
                      }
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          updateCustomer(i, { fixed_stop_position: null });
                          return;
                        }
                        const n = parseInt(raw, 10);
                        if (!Number.isNaN(n)) {
                          updateCustomer(i, { fixed_stop_position: n });
                        }
                      }}
                      className="w-full max-w-[5.5rem] border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="—"
                      aria-label={`Fixed stop position for ${c.name}`}
                    />
                    <p className="text-xs text-slate-500 mt-1 max-w-[9rem]">
                      Leave blank for flexible order
                    </p>
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
