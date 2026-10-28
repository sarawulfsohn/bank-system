import { NextResponse } from "next/server";
import { getBindings } from "@/lib/db";
import { audit } from "@/lib/audit";
import { errorResponse, requireAdmin } from "@/lib/auth";

// The original statement as uploaded, for checking the extracted numbers against the source.
// Sent as a download, never rendered in our origin: the file comes from an applicant.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { env } = await getBindings();
    const doc = await env.DB.prepare("SELECT file_hash, file_name FROM documents WHERE id = ?")
      .bind(id)
      .first<{ file_hash: string; file_name: string }>();
    const obj = doc && (await env.STATEMENTS.get(`pdf/${doc.file_hash}`));
    if (!doc || !obj) return NextResponse.json({ error: "Original not stored for this statement" }, { status: 404 });

    await audit(admin, "document.download_pdf", id);
    const name = doc.file_name.replace(/\.pdf$/i, "").replace(/[^\w.\-]+/g, "_") || "statement";
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}.pdf"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
