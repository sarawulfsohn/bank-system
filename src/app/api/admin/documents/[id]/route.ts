import { NextResponse } from "next/server";
import { deleteDocument } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertSameOrigin, errorResponse, requireAdmin } from "@/lib/auth";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdmin();
    const { id } = await params;
    if (!(await deleteDocument(id)))
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    await audit(admin, "document.delete", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
