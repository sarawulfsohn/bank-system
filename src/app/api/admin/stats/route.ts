import { NextResponse } from "next/server";
import { getStats } from "@/lib/db";
import { errorResponse, requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await getStats());
  } catch (e) {
    return errorResponse(e);
  }
}
