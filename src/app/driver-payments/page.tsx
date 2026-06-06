"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface PaymentRecord {
  _id: string;
  run_id: string;
  driver_name_raw: string;
  run_date: string;
  completed_at?: string | null;
  hours_actual?: number | null;
  hours_override?: number | null;
  override_reason?: string;
  hours_effective: number;
  total_distance_km: number;
  billable_distance_km: number;
  hourly_rate_snapshot: number;
  fuel_rate_snapshot: number;
  subtotal_labor: number;
  fuel_amount: number;
  total: number;
  pay_week_index: number;
  is_deposit_week: boolean;
  status: string;
}

interface WeekRollup {
  week_index: number;
  is_deposit: boolean;
  total: number;
  records: PaymentRecord[];
}

interface PayoutPeriod {
  label: string;
  weeks: WeekRollup[];
  total: number;
  is_held: boolean;
}

interface DriverRollup {
  driver_id: string;
  driver_name: string;
  held_balance: number;
  payout_periods: PayoutPeriod[];
}

interface UnassignedGroup {
  driver_name_raw: string;
  count: number;
  records: PaymentRecord[];
}

interface Driver {
  _id: string;
  display_name: string;
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  computed: { bg: "#dcfce7", text: "#166534" },
  pending_rate: { bg: "#fef9c3", text: "#854d0e" },
  needs_review: { bg: "#fee2e2", text: "#991b1b" },
};

