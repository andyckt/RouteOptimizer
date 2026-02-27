"use client";

import { useState, useEffect } from "react";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

export interface RunFormData {
  run_date: string;
  driver_name: string;
  start_location: string;
  end_location?: string;
  start_time: string;
  travel_mode: "driving" | "ebike";
}

interface SavedLocation {
  _id: string;
  address: string;
  label?: string;
}

interface RunFormProps {
  initial?: RunFormData;
  value?: RunFormData;
  onChange?: (data: RunFormData) => void;
  onSubmit?: (data: RunFormData) => Promise<void>;
  submitLabel?: string;
  showSubmit?: boolean;
}

export function RunForm({
  initial,
  value,
  onChange,
  onSubmit,
  submitLabel = "Save",
  showSubmit = true,
}: RunFormProps) {
  const [run_date, setRunDate] = useState(value?.run_date ?? initial?.run_date ?? "");
  const [driver_name, setDriverName] = useState(value?.driver_name ?? initial?.driver_name ?? "");
  const [start_location, setStartLocation] = useState(
    value?.start_location ?? initial?.start_location ?? ""
  );
  const [end_location, setEndLocation] = useState(
    value?.end_location ?? initial?.end_location ?? ""
  );
  const [start_time, setStartTime] = useState(value?.start_time ?? initial?.start_time ?? "09:00");
  const [travel_mode, setTravelMode] = useState<"driving" | "ebike">(
    value?.travel_mode ?? initial?.travel_mode ?? "driving"
  );
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [savingLocation, setSavingLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved-locations")
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) return;
        if (Array.isArray(data)) setSavedLocations(data);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        run_date,
        driver_name,
        start_location,
        end_location: end_location || undefined,
        start_time,
        travel_mode,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  const runDate = value?.run_date ?? run_date;
  const driverName = value?.driver_name ?? driver_name;
  const startLocation = value?.start_location ?? start_location;
  const endLocation = value?.end_location ?? end_location;
  const startTime = value?.start_time ?? start_time;
  const travelMode = value?.travel_mode ?? travel_mode;

  const setRunDateValue = (v: string) => {
    setRunDate(v);
    if (value) onChange?.({ ...value, run_date: v });
  };
  const setDriverNameValue = (v: string) => {
    setDriverName(v);
    if (value) onChange?.({ ...value, driver_name: v });
  };
  const setStartLocationValue = (v: string) => {
    setStartLocation(v);
    if (value) onChange?.({ ...value, start_location: v });
  };
  const setEndLocationValue = (v: string) => {
    setEndLocation(v);
    if (value) onChange?.({ ...value, end_location: v });
  };
  const setStartTimeValue = (v: string) => {
    setStartTime(v);
    if (value) onChange?.({ ...value, start_time: v });
  };
  const setTravelModeValue = (v: "driving" | "ebike") => {
    setTravelMode(v);
    if (value) onChange?.({ ...value, travel_mode: v });
  };

  const inputClass =
    "w-full border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
  const labelClass = "block text-sm font-medium text-slate-700 mb-1";
  const helperClass = "text-xs text-slate-500 mb-1";

  const content = (
    <div className="space-y-4 max-w-xl">
      <div>
        <label className={labelClass}>Delivery Date *</label>
        <input
          type="date"
          value={runDate}
          onChange={(e) => setRunDateValue(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>Start Time *</label>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTimeValue(e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>Driver Name *</label>
        <input
          type="text"
          value={driverName}
          onChange={(e) => setDriverNameValue(e.target.value)}
          placeholder="e.g., John Smith"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Travel Mode *</label>
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setTravelModeValue("driving")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              travelMode === "driving"
                ? "bg-blue-600 text-white"
                : "hover:bg-slate-200 text-slate-700"
            }`}
          >
            <span aria-hidden>🚗</span> Driving
          </button>
          <button
            type="button"
            onClick={() => setTravelModeValue("ebike")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              travelMode === "ebike"
                ? "bg-blue-600 text-white"
                : "hover:bg-slate-200 text-slate-700"
            }`}
          >
            <span aria-hidden>🚴</span> E-Bike
          </button>
        </div>
      </div>
      <div>
        <label className={labelClass}>Start Location *</label>
        {savedLocations.length > 0 && (
          <div className="mb-2">
            <p className={helperClass}>Quick Select (Saved Locations):</p>
            <div className="flex flex-wrap gap-2">
              {savedLocations.map((loc) => (
                <button
                  key={loc._id}
                  type="button"
                  onClick={() => setStartLocationValue(loc.address)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    startLocation === loc.address
                      ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                      : "bg-white border-slate-300 hover:border-slate-400"
                  }`}
                >
                  {loc.label || loc.address}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className={helperClass}>Or type a new address:</p>
        <div className="flex gap-2">
          <AddressAutocomplete
            value={startLocation}
            onChange={setStartLocationValue}
            placeholder="Start typing address..."
            className={`flex-1 ${inputClass}`}
          />
          {startLocation.trim() &&
            !savedLocations.some((l) => l.address === startLocation.trim()) && (
              <button
                type="button"
                onClick={async () => {
                  if (!startLocation.trim()) return;
                  setSavingLocation(true);
                  try {
                    const res = await fetch("/api/saved-locations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ address: startLocation.trim() }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setSavedLocations((prev) => [...prev, data]);
                    }
                  } finally {
                    setSavingLocation(false);
                  }
                }}
                disabled={savingLocation}
                className="px-3 py-2.5 text-sm border border-slate-200 rounded-xl hover:bg-slate-50 whitespace-nowrap disabled:opacity-50"
              >
                {savingLocation ? "Saving…" : "Save as quick-select"}
              </button>
            )}
        </div>
      </div>
      <div>
        <label className={labelClass}>End Location (Optional)</label>
        <p className={helperClass}>
          If specified, the route will end at this location after all deliveries.
        </p>
        <AddressAutocomplete
          value={endLocation}
          onChange={setEndLocationValue}
          placeholder="e.g., 456 Queen St, Toronto, ON (leave empty if no end point)"
          className={inputClass}
        />
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {showSubmit && onSubmit && (
        <button
          type="submit"
          disabled={submitting}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      )}
    </div>
  );

  if (onSubmit && showSubmit) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(e);
        }}
      >
        {content}
      </form>
    );
  }
  return content;
}
