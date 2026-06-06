/**
 * Google Sheets payroll mirror.
 * Best-effort: never throws into callers. Records sheet_sync status on each record.
 *
 * Full rewrite strategy (idempotent): on each rebuild, clear the driver's tab
 * and rewrite all rows from the DB records. No duplicate rows possible.
 */

import { getSheetsConfig, parseServiceAccount } from "@/lib/sheets/client";
import { connectDB } from "@/lib/mongodb";
import { DriverPaymentRecordModel } from "@/models/DriverPaymentRecord";
import type { Driver } from "@/types/driver";
import type { DriverPaymentRecord } from "@/types/driver-payment";

// ---------------------------------------------------------------------------
// Pure row builder (exported for tests; no Sheets calls)
// ---------------------------------------------------------------------------

export interface SheetRow {
  week: string;
  date: string;
  time: number | string;
  hourly_rate: number | string;
  subtotal: number | string;
  total_distance: number | string;
  fuel_coverage: number | string;
  total: number | string;
  note?: string;
}

/**
 * Build rows for a driver's tab.
 * Produces one row per calendar date within each week window (Mon→Sun from start),
 * with zeroes for days with no runs or for Saturday.
 * Multiple same-day runs are aggregated into one row.
 * Deposit week summary rows and payout period subtotals are appended.
 */
