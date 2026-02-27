import { NextRequest } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { SavedLocationModel } from "@/models/SavedLocation";
import { json, handleApiError } from "@/lib/http/response";
import { badRequest } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

export async function GET(request: NextRequest) {
  try {
    requireAdminSession(request);
    await connectDB();
    const locations = await SavedLocationModel.find()
      .sort({ createdAt: 1 })
      .lean();
    return json(
      locations.map((loc: unknown) => {
        const l = loc as { _id: { toString(): string }; address: string; label?: string };
        return { _id: l._id.toString(), address: l.address, label: l.label };
      })
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAdminSession(request);
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const address = typeof body.address === "string" ? body.address.trim() : "";
    if (!address) {
      throw badRequest("Address is required");
    }
    const label = typeof body.label === "string" ? body.label.trim() : undefined;
    const loc = await SavedLocationModel.create({
      address,
      label: label || undefined,
    });
    return json(
      {
        _id: loc._id.toString(),
        address: loc.address,
        label: loc.label,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
