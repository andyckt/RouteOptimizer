import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";
import { sendSms } from "@/lib/openphone/client";
import { getServerEnv } from "@/lib/env";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import { assertRateLimit } from "@/lib/rate-limit";
import type { DeliveryCustomer } from "@/types/delivery-run";

type Params = { params: Promise<{ id: string }> };

/** Fits typical concatenated GSM SMS limits; carrier APIs usually split longer bodies. */
const MAX_MESSAGE_CHARS = 1600;

/** Light throttle between OpenPhone calls to reduce burst-rate failures. */
const BETWEEN_SEND_MS = 1000;

function sanitizeBroadcastBody(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").trim();
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    requireAdminSession(req);

    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    assertRateLimit({
      key: `broadcast-sms:${ip}`,
      windowMs: 60_000,
      maxRequests: 5,
    });

    let body: { message?: unknown; customer_indices?: unknown };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }

    const raw =
      typeof body.message === "string" ? sanitizeBroadcastBody(body.message) : "";

    if (!raw) {
      throw validationError("Message cannot be empty.");
    }
    if (raw.length > MAX_MESSAGE_CHARS) {
      throw validationError(
        `Message is too long (max ${MAX_MESSAGE_CHARS} characters).`
      );
    }

    const content = raw;

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    const customers = JSON.parse(
      JSON.stringify(run.customers ?? [])
    ) as DeliveryCustomer[];

    if (customers.length === 0) {
      throw validationError("This run has no customers to message.");
    }

    const n = customers.length;
    let indicesToMessage: number[];
    if (body.customer_indices === undefined) {
      indicesToMessage = customers.map((_, i) => i);
    } else if (!Array.isArray(body.customer_indices)) {
      throw badRequest("customer_indices must be an array when provided.");
    } else {
      const seen = new Set<number>();
      for (const item of body.customer_indices) {
        if (typeof item !== "number" || !Number.isInteger(item)) {
          throw validationError("Each customer index must be a whole number.");
        }
        if (item < 0 || item >= n) {
          throw validationError(`Invalid customer index: ${item}.`);
        }
        seen.add(item);
      }
      indicesToMessage = Array.from(seen).sort((a, b) => a - b);
    }

    if (indicesToMessage.length === 0) {
      throw validationError("Select at least one customer to message.");
    }

    const { OPENPHONE_FROM, OPENPHONE_API_KEY } = getServerEnv();
    if (!OPENPHONE_API_KEY?.trim()) {
      throw validationError(
        "SMS is not configured (missing OPENPHONE_API_KEY). Check server environment."
      );
    }
    if (!OPENPHONE_FROM.trim()) {
      throw validationError(
        "SMS is not configured (missing OPENPHONE_FROM). Check server environment."
      );
    }

    const failed: Array<{
      customer_name: string;
      phone: string;
      error: string;
    }> = [];

    const byPhone = new Map<string, string[]>();

    for (const idx of indicesToMessage) {
      const c = customers[idx];
      const name = (c.name ?? "").trim() || "(no name)";
      const phoneRaw = (c.phone ?? "").trim();
      const toE164 = toE164NorthAmerica(phoneRaw);
      if (!toE164) {
        failed.push({
          customer_name: name,
          phone: phoneRaw || "—",
          error: phoneRaw ? "Invalid phone number for SMS" : "Missing phone number",
        });
        continue;
      }
      const list = byPhone.get(toE164) ?? [];
      list.push(name);
      byPhone.set(toE164, list);
    }

    const batches = Array.from(byPhone.entries()).map(([e164, names]) => ({
      e164,
      namesJoined: names.join(", "),
    }));

    if (batches.length === 0) {
      return json({
        success: false,
        total_sent: 0,
        total_failed: failed.length,
        failed_customers: failed,
        message: "No valid phone numbers among the selected customers.",
      });
    }

    let totalSent = 0;

    for (let i = 0; i < batches.length; i++) {
      const { e164 } = batches[i];

      const result = await sendSms({
        from: OPENPHONE_FROM,
        toE164: e164,
        content,
      });

      if (result.success) {
        totalSent++;
      } else {
        failed.push({
          customer_name: batches[i].namesJoined,
          phone: e164,
          error: result.error ?? "Send failed",
        });
      }

      if (i < batches.length - 1) {
        await new Promise((r) => setTimeout(r, BETWEEN_SEND_MS));
      }
    }

    const selectedSmsableRows = indicesToMessage.filter(
      (idx) => Boolean(toE164NorthAmerica(customers[idx].phone ?? ""))
    );

    return json({
      success: failed.length === 0 && totalSent > 0,
      total_sent: totalSent,
      total_failed: failed.length,
      failed_customers: failed,
      duplicates_merged_to_one_sms: batches.length < selectedSmsableRows.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
