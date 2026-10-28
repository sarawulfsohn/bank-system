import { NextResponse } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";

export async function GET() {
  try {
    return NextResponse.json(await requireUser());
  } catch (e) {
    return errorResponse(e);
  }
}