export default function DriverPaymentsPage() {
  const [rollups, setRollups] = useState<DriverRollup[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeDriverId, setActiveDriverId] = useState<string | null>(null);
  const [overrideRecord, setOverrideRecord] = useState<PaymentRecord | null>(null);
  const [overrideHours, setOverrideHours] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [assigningName, setAssigningName] = useState<string | null>(null);
  const [assignDriverId, setAssignDriverId] = useState("");
  const [backfillStartDate, setBackfillStartDate] = useState("");
  const [backfillEndDate, setBackfillEndDate] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [paymentsRes, unassignedRes, driversRes] = await Promise.all([
        fetch("/api/driver-payments"),
        fetch("/api/driver-payments/unassigned"),
        fetch("/api/drivers"),
      ]);
      if (!paymentsRes.ok) throw new Error(await paymentsRes.text());
      const { rollups: r } = await paymentsRes.json();
      setRollups(r);
      setUnassigned(await unassignedRes.json());
      setDrivers(await driversRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSync(driverId?: string) {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const url = `/api/driver-payments/sync${driverId ? `?driver_id=${driverId}` : ""}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (data.status === "disabled") {
        setSyncMsg("Google Sheets not configured (GOOGLE_SHEETS_PAYROLL_SPREADSHEET_ID missing). Records are stored in the DB.");
      } else {
        setSyncMsg(`Sync complete — rebuilt: ${data.rebuilt?.join(", ") ?? "all drivers"}`);
        await load();
      }
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function submitOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!overrideRecord) return;
    setOverrideSaving(true);
    setOverrideError(null);
    try {
      const res = await fetch(`/api/driver-payments/${overrideRecord._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hours_override: parseFloat(overrideHours),
          override_reason: overrideReason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown" }));
        throw new Error(err.error ?? "Save failed");
      }
      setOverrideRecord(null);
      await load();
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setOverrideSaving(false);
    }
  }

  async function handleAssign(rawName: string) {
    if (!assignDriverId) return;
    await fetch("/api/driver-payments/unassigned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driver_name_raw: rawName, driver_id: assignDriverId }),
    });
    setAssigningName(null);
    setAssignDriverId("");
    await load();
  }

  async function handleBackfill() {
    if (!backfillStartDate || !backfillEndDate) {
      setBackfillMsg("Both start and end dates are required");
      return;
    }
    setBackfilling(true);
    setBackfillMsg(null);
    try {
      const res = await fetch(`/api/driver-payments/backfill?start_date=${backfillStartDate}&end_date=${backfillEndDate}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setBackfillMsg(`Error: ${data.error ?? "Backfill failed"}`);
      } else {
        setBackfillMsg(`Backfill complete: ${data.processed} run(s) processed (${data.failed} failed). Click "Rebuild All Sheets" to sync.`);
        await load();
      }
    } catch (e) {
      setBackfillMsg(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  const activeRollup = rollups.find(r => r.driver_id === activeDriverId) ?? rollups[0] ?? null;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <Link href="/dashboard" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>← Dashboard</Link>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Driver Payment Reports</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/drivers" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14, alignSelf: "center" }}>Manage Drivers</Link>
          <button
            onClick={() => handleSync(activeDriverId ?? undefined)}
            disabled={syncing}
            style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", cursor: syncing ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13 }}
          >
            {syncing ? "Syncing…" : activeDriverId ? "Rebuild Sheet" : "Rebuild All Sheets"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {syncMsg}
        </div>
      )}

      {/* Backfill section */}
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#1e40af" }}>Backfill Payment Records from Old Runs</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "#374151" }}>
            Start date:
            <input
              type="date"
              value={backfillStartDate}
              onChange={e => setBackfillStartDate(e.target.value)}
              style={{ marginLeft: 6, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px", fontSize: 13 }}
            />
          </label>
          <label style={{ fontSize: 13, color: "#374151" }}>
            End date:
            <input
              type="date"
              value={backfillEndDate}
              onChange={e => setBackfillEndDate(e.target.value)}
              style={{ marginLeft: 6, border: "1px solid #d1d5db", borderRadius: 4, padding: "5px 8px", fontSize: 13 }}
            />
          </label>
          <button
            onClick={handleBackfill}
            disabled={backfilling || !backfillStartDate || !backfillEndDate}
            style={{
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              padding: "7px 16px",
              cursor: backfilling || !backfillStartDate || !backfillEndDate ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: 13,
              opacity: backfilling || !backfillStartDate || !backfillEndDate ? 0.6 : 1,
            }}
          >
            {backfilling ? "Backfilling…" : "Backfill Payments"}
          </button>
        </div>
        {backfillMsg && (
          <div style={{ marginTop: 10, fontSize: 13, color: backfillMsg.startsWith("Error") ? "#dc2626" : "#166534" }}>
            {backfillMsg}
          </div>
        )}
      </div>

      {loading && <p style={{ color: "#6b7280" }}>Loading…</p>}
      {error && <p style={{ color: "#dc2626" }}>{error}</p>}

      {!loading && (
        <div style={{ display: "flex", gap: 20 }}>
          {/* Driver sidebar */}
          <div style={{ width: 200, flexShrink: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#6b7280", marginBottom: 8 }}>DRIVERS</div>
            {rollups.map(r => (
              <button
                key={r.driver_id}
                onClick={() => setActiveDriverId(r.driver_id)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                  background: activeDriverId === r.driver_id || (!activeDriverId && r === rollups[0]) ? "#eff6ff" : "transparent",
                  border: "1px solid",
                  borderColor: activeDriverId === r.driver_id || (!activeDriverId && r === rollups[0]) ? "#bfdbfe" : "transparent",
                  borderRadius: 6, cursor: "pointer", marginBottom: 4, fontWeight: 500, fontSize: 14
                }}
              >
                {r.driver_name}
                {r.held_balance > 0 && (
                  <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>Held: ${r.held_balance.toFixed(2)}</div>
                )}
              </button>
            ))}
            {rollups.length === 0 && (
              <p style={{ color: "#9ca3af", fontSize: 13 }}>No payment records yet.</p>
            )}
          </div>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeRollup && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{activeRollup.driver_name}</h2>
                  {activeRollup.held_balance > 0 && (
                    <span style={{ background: "#fee2e2", color: "#991b1b", padding: "3px 10px", borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                      Held deposit: ${activeRollup.held_balance.toFixed(2)}
                    </span>
                  )}
                </div>

                {activeRollup.payout_periods.map((period, pi) => (
                  <div key={pi} style={{ marginBottom: 24 }}>
                    <div style={{
                      background: period.is_held ? "#fef9c3" : "#f0fdf4",
                      border: `1px solid ${period.is_held ? "#fde68a" : "#bbf7d0"}`,
                      borderRadius: 8, overflow: "hidden"
                    }}>
                      <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${period.is_held ? "#fde68a" : "#bbf7d0"}` }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>
                          {period.label}
                          {period.is_held && <span style={{ fontSize: 12, marginLeft: 8, color: "#92400e" }}>(deposit held)</span>}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>${period.total.toFixed(2)}</span>
                      </div>

                      {period.weeks.map((wk, wi) => (
                        <div key={wi}>
                          <div style={{ padding: "6px 14px", background: "rgba(0,0,0,0.03)", fontSize: 12, fontWeight: 600, color: "#6b7280" }}>
                            Week {wk.week_index + 1}
                          </div>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                                {["Date", "Time (hrs)", "Rate", "Subtotal", "Distance", "Fuel", "Total", "Status", ""].map(h => (
                                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", color: "#374151" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {wk.records.map(rec => {
                                const sc = STATUS_COLOR[rec.status] ?? { bg: "#f3f4f6", text: "#374151" };
                                return (
                                  <tr key={rec._id} style={{ borderTop: "1px solid #f3f4f6" }}>
                                    <td style={{ padding: "6px 10px" }}>{rec.run_date}</td>
                                    <td style={{ padding: "6px 10px" }}>
                                      {rec.hours_effective.toFixed(4)}
                                      {rec.hours_override !== null && rec.hours_override !== undefined && (
                                        <span title={`Override: ${rec.override_reason ?? ""}`} style={{ marginLeft: 4, fontSize: 11, color: "#2563eb" }}>✏</span>
                                      )}
                                    </td>
                                    <td style={{ padding: "6px 10px" }}>${rec.hourly_rate_snapshot}/hr</td>
                                    <td style={{ padding: "6px 10px" }}>${rec.subtotal_labor.toFixed(2)}</td>
                                    <td style={{ padding: "6px 10px" }}>{rec.total_distance_km.toFixed(1)} km</td>
                                    <td style={{ padding: "6px 10px" }}>${rec.fuel_amount.toFixed(2)}</td>
                                    <td style={{ padding: "6px 10px", fontWeight: 600 }}>${rec.total.toFixed(2)}</td>
                                    <td style={{ padding: "6px 10px" }}>
                                      <span style={{ background: sc.bg, color: sc.text, padding: "2px 7px", borderRadius: 10, fontSize: 11 }}>
                                        {rec.status}
                                      </span>
                                    </td>
                                    <td style={{ padding: "6px 10px" }}>
                                      <button
                                        onClick={() => {
                                          setOverrideRecord(rec);
                                          setOverrideHours(String(rec.hours_override ?? rec.hours_effective));
                                          setOverrideReason(rec.override_reason ?? "");
                                          setOverrideError(null);
                                        }}
                                        style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12 }}
                                      >
                                        Override Hours
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Unassigned bucket */}
            {unassigned.length > 0 && (
              <div style={{ marginTop: 32, border: "1px solid #fde68a", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ background: "#fffbeb", padding: "10px 14px", borderBottom: "1px solid #fde68a", fontWeight: 700, fontSize: 15 }}>
                  Unassigned Runs ({unassigned.reduce((s, g) => s + g.count, 0)})
                  <span style={{ fontSize: 12, color: "#92400e", marginLeft: 8, fontWeight: 400 }}>No driver profile matched these names</span>
                </div>
                {unassigned.map(group => (
                  <div key={group.driver_name_raw} style={{ padding: "10px 14px", borderBottom: "1px solid #fef3c7" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{group.driver_name_raw}</span>
                      <span style={{ color: "#6b7280", fontSize: 13 }}>{group.count} run(s)</span>
                      {assigningName === group.driver_name_raw ? (
                        <>
                          <select
                            value={assignDriverId}
                            onChange={e => setAssignDriverId(e.target.value)}
                            style={{ border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 8px", fontSize: 13 }}
                          >
                            <option value="">— Select driver —</option>
                            {drivers.map(d => <option key={d._id} value={d._id}>{d.display_name}</option>)}
                          </select>
                          <button
                            onClick={() => handleAssign(group.driver_name_raw)}
                            disabled={!assignDriverId}
                            style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}
                          >
                            Assign
                          </button>
                          <button onClick={() => { setAssigningName(null); setAssignDriverId(""); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6b7280" }}>Cancel</button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setAssigningName(group.driver_name_raw); setAssignDriverId(""); }}
                          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}
                        >
                          Assign to Driver
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Override modal */}
      {overrideRecord && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 28, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>Override Hours</h2>
            <p style={{ margin: "0 0 18px", color: "#6b7280", fontSize: 13 }}>
              {overrideRecord.run_date} · {overrideRecord.driver_name_raw}<br />
              Actual: {overrideRecord.hours_actual !== null && overrideRecord.hours_actual !== undefined ? overrideRecord.hours_actual.toFixed(4) : "unavailable"} hrs
            </p>
            <form onSubmit={submitOverride}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Override Hours *</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                required
                value={overrideHours}
                onChange={e => setOverrideHours(e.target.value)}
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 14, marginBottom: 14, boxSizing: "border-box" }}
              />
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Reason (optional)</label>
              <input
                type="text"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                placeholder="e.g. long break, admin correction"
                style={{ width: "100%", border: "1px solid #d1d5db", borderRadius: 6, padding: "7px 10px", fontSize: 14, marginBottom: 14, boxSizing: "border-box" }}
              />
              {overrideError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{overrideError}</p>}
              <div style={{ display: "flex", gap: 10 }}>
                <button type="submit" disabled={overrideSaving} style={{ flex: 1, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, padding: "10px 0", fontWeight: 600, cursor: overrideSaving ? "not-allowed" : "pointer" }}>
                  {overrideSaving ? "Saving…" : "Save Override"}
                </button>
                <button type="button" onClick={() => setOverrideRecord(null)} style={{ flex: 1, background: "#f3f4f6", border: "none", borderRadius: 6, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}>
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
