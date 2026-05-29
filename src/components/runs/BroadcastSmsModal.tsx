"use client";

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeliveryCustomer } from "@/types/delivery-run";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import { isSyntheticStop } from "@/lib/stops/synthetic";

export const BROADCAST_SMS_MAX_CHARS = 1600;

function isSmsable(customer: DeliveryCustomer): boolean {
  if (isSyntheticStop(customer)) return false;
  return Boolean(toE164NorthAmerica(customer.phone ?? ""));
}

function defaultSelectedIndices(customers: DeliveryCustomer[]): Set<number> {
  const s = new Set<number>();
  customers.forEach((c, i) => {
    if (isSmsable(c)) s.add(i);
  });
  return s;
}

function countDistinctNumbers(
  customers: DeliveryCustomer[],
  selected: Set<number>
): number {
  const phones = new Set<string>();
  selected.forEach((i) => {
    const e = toE164NorthAmerica(customers[i]?.phone ?? "");
    if (e) phones.add(e);
  });
  return phones.size;
}

function filterCustomerIndices(
  customers: DeliveryCustomer[],
  queryLower: string
): number[] {
  if (!queryLower) {
    return customers.map((_, i) => i);
  }
  const out: number[] = [];
  customers.forEach((c, i) => {
    const blob = [c.name, c.phone, c.address].filter(Boolean).join(" ").toLowerCase();
    if (blob.includes(queryLower)) out.push(i);
  });
  return out;
}

const RecipientRow = memo(function RecipientRow({
  index,
  customer,
  selected,
  smsable,
  onToggle,
}: {
  index: number;
  customer: DeliveryCustomer;
  selected: boolean;
  smsable: boolean;
  onToggle: (customerIndex: number) => void;
}) {
  const name = (customer.name ?? "").trim() || "(no name)";
  const phone = (customer.phone ?? "").trim() || "—";
  return (
    <li className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100">
      <input
        type="checkbox"
        id={`broadcast-recipient-${index}`}
        checked={selected}
        disabled={!smsable}
        onChange={() => onToggle(index)}
        className="mt-1 size-4 shrink-0 rounded border-slate-300 text-violet-600 focus:ring-violet-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      />
      <label
        htmlFor={`broadcast-recipient-${index}`}
        className={`flex-1 min-w-0 cursor-pointer ${!smsable ? "opacity-60" : ""}`}
      >
        <div className="text-sm font-medium text-slate-900 truncate">{name}</div>
        <div className="text-xs text-slate-500 truncate tabular-nums">{phone}</div>
        {!smsable && (
          <div className="text-xs text-amber-700 mt-0.5">Cannot receive SMS · fix number</div>
        )}
      </label>
    </li>
  );
});

