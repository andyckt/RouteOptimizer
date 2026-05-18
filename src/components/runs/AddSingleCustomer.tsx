"use client";

import { useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { parseOrderIdsFromText } from "@/lib/parsing/order-ids-input";

interface AddSingleCustomerProps {
  /** For Create page: add customer to local state (geocode_status: pending) */
  onAdd?: (c: DeliveryCustomer) => void;
  /** For Edit page: call parse-and-add API with constructed line */
  onParseAndAdd?: (text: string) => Promise<void>;
}

export function AddSingleCustomer({
  onAdd,
  onParseAndAdd,
}: AddSingleCustomerProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [orderIdsText, setOrderIdsText] = useState("");
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setName("");
    setPhone("");
    setAddress("");
    setNotes("");
    setOrderIdsText("");
    setAddressCoords(null);
  }

  async function handleAdd() {
    const nameTrimmed = name.trim();
    const addressTrimmed = address.trim();
    if (!nameTrimmed || !addressTrimmed) return;
    const order_ids = parseOrderIdsFromText(orderIdsText);

    if (onAdd) {
      const hasCoords =
        addressCoords &&
        typeof addressCoords.lat === "number" &&
        typeof addressCoords.lng === "number";
      onAdd({
        name: nameTrimmed,
        phone: phone.replace(/\D/g, ""),
        address: addressTrimmed,
        notes: notes.trim() || undefined,
        is_first_stop: false,
        is_end_point: false,
        geocode_status: hasCoords ? "success" : "pending",
        ...(hasCoords ? { lat: addressCoords!.lat, lng: addressCoords!.lng } : {}),
        ...(order_ids ? { order_ids } : {}),
      });
      resetForm();
      return;
    }

    if (onParseAndAdd) {
      setLoading(true);
      try {
        const addressWithNote = notes.trim()
          ? `${addressTrimmed} (${notes.trim()})`
          : addressTrimmed;
        const parts: string[] = [];
        if (order_ids?.length) parts.push(order_ids.join(", "));
        parts.push(nameTrimmed, addressWithNote, phone.replace(/\D/g, ""));
        await onParseAndAdd(parts.join("\t"));
        resetForm();
      } finally {
        setLoading(false);
      }
    }
  }

  const inputClass =
    "w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
      <div className="md:col-span-2">
        <label htmlFor="kapioo-order-ids" className={labelClass}>
          Kapioo order IDs <span className="text-slate-500 font-normal">(optional)</span>
        </label>
        <input
          id="kapioo-order-ids"
          type="text"
          value={orderIdsText}
          onChange={(e) => setOrderIdsText(e.target.value)}
          placeholder="e.g. ORD-1001 or ORD-1001, ORD-1002"
          className={`${inputClass} font-mono text-sm`}
        />
        <p className="text-xs text-slate-500 mt-1">
          First column when pasting. Copied onto each stop when you optimize; edit on run details
          later. Leave blank for non-Kapioo deliveries.
        </p>
      </div>
      <div>
        <label className={labelClass}>Customer Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer name"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Phone Number *</label>
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1234567890"
          className={inputClass}
        />
      </div>
      <div className="md:col-span-2">
        <label className={labelClass}>Delivery Address *</label>
        <AddressAutocomplete
          value={address}
          onChange={(v) => {
            setAddress(v);
            setAddressCoords(null);
          }}
          onSelectDetails={(d) => {
            setAddress(d.address);
            setAddressCoords({ lat: d.lat, lng: d.lng });
          }}
          placeholder="Start typing address..."
          className={inputClass}
        />
      </div>
      <div className="md:col-span-2">
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Buzz code, delivery instructions, etc."
          className={`${inputClass} resize-none`}
          rows={2}
        />
      </div>
      <div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={
            loading || !name.trim() || !address.trim() || (!onAdd && !onParseAndAdd)
          }
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors"
        >
          <span>+</span>
          {loading ? "Adding…" : "Add Customer to Route"}
        </button>
      </div>
    </div>
  );
}
