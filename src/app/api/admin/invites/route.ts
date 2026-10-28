import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { assertSameOrigin, errorResponse, readJson, requireAdmin } from "@/lib/auth";
import { createInvite } from "@/lib/invites";

// Creates a single-use sign-up link. The token is only ever returned here.
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const body = await readJson(req);
    const note = typeof body.note === "string" ? body.note.trim() : null;
    const invite = await createInvite(admin.id, note);
    await audit(admin, "invite.create", invite.id, { note });
    const url = `${new URL(req.url).origin}/register?invite=${invite.token}`;
    return NextResponse.json({ id: invite.id, url, expires_at: invite.expires_at }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
