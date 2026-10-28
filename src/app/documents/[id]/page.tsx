import Link from "next/link";
import { notFound } from "next/navigation";
import { getDocument } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { ResultCard } from "@/components/result-card";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageUser(`/documents/${encodeURIComponent(id)}`);
  // Someone else's document looks exactly like a missing one
  const doc = await getDocument(id, user);
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Back
      </Link>
      {doc.status === "processing" && <AutoRefresh />}
      {user.role === "admin" && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          {doc.user_id !== user.id && <p className="text-muted-foreground">Owner: {doc.owner_email}</p>}
          {doc.pdf_stored ? (
            <a href={`/api/admin/documents/${doc.id}/pdf`} className="underline underline-offset-4">
              Download the original PDF
            </a>
          ) : (
            <p className="text-muted-foreground">The original PDF wasn&apos;t kept for this statement.</p>
          )}
          {doc.duplicate_of && (
            <p>
              Identical file to{" "}
              <Link href={`/documents/${doc.duplicate_of}`} className="underline underline-offset-4">an earlier upload</Link>{" "}
              by another user.
            </p>
          )}
          {doc.pdf_flags && doc.pdf_flags.length > 0 && (
            <div className="text-destructive">
              <p className="font-medium">Worth checking in the PDF itself:</p>
              <ul className="list-disc pl-5">{doc.pdf_flags.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {(doc.pdf_producer || doc.pdf_creator) && (
            <p className="text-xs text-muted-foreground">
              Made with: {[doc.pdf_creator, doc.pdf_producer].filter(Boolean).join(" / ")}
            </p>
          )}
        </div>
      )}
      <ResultCard doc={doc} />
    </main>
  );
}
