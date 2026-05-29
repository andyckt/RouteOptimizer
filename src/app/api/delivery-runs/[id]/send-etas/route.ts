import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { DeliveryRunModel } from "@/models/DeliveryRun";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest, notFound, validationError } from "@/lib/http/errors";
import type { OptimizedStop } from "@/types/delivery-run";
import { sendSms } from "@/lib/openphone/client";
import { getServerEnv } from "@/lib/env";
import { toE164NorthAmerica } from "@/lib/phone/e164";
import { formatEtaWindowToronto } from "@/lib/time/etaWindow";
import { verifyDriverToken } from "@/lib/security/driverToken";
import { verifyAdminSession } from "@/lib/auth/adminSession";
import { SESSION_COOKIE_NAME } from "@/lib/auth/adminSession";
import { isSyntheticStop } from "@/lib/stops/synthetic";

type Params = { params: Promise<{ id: string }> };

const SMS_TEMPLATE = "【Kapioo卡皮喔】您的今日餐食正在配送中，预计送达时间为：{eta}。请耐心等待喔~";

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid run ID");
    }

    let body: { token?: string };
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const token = typeof body.token === "string" ? body.token : undefined;
    const hasDriverAuth = token && verifyDriverToken(id, token);
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const hasAdminAuth = cookie && verifyAdminSession(cookie);
    if (!hasDriverAuth && !hasAdminAuth) {
      throw badRequest("Invalid or missing driver token");
    }

    await connectDB();
    const run = await DeliveryRunModel.findById(id);
    if (!run) throw notFound("Delivery run not found");

    if (run.status !== "in_progress") {
      throw validationError(
        `Run must be in progress to send ETAs. Current status: ${run.status}`
      );
    }
    const route = run.optimized_route;
    if (!route?.stops?.length) {
      throw validationError("Optimized route has no stops.");
    }

    const { OPENPHONE_FROM } = getServerEnv();
    const stops = route.stops as OptimizedStop[];
    const failedCustomers: Array<{ customer_name: string; phone: string; error: string }> = [];
    let totalSent = 0;

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      if (isSyntheticStop(stop)) continue;

      const toE164 = toE164NorthAmerica(stop.customer_phone ?? "");
      if (!toE164) {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: "Invalid phone number for North America",
        });
        continue;
      }

      const arrivalDate = stop.arrival_time ? new Date(stop.arrival_time) : null;
      if (!arrivalDate || isNaN(arrivalDate.getTime())) {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: "No ETA available",
        });
        continue;
      }

      const eta = formatEtaWindowToronto(arrivalDate);
      const content = SMS_TEMPLATE.replace("{eta}", eta);

      const result = await sendSms({
        from: OPENPHONE_FROM,
        toE164,
        content,
      });

      if (result.success) {
        totalSent++;
        stop.sms_message_text = content;
        stop.sms_sent_at = new Date().toISOString();
      } else {
        failedCustomers.push({
          customer_name: stop.customer_name ?? "unknown",
          phone: stop.customer_phone ?? "",
          error: result.error ?? "Send failed",
        });
      }

      if (i < stops.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Only mark as sent if at least one message went through successfully
    if (totalSent > 0) {
      run.messages_sent = true;
      run.messages_sent_at = new Date().toISOString();
    }
    await run.save();

    return json({
      success: failedCustomers.length === 0,
      total_sent: totalSent,
      total_failed: failedCustomers.length,
      failed_customers: failedCustomers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
