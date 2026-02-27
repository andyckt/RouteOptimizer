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

interface ExtraCustomer {
  name: string;
  address: string;
  quantity?: number;
}

interface LabelsBody {
  labelQuantities?: Record<string, number>;
  extraCustomers?: ExtraCustomer[];
  extrasPlacement?: "top" | "bottom";
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: LabelsBody = {};
    try {
      body = (await req.json()) as LabelsBody;
    } catch {
      // empty body ok, use defaults
    }

    const labelQuantities = body.labelQuantities ?? {};
    const extraCustomers = Array.isArray(body.extraCustomers)
      ? body.extraCustomers
      : [];
    const extrasPlacement = body.extrasPlacement ?? "bottom";

    await connectDB();
    const run = (await DeliveryRunModel.findById(id).lean()) as {
      optimized_route?: { stops?: OptimizedStop[] };
    } | null;
    if (!run) throw notFound("Delivery run not found");

    const route = run.optimized_route;
    const stops = route?.stops ?? [];

    const labelRows: [string, string][] = [];

    const extras: [string, string][] = [];
    for (const ec of extraCustomers) {
      const qty = Math.max(0, Math.floor(ec.quantity ?? 2));
      for (let i = 0; i < qty; i++) {
        extras.push([ec.name ?? "", ec.address ?? ""]);
      }
    }

    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const qty = Math.max(
        0,
        Math.floor(
          labelQuantities[String(i)] ??
            labelQuantities[i as unknown as string] ??
            2
        )
      );
      for (let j = 0; j < qty; j++) {
        labelRows.push([
          s.customer_name ?? "",
          s.customer_address ?? "",
        ]);
      }
    }

    let finalRows: [string, string][];
    if (extrasPlacement === "top") {
      finalRows = [...extras, ...labelRows];
    } else {
      finalRows = [...labelRows, ...extras];
    }

    finalRows.reverse();

    const headers: [string, string] = ["Name", "Address"];
    const aoa: (string | number)[][] = [headers, ...finalRows];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Labels");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="labels.xlsx"',
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
