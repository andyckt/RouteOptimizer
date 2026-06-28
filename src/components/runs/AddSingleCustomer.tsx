"use client";

import { useState } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { parseOrderIdsFromText } from "@/lib/parsing/order-ids-input";

interface AddSingleCustomerProps {
  /** For Create page: add customer to local state (geocode_status: pending) */
  onAdd?: (c: DeliveryCustomer) => void;
  /** For Edit page: add a structured customer/stop without going through paste parsing. */
  onAddStructured?: (c: DeliveryCustomer) => Promise<void>;
  /** For Edit page: call parse-and-add API with constructed line */
  onParseAndAdd?: (text: string) => Promise<void>;
}

export function AddSingleCustomer({
  onAdd,
  onAddStructured,
  onParseAndAdd,
}: AddSingleCustomerProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [orderIdsText, setOrderIdsText] = useState("");
  const [isMeetupPoint, setIsMeetupPoint] = useState(false);
  const [addressCoords, setAddressCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setName("");
    setPhone("");
    setAddress("");
    setNotes("");
    setOrderIdsText("");
    setIsMeetupPoint(false);
    setAddressCoords(null);
  }

  async function handleAdd() {
    const nameTrimmed = name.trim();
    const addressTrimmed = address.trim();
    if (!nameTrimmed || !addressTrimmed) return;
    const order_ids = isMeetupPoint ? undefined : parseOrderIdsFromText(orderIdsText);
    const hasCoords =
      addressCoords &&
      typeof addressCoords.lat === "number" &&
      typeof addressCoords.lng === "number";
    const structuredCustomer: DeliveryCustomer = {
      name: nameTrimmed,
      phone: phone.replace(/\D/g, ""),
      address: addressTrimmed,
      notes: notes.trim() || undefined,
      is_first_stop: false,
      is_end_point: false,
      geocode_status: hasCoords ? "success" : "pending",
      ...(hasCoords ? { lat: addressCoords!.lat, lng: addressCoords!.lng } : {}),
      ...(order_ids ? { order_ids } : {}),
      ...(isMeetupPoint
        ? {
            is_synthetic: true,
            stop_type: "handoff" as const,
          }
        : {}),
    };

    if (onAdd) {
      onAdd(structuredCustomer);
      resetForm();
      return;
    }

    if (isMeetupPoint && onAddStructured) {
      setLoading(true);
      try {
        await onAddStructured(structuredCustomer);
        resetForm();
      } finally {
        setLoading(false);
      }
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
        <label className="flex items-start gap-3 p-3 rounded-xl border border-violet-200 bg-violet-50 text-sm">
          <input
            type="checkbox"
            checked={isMeetupPoint}
            onChange={(e) => {
              setIsMeetupPoint(e.target.checked);
              if (e.target.checked) setOrderIdsText("");
            }}
            className="mt-1"
          />
          <span>
            <span className="font-semibold text-violet-900">
              This is a meet-up point, not a customer delivery
            </span>
            <span className="block text-violet-800/80">
              The stop will be highlighted for the driver and excluded from labels, SMS, and Kapioo sync.
            </span>
          </span>
        </label>
      </div>
      {!isMeetupPoint && (
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
      )}
      <div>
        <label className={labelClass}>{isMeetupPoint ? "Meet-up Name *" : "Customer Name *"}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isMeetupPoint ? "e.g. Meet driver Ben" : "Customer name"}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>
          Phone Number <span className="text-slate-500 font-normal">{isMeetupPoint ? "(optional)" : ""}</span>
        </label>
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1234567890"
          className={inputClass}
        />
      </div>
      <div className="md:col-span-2">
        <label className={labelClass}>{isMeetupPoint ? "Meet-up Address *" : "Delivery Address *"}</label>
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
          placeholder={isMeetupPoint ? "Start typing meet-up address..." : "Start typing address..."}
          className={inputClass}
        />
      </div>
      <div className="md:col-span-2">
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            isMeetupPoint
              ? "Driver name, phone number, meet-up instructions..."
              : "Buzz code, delivery instructions, etc."
          }
          className={`${inputClass} resize-none`}
          rows={2}
        />
      </div>
      <div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={
            loading || !name.trim() || !address.trim() || (!onAdd && !onAddStructured && !onParseAndAdd)
          }
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2 font-medium transition-colors"
        >
          <span>+</span>
          {loading ? "Adding…" : isMeetupPoint ? "Add Meet-up Point" : "Add Customer to Route"}
        </button>
      </div>
    </div>
  );
}
