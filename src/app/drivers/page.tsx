"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Driver {
  _id: string;
  display_name: string;
  aliases: string[];
  hourly_rate: number;
  fuel_rate_per_km: number;
  start_date: string;
  deposit_weeks: number;
  payout_cadence_weeks: number;
  currency: string;
  active: boolean;
  notes?: string;
}

const EMPTY_FORM = {
  display_name: "",
  hourly_rate: "",
  fuel_rate_per_km: "0",
  start_date: "",
  deposit_weeks: "0",
  payout_cadence_weeks: "2",
  currency: "CAD",
  notes: "",
  extra_aliases: "",
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadDrivers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/drivers${showInactive ? "?include_inactive=true" : ""}`);
      if (!res.ok) throw new Error(await res.text());
      setDrivers(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load drivers");
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError(null);
    setShowForm(true);
  }

  function openEdit(driver: Driver) {
    setEditingId(driver._id);
    setForm({
      display_name: driver.display_name,
      hourly_rate: String(driver.hourly_rate),
      fuel_rate_per_km: String(driver.fuel_rate_per_km),
      start_date: driver.start_date,
      deposit_weeks: String(driver.deposit_weeks),
      payout_cadence_weeks: String(driver.payout_cadence_weeks),
      currency: driver.currency,
      notes: driver.notes ?? "",
      extra_aliases: driver.aliases.filter(a => a !== driver.display_name.toLowerCase().trim()).join(", "),
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        display_name: form.display_name.trim(),
        hourly_rate: parseFloat(form.hourly_rate),
        fuel_rate_per_km: parseFloat(form.fuel_rate_per_km || "0"),
        start_date: form.start_date,
        deposit_weeks: parseInt(form.deposit_weeks || "0", 10),
        payout_cadence_weeks: parseInt(form.payout_cadence_weeks || "2", 10),
        currency: form.currency,
        notes: form.notes.trim() || undefined,
        extra_aliases: form.extra_aliases
          ? form.extra_aliases.split(",").map(s => s.trim()).filter(Boolean)
          : [],
      };

      const url = editingId ? `/api/drivers/${editingId}` : "/api/drivers";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error ?? "Save failed");
      }
      setShowForm(false);
      await loadDrivers();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!confirm("Deactivate this driver? Payment history is preserved.")) return;
    await fetch(`/api/drivers/${id}`, { method: "DELETE" });
    await loadDrivers();
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link href="/dashboard" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
          ← Dashboard
        </Link>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Driver Pay Profiles</h1>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button
          onClick={openCreate}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: "pointer", fontWeight: 600 }}
        >
          + Add Driver
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <Link href="/driver-payments" style={{ marginLeft: "auto", color: "#2563eb", textDecoration: "none", fontSize: 14, alignSelf: "center" }}>
          View Payment Reports →
        </Link>
      </div>

      {loading && <p style={{ color: "#6b7280" }}>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {!loading && drivers.length === 0 && (
        <div style={{ textAlign: "center", padding: 48, color: "#6b7280", border: "1px dashed #d1d5db", borderRadius: 8 }}>
          No driver profiles yet. Add one to start tracking payments.
        </div>
      )}

      {!loading && drivers.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "2px solid #e5e7eb" }}>
                {["Driver", "Hourly Rate", "Fuel $/km", "Start Date", "Deposit Wks", "Pay Cadence", "Status", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d._id} style={{ borderBottom: "1px solid #f3f4f6", opacity: d.active ? 1 : 0.5 }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                    {d.display_name}
                    {d.aliases.length > 1 && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                        aliases: {d.aliases.filter(a => a !== d.display_name.toLowerCase()).join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>${d.hourly_rate}/hr</td>
                  <td style={{ padding: "10px 12px" }}>{d.fuel_rate_per_km > 0 ? `$${d.fuel_rate_per_km}` : "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{d.start_date}</td>
                  <td style={{ padding: "10px 12px" }}>{d.deposit_weeks}</td>
                  <td style={{ padding: "10px 12px" }}>Every {d.payout_cadence_weeks} wk(s)</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ background: d.active ? "#dcfce7" : "#f3f4f6", color: d.active ? "#166534" : "#6b7280", padding: "2px 8px", borderRadius: 12, fontSize: 12 }}>
                      {d.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button onClick={() => openEdit(d)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 10px", cursor: "pointer", marginRight: 6, fontSize: 13 }}>
                      Edit
                    </button>
                    {d.active && (
                      <button onClick={() => handleDeactivate(d._id)} style={{ background: "none", border: "1px solid #f87171", color: "#dc2626", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>
              {editingId ? "Edit Driver" : "Add Driver"}
            </h2>
            <form onSubmit={handleSubmit}>
              {[
                { label: "Display Name *", key: "display_name", type: "text", required: true },
                { label: "Hourly Rate ($) *", key: "hourly_rate", type: "number", required: true, step: "0.01", min: "0" },
                { label: "Fuel Rate ($/km, 0 = none)", key: "fuel_rate_per_km", type: "number", step: "0.01", min: "0" },
                { label: "Start Date (YYYY-MM-DD) *", key: "start_date", type: "date", required: true },
                { label: "Deposit Weeks (0 = none)", key: "deposit_weeks", type: "number", min: "0" },
                { label: "Pay Cadence (weeks)", key: "payout_cadence_weeks", type: "number", min: "1" },
                { label: "Currency", key: "currency", type: "text" },
                { label: "Notes", key: "notes", type: "text" },
                { label: "Extra Aliases (comma-separated)", key: "extra_aliases", type: "text" },
              ].map(({ label, key, type, required, step, min }) => (
                <div key={key} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{label}</label>
                  <input
                    type={type}
                    required={required}
                    step={step}
                    min={min}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 14, boxSizing: "border-box" }}
                  />
                </div>
              ))}
              {saveError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{saveError}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button type="submit" disabled={saving} style={{ flex: 1, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "10px 0", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 6, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
