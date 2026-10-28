import { NextResponse } from "next/server";
import { assertSameOrigin, destroySession, errorResponse } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const res = NextResponse.json({ ok: true });
    await destroySession(res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