export function BroadcastSmsModal({
  customers,
  message,
  setMessage,
  onSend,
  onClose,
  sending,
}: {
  customers: DeliveryCustomer[];
  message: string;
  setMessage: (s: string) => void;
  onSend: (payload: {
    message: string;
    customer_indices: number[];
  }) => void | Promise<void>;
  onClose: () => void;
  sending: boolean;
}) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const [selected, setSelected] = useState<Set<number>>(() =>
    defaultSelectedIndices(customers)
  );

  const searchableCount = customers.length;
  const smsableIndices = useMemo(() => {
    const r: number[] = [];
    customers.forEach((c, i) => {
      if (isSmsable(c)) r.push(i);
    });
    return r;
  }, [customers]);

  const filteredIndices = useMemo(
    () => filterCustomerIndices(customers, deferredSearch),
    [customers, deferredSearch]
  );

  const visibleSmsableIndices = useMemo(
    () => filteredIndices.filter((i) => isSmsable(customers[i])),
    [customers, filteredIndices]
  );

  const selectedSmsableCount = useMemo(() => {
    let n = 0;
    selected.forEach((i) => {
      if (isSmsable(customers[i])) n++;
    });
    return n;
  }, [customers, selected]);

  const smsDestinations = useMemo(
    () => countDistinctNumbers(customers, selected),
    [customers, selected]
  );

  const allVisibleSelected =
    visibleSmsableIndices.length > 0 &&
    visibleSmsableIndices.every((i) => selected.has(i));

  const toggleIndex = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleSmsableIndices.forEach((i) => next.add(i));
      return next;
    });
  }, [visibleSmsableIndices]);

  const clearVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleSmsableIndices.forEach((i) => next.delete(i));
      return next;
    });
  }, [visibleSmsableIndices]);

  const selectAllSmsableOnRun = useCallback(() => {
    setSelected(new Set(smsableIndices));
  }, [smsableIndices]);

  const clearAllSelected = useCallback(() => {
    setSelected(new Set());
  }, []);

  const toggleVisibleHeader = useCallback(() => {
    if (visibleSmsableIndices.length === 0) return;
    if (allVisibleSelected) clearVisible();
    else selectAllVisible();
  }, [allVisibleSelected, clearVisible, selectAllVisible, visibleSmsableIndices]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, []);

  const trimmedLen = message.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim().length;
  const len = message.length;
  const invalidLen = len > BROADCAST_SMS_MAX_CHARS;
  const hasRecipients = smsDestinations > 0;
  const canSend = trimmedLen > 0 && !invalidLen && !sending && hasRecipients;

  async function handleSubmit() {
    const trimmed = message.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
    if (!trimmed || trimmed.length > BROADCAST_SMS_MAX_CHARS || !hasRecipients) return;
    const indices: number[] = [];
    const seen = new Set<number>();
    selected.forEach((i) => {
      if (seen.has(i) || !Number.isInteger(i) || i < 0 || i >= customers.length) return;
      if (!isSmsable(customers[i])) return;
      seen.add(i);
      indices.push(i);
    });
    indices.sort((a, b) => a - b);
    if (indices.length === 0) return;
    await onSend({ message: trimmed, customer_indices: indices });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] isolate flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!sending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="broadcast-sms-title"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[10000]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 shrink-0">
          <h2 id="broadcast-sms-title" className="text-xl font-bold text-slate-900">
            Send Broadcast SMS
          </h2>
          <p className="text-slate-600 text-sm mt-1">
            Choose who receives this message. One SMS per phone number (duplicates in your
            selection are merged). Search by name, phone, or address.
          </p>
        </div>

        <div className="px-5 sm:px-6 pt-4 pb-2 shrink-0 space-y-3 border-b border-slate-100">
          <div className="relative">
            <span className="sr-only" id="broadcast-search-label">
              Search customers
            </span>
            <input
              ref={searchInputRef}
              type="search"
              id="broadcast-customer-search"
              aria-labelledby="broadcast-search-label"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, address…"
              disabled={sending}
              autoComplete="off"
              className="w-full border border-slate-200 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
            />
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"
              aria-hidden
            >
              🔍
            </span>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                disabled={sending}
                className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 text-sm"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>
              {filteredIndices.length} of {searchableCount} shown
              {deferredSearch ? ` · matching “${search.trim()}”` : ""}
            </span>
            <span className="font-medium text-violet-800">
              {selectedSmsableCount} selected · {smsDestinations} message
              {smsDestinations !== 1 ? "s" : ""} will be sent
            </span>
          </div>

          {smsableIndices.length === 0 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No customers have a valid phone number for SMS.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                disabled={sending || smsableIndices.length === 0}
                onClick={selectAllSmsableOnRun}
                className="text-sm font-medium text-violet-700 hover:text-violet-900 disabled:opacity-40"
              >
                All on run
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={clearAllSelected}
                className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40"
              >
                None
              </button>
              <span className="text-slate-300 hidden sm:inline" aria-hidden>
                |
              </span>
              <button
                type="button"
                disabled={sending || visibleSmsableIndices.length === 0}
                onClick={toggleVisibleHeader}
                className="text-sm font-medium text-slate-700 hover:text-slate-900 disabled:opacity-40"
              >
                {allVisibleSelected ? "Unselect view" : "Select view"}
              </button>
            </div>
          )}

          <ul
            role="list"
            className="max-h-[min(220px,40vh)] overflow-y-auto overscroll-contain border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/50"
          >
            {filteredIndices.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-slate-500">No matches.</li>
            ) : (
              filteredIndices.map((i) => (
                <RecipientRow
                  key={i}
                  index={i}
                  customer={customers[i]}
                  selected={selected.has(i)}
                  smsable={isSmsable(customers[i])}
                  onToggle={toggleIndex}
                />
              ))
            )}
          </ul>
        </div>

        <div className="p-5 sm:px-6 overflow-y-auto flex-1 min-h-0">
          <label htmlFor="broadcast-sms-body" className="block text-sm font-medium text-slate-700 mb-1.5">
            Message
          </label>
          <textarea
            id="broadcast-sms-body"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message…"
            maxLength={BROADCAST_SMS_MAX_CHARS}
            rows={5}
            disabled={sending}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60 resize-y min-h-[120px]"
          />
          <div className="flex justify-between items-center mt-2 text-xs text-slate-500">
            <span>
              {!hasRecipients && smsableIndices.length > 0 ? (
                <span className="text-amber-700 font-medium">Select at least one recipient.</span>
              ) : (
                <span>Max {BROADCAST_SMS_MAX_CHARS} characters.</span>
              )}
            </span>
            <span className={invalidLen ? "text-red-600 font-semibold" : "text-slate-600"}>
              {len} / {BROADCAST_SMS_MAX_CHARS}
            </span>
          </div>
        </div>

        <div className="p-5 sm:p-6 border-t border-slate-200 flex flex-col-reverse sm:flex-row justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="min-h-[44px] px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSend}
            className="min-h-[44px] px-5 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
