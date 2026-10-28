"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SecurityForm({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(action: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/security/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; secret?: string; uri?: string };
      if (!r.ok) throw new Error(j.error || "Something went wrong");
      if (action === "begin" && j.secret && j.uri) setSetup({ secret: j.secret, uri: j.uri });
      else {
        setSetup(null);
        setCode("");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const codeField = (
    <div className="max-w-xs space-y-1">
      <Label htmlFor="totp-code">6-digit code from your app</Label>
      <Input id="totp-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
    </div>
  );

  return (
    <div className="space-y-4">
      {enabled ? (
        <>
          <p className="text-sm">Two-factor is <strong>on</strong>. Signing in needs your password and a code.</p>
          {codeField}
          <Button variant="outline" onClick={() => call("disable")} disabled={busy || code.length !== 6}>Turn off</Button>
        </>
      ) : setup ? (
        <>
          <p className="text-sm">
            In your authenticator app (Google Authenticator, 1Password, Authy…) add an account with this key, then enter the code it shows.
          </p>
          <Input readOnly value={setup.secret} onFocus={(e) => e.currentTarget.select()} className="max-w-md font-mono" />
          <p className="text-xs text-muted-foreground">
            Or open <a href={setup.uri} className="underline">the setup link</a> on a device that has the app installed.
          </p>
          {codeField}
          <Button onClick={() => call("enable")} disabled={busy || code.length !== 6}>Turn on</Button>
        </>
      ) : (
        <>
          <p className="text-sm">
            Two-factor is <strong>off</strong>. This account can export every applicant&apos;s statements, so a password alone is thin protection.
          </p>
          <Button onClick={() => call("begin")} disabled={busy}>Set up two-factor</Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
