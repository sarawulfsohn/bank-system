import { NextResponse } from "next/server";
import { deleteDocument, getDocument } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertSameOrigin, errorResponse, requireAdmin, requireUser } from "@/lib/auth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await params;
    // Another user's document is reported as missing, not forbidden
    const doc = await getDocument(id, user);
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const headers: Record<string, string> = {};
    if (new URL(req.url).searchParams.get("download") === "1") {
      const base = doc.file_name.replace(/\.pdf$/i, "").replace(/[^\w.\-]+/g, "_");
      headers["Content-Disposition"] = `attachment; filename="${base}.json"`;
    }
    return NextResponse.json(doc, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}

// Applicants can't remove what they've submitted: reviewers need it to stay. Admins can.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
