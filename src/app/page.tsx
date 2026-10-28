import { listDocuments } from "@/lib/db";
import { requirePageUser } from "@/lib/auth";
import { Uploader } from "@/components/uploader";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requirePageUser("/");
  const history = await listDocuments(user, 20);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Your statements</h1>
        <p className="text-sm text-muted-foreground">
          Upload a PDF statement and get the key numbers extracted with Workers AI. Results are
          saved, and uploading the same file again returns the saved result instantly.
        </p>
      </header>
      <Uploader history={history} />
    </main>
  );
}
