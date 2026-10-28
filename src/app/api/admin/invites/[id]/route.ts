import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { assertSameOrigin, errorResponse, requireAdmin } from "@/lib/auth";
import { revokeInvite } from "@/lib/invites";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await params;
    if (!(await revokeInvite(id))) return NextResponse.json({ error: "Not found, or already used" }, { status: 404 });
    await audit(admin, "invite.revoke", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
