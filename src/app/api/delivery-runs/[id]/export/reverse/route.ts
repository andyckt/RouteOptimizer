import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import type { OptimizedStop } from "@/types/delivery-run";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    await connectDB();
    const run = (await DeliveryRunModel.findById(id).lean()) as {
      optimized_route?: { stops?: OptimizedStop[] };
    } | null;
    if (!run) throw notFound("Delivery run not found");

    const route = run.optimized_route;
    const stops = [...(route?.stops ?? [])].reverse();
    if (stops.length === 0) {
      throw badRequest("No optimized route to export");
    }

    const headers = [
      "Stop #",
      "Customer Name",
      "Phone",
      "Address",
      "Order #",
      "Notes",
      "ETA",
      "Distance from Previous (km)",
    ];

    const rows: (string | number)[][] = [headers];
    let totalDist = 0;

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const dist = s.distance_from_previous ?? 0;
      totalDist += dist;
      rows.push([
        i + 1,
        s.customer_name ?? "",
        s.customer_phone ?? "",
        s.customer_address ?? "",
        i + 1,
        s.notes ?? "",
        s.eta ?? "",
        dist,
      ]);
    }

    rows.push(["TOTAL", "", "", "", "", "", "", totalDist]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reverse");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="reverse.xlsx"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
