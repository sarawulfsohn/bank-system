"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAction, adminRequest } from "@/components/admin/confirm-action";
import { dateTime } from "@/lib/format";
import type { InviteRow } from "@/lib/invites";

export function InvitePanel({ invites }: { invites: InviteRow[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  async function create() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const r = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error || "Could not create the link");
      setLink(j.url);
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1 space-y-1">
          <Label htmlFor="invite-note">Who is it for? (optional note)</Label>
          <Input id="invite-note" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button onClick={create} disabled={busy}>{busy ? "Creating…" : "Create invite link"}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {link && (
        <div className="space-y-1 rounded-md border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Single-use, valid for 7 days. This is the only time it is shown.</p>
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        </div>
      )}
      {invites.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {invites.map((i) => {
            const status = i.used_at ? `used by ${i.used_email ?? "a deleted account"}` : i.expires_at < now ? "expired" : "open";
            return (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {i.note || "No note"}{" "}
                  <span className="text-xs text-muted-foreground">· created {dateTime(i.created_at)} · {status}</span>
                </span>
                {!i.used_at && (
                  <ConfirmAction
                    label="Revoke"
                    destructive
                    title="Revoke this invite link?"
                    description="The link will stop working."
                    onConfirm={async () => {
                      const err = await adminRequest(`/api/admin/invites/${i.id}`, "DELETE");
                      if (!err) router.refresh();
                      return err;
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
