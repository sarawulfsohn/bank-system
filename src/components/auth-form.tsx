"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({
  mode,
  next,
  canRegister = true,
  invite,
}: {
  mode: "login" | "register";
  next: string;
  canRegister?: boolean;
  invite?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLogin = mode === "login";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isLogin && password.length < 10) {
      setError("Password must be at least 10 characters");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code: code || undefined, invite }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; needsCode?: boolean };
      if (j.needsCode) setNeedsCode(true);
      if (!r.ok) throw new Error(j.error || "Something went wrong");
      router.replace(next);
      router.refresh();
    } catch (err: unknown) {
      setError((err instanceof Error && err.message) || "Something went wrong");
      setBusy(false);
    }
  }

  const other = `${isLogin ? "/register" : "/login"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>{isLogin ? "Sign in" : "Create an account"}</CardTitle>
          <CardDescription>
            {isLogin ? "Sign in to upload and view your statements." : "Your documents are private to your account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 10}
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {!isLogin && <p className="text-xs text-muted-foreground">At least 10 characters.</p>}
          </div>
          {isLogin && needsCode && (
            <div className="space-y-2">
              <Label htmlFor="code">Authentication code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">The 6-digit code from your authenticator app.</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pt-6">
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
          </Button>
          {!isLogin && (
            <p className="text-xs text-muted-foreground">
              By creating an account you agree to how we handle your documents, described in the{" "}
              <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link>.
            </p>
          )}
          {(canRegister || !isLogin) && !invite && (
            <p className="text-sm text-muted-foreground">
              {isLogin ? "No account yet? " : "Already have an account? "}
              <Link href={other} className="text-foreground underline-offset-4 hover:underline">
                {isLogin ? "Create one" : "Sign in"}
              </Link>
            </p>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