export function buildDriverTabRows(
  driver: Pick<
    Driver,
    "start_date" | "deposit_weeks" | "payout_cadence_weeks" | "hourly_rate" | "fuel_rate_per_km"
  >,
  records: Pick<
    DriverPaymentRecord,
    | "run_date"
    | "hours_effective"
    | "subtotal_labor"
    | "fuel_amount"
    | "total"
    | "total_distance_km"
    | "billable_distance_km"
    | "fuel_rate_snapshot"
    | "hourly_rate_snapshot"
    | "pay_week_index"
    | "is_deposit_week"
    | "status"
  >[]
): SheetRow[] {
  if (records.length === 0) return [];

  const startDate = new Date(`${driver.start_date}T00:00:00`);
  const maxWeek = Math.max(...records.map((r) => r.pay_week_index));
  const rows: SheetRow[] = [];

  // Group records by run_date for aggregation
  const byDate = new Map<string, typeof records>();
  for (const r of records) {
    if (!byDate.has(r.run_date)) byDate.set(r.run_date, []);
    byDate.get(r.run_date)!.push(r);
  }

  let heldBalance = 0;
  const payoutWeekGroups: { label: string; total: number }[] = [];
  let currentPayoutTotal = 0;
  let payoutStartWeek = driver.deposit_weeks;

  for (let wi = 0; wi <= maxWeek; wi++) {
    const weekStart = new Date(startDate.getTime() + wi * 7 * 86_400_000);
    const isDeposit = wi < driver.deposit_weeks;
    let weekTotal = 0;
    const weekLabel = `Week ${wi + 1}`;

    // One row per day of the week
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart.getTime() + d * 86_400_000);
      const dateStr = day.toISOString().slice(0, 10);
      const isSaturday = day.getDay() === 6;
      const dayRecords = byDate.get(dateStr) ?? [];

      if (isSaturday || dayRecords.length === 0) {
        rows.push({
          week: d === 0 ? weekLabel : "",
          date: dateStr,
          time: 0,
          hourly_rate: driver.hourly_rate,
          subtotal: 0,
          total_distance: 0,
          fuel_coverage: 0,
          total: 0,
        });
      } else {
        // Aggregate multiple runs on same day
        const hours = dayRecords.reduce((s, r) => s + r.hours_effective, 0);
        const subtotal = dayRecords.reduce((s, r) => s + r.subtotal_labor, 0);
        const fuel = dayRecords.reduce((s, r) => s + r.fuel_amount, 0);
        const total = dayRecords.reduce((s, r) => s + r.total, 0);
        const dist = dayRecords.reduce((s, r) => s + r.total_distance_km, 0);
        const billable = dayRecords.reduce((s, r) => s + r.billable_distance_km, 0);
        const hasPending = dayRecords.some((r) => r.status !== "computed");

        rows.push({
          week: d === 0 ? weekLabel : "",
          date: dateStr,
          time: parseFloat(hours.toFixed(4)),
          hourly_rate: driver.hourly_rate,
          subtotal: parseFloat(subtotal.toFixed(2)),
          total_distance: parseFloat(dist.toFixed(2)),
          fuel_coverage: parseFloat(fuel.toFixed(2)),
          total: parseFloat(total.toFixed(2)),
          note: hasPending ? "pending rate" : undefined,
        });
        weekTotal += total;
      }
    }

    // Week summary row
    if (isDeposit) {
      heldBalance += weekTotal;
      rows.push({
        week: `${weekLabel} (Deposit)`,
        date: "",
        time: "",
        hourly_rate: "",
        subtotal: "",
        total_distance: "",
        fuel_coverage: "",
        total: "",
        note: `Total First week deposit kept: ${heldBalance.toFixed(2)}`,
      });
    } else {
      // Payout cadence grouping
      currentPayoutTotal += weekTotal;
      const cadencePosition = (wi - payoutStartWeek) % driver.payout_cadence_weeks;
      if (cadencePosition === driver.payout_cadence_weeks - 1 || wi === maxWeek) {
        const fromWeek = wi - cadencePosition + 1;
        const toWeek = wi + 1;
        payoutWeekGroups.push({
          label: fromWeek === toWeek
            ? `Total Week ${fromWeek} Payable`
            : `Total Week ${fromWeek}-${toWeek} Payable`,
          total: currentPayoutTotal,
        });
        rows.push({
          week: fromWeek === toWeek ? `Week ${fromWeek}` : `Week ${fromWeek}-${toWeek}`,
          date: "",
          time: "",
          hourly_rate: "",
          subtotal: "",
          total_distance: "",
          fuel_coverage: "",
          total: parseFloat(currentPayoutTotal.toFixed(2)),
          note: fromWeek === toWeek
            ? `Total Week ${fromWeek} Payable`
            : `Total Week ${fromWeek}-${toWeek} Payable`,
        });
        currentPayoutTotal = 0;
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Sheet write (requires googleapis)
// ---------------------------------------------------------------------------

function rowToValues(row: SheetRow): (string | number)[] {
  return [
    row.week,
    row.date,
    row.time,
    row.hourly_rate,
    row.subtotal,
    row.total_distance,
    row.fuel_coverage,
    row.total,
    row.note ?? "",
  ];
}

const HEADER = ["Week", "Date", "Time", "Hourly Rate", "Subtotal", "Total Distance", "Fuel Coverage ($x/km)", "Total", "Note"];

/**
 * Rebuild a driver's sheet tab from their payment records.
 * Full rewrite = idempotent; never duplicates rows.
 * Best-effort: catches all errors, updates sheet_sync on records.
 */
export async function rebuildDriverTab(driver: Driver): Promise<void> {
  const config = getSheetsConfig();
  if (!config) {
    // Sheets sync is disabled; mark records as disabled (only if not already succeeded)
    return;
  }

  const now = new Date().toISOString();
  try {
    await connectDB();

    const records = await DriverPaymentRecordModel.find({
      driver_id: driver._id?.toString() ?? (driver as unknown as { _id: string })._id,
    })
      .sort({ run_date: 1 })
      .lean() as unknown as DriverPaymentRecord[];

    const { google } = await import("googleapis");
    const sa = parseServiceAccount(config.serviceAccountJson);
    const auth = new google.auth.JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = config.spreadsheetId;

    // Ensure the tab exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = spreadsheet.data.sheets ?? [];
    const tabTitle = driver.sheet_tab_title ?? driver.display_name;
    let sheetId = driver.sheet_tab_id;

    const existing = existingSheets.find(
      (s) => s.properties?.title === tabTitle || s.properties?.sheetId === sheetId
    );

    if (!existing) {
      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabTitle } } }],
        },
      });
      const newSheet = addRes.data.replies?.[0]?.addSheet?.properties;
      sheetId = newSheet?.sheetId ?? undefined;
      // Cache tab id on driver (best-effort)
      try {
        const { DriverModel } = await import("@/models/Driver");
        await DriverModel.findByIdAndUpdate(driver._id?.toString() ?? (driver as unknown as { _id: string })._id, {
          $set: { sheet_tab_title: tabTitle, sheet_tab_id: sheetId },
        });
      } catch { /* non-critical */ }
    } else {
      sheetId = existing.properties?.sheetId ?? sheetId;
    }

    const rows = buildDriverTabRows(driver, records);
    const values = [HEADER, ...rows.map(rowToValues)];

    // Clear and rewrite
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabTitle}'!A:I`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabTitle}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });

    // Mark all records succeeded
    await DriverPaymentRecordModel.updateMany(
      { driver_id: driver._id?.toString() ?? (driver as unknown as { _id: string })._id },
      { $set: { "sheet_sync.status": "success", "sheet_sync.attempted_at": now }, $inc: { "sheet_sync.attempts": 1 }, $unset: { "sheet_sync.error_message": "" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[sheets] rebuildDriverTab failed:", message);
    // Mark all records as failed
    try {
      await connectDB();
        await DriverPaymentRecordModel.updateMany(
          { driver_id: driver._id?.toString() ?? (driver as unknown as { _id: string })._id },
          {
            $set: {
              "sheet_sync.status": "failed",
              "sheet_sync.attempted_at": now,
              "sheet_sync.error_message": message,
            },
          }
        );
    } catch { /* non-critical */ }
  }
}
