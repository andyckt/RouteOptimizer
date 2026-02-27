import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { SavedLocationModel } from "@/models/SavedLocation";
import { handleApiError } from "@/lib/http/response";
import { badRequest, notFound } from "@/lib/http/errors";
import { requireAdminSession } from "@/lib/auth/requireAdmin";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    requireAdminSession(request);
    const { id } = await params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      throw badRequest("Invalid saved location ID");
    }
    await connectDB();
    const deleted = await SavedLocationModel.findByIdAndDelete(id);
    if (!deleted) throw notFound("Saved location not found");
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
