/**
 * Admin API: read driver payment records with weekly/payout rollups.
 * GET /api/driver-payments?driver_id=&start_date=&end_date=&status=
 */

import { NextRequest } from "next/server";
import { json, handleApiError } from "@/lib/http/response";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { connectDB } from "@/lib/mongodb";
import { DriverPaymentRecordModel } from "@/models/DriverPaymentRecord";
import { DriverModel } from "@/models/Driver";
import type { DriverPaymentRecord } from "@/types/driver-payment";
import type { Driver } from "@/types/driver";
import { isDepositWeek } from "@/lib/payments/computeRunPayment";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireAdminSession(req);
    await connectDB();

    const sp = req.nextUrl.searchParams;
    const driverId = sp.get("driver_id");
    const startDate = sp.get("start_date");
    const endDate = sp.get("end_date");
    const status = sp.get("status");

    const filter: Record<string, unknown> = {};
    if (driverId) filter.driver_id = driverId;
    if (startDate || endDate) {
      const dateFilter: Record<string, string> = {};
      if (startDate) dateFilter.$gte = startDate;
      if (endDate) dateFilter.$lte = endDate;
      filter.run_date = dateFilter;
    }
    if (status) filter.status = status;

    const records = await DriverPaymentRecordModel.find(filter)
      .sort({ run_date: 1 })
      .lean() as unknown as DriverPaymentRecord[];

    // Build rollups per driver
    const driverIds = Array.from(new Set(records.filter(r => r.driver_id).map(r => r.driver_id!)));
    const drivers = await DriverModel.find({ _id: { $in: driverIds } }).lean() as unknown as (Driver & { _id: { toString(): string } })[];
    const driverMap = new Map(drivers.map(d => [d._id.toString(), d]));

    interface WeekRollup {
      week_index: number;
      is_deposit: boolean;
      total: number;
      records: DriverPaymentRecord[];
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

    const rollups: DriverRollup[] = [];

    for (const dId of driverIds) {
      const driver = driverMap.get(dId);
      if (!driver) continue;
      const driverRecords = records.filter(r => r.driver_id === dId);

      const weekMap = new Map<number, WeekRollup>();
      for (const r of driverRecords) {
        if (!weekMap.has(r.pay_week_index)) {
          weekMap.set(r.pay_week_index, {
            week_index: r.pay_week_index,
            is_deposit: isDepositWeek(r.pay_week_index, driver.deposit_weeks),
            total: 0,
            records: [],
          });
        }
        const wk = weekMap.get(r.pay_week_index)!;
        wk.total += r.total;
        wk.records.push(r);
      }

      const weeks = Array.from(weekMap.values()).sort((a, b) => a.week_index - b.week_index);
      let heldBalance = 0;
      const periods: PayoutPeriod[] = [];
      let cadenceBuffer: WeekRollup[] = [];

      for (const wk of weeks) {
        if (wk.is_deposit) {
          heldBalance += wk.total;
          periods.push({
            label: `Week ${wk.week_index + 1} (Deposit)`,
            weeks: [wk],
            total: wk.total,
            is_held: true,
          });
        } else {
          cadenceBuffer.push(wk);
          if (cadenceBuffer.length >= driver.payout_cadence_weeks) {
            const from = cadenceBuffer[0].week_index + 1;
            const to = cadenceBuffer[cadenceBuffer.length - 1].week_index + 1;
            periods.push({
              label: from === to ? `Week ${from} Payable` : `Week ${from}-${to} Payable`,
              weeks: [...cadenceBuffer],
              total: parseFloat(cadenceBuffer.reduce((s, w) => s + w.total, 0).toFixed(2)),
              is_held: false,
            });
            cadenceBuffer = [];
          }
        }
      }
      // Flush partial cadence
      if (cadenceBuffer.length > 0) {
        const from = cadenceBuffer[0].week_index + 1;
        const to = cadenceBuffer[cadenceBuffer.length - 1].week_index + 1;
        periods.push({
          label: from === to ? `Week ${from} (partial)` : `Week ${from}-${to} (partial)`,
          weeks: [...cadenceBuffer],
          total: parseFloat(cadenceBuffer.reduce((s, w) => s + w.total, 0).toFixed(2)),
          is_held: false,
        });
      }

      rollups.push({
        driver_id: dId,
        driver_name: driver.display_name,
        held_balance: parseFloat(heldBalance.toFixed(2)),
        payout_periods: periods,
      });
    }

    return json({
      records: records.map(r => ({ ...r, _id: (r._id as unknown as { toString(): string }).toString() })),
      rollups,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
