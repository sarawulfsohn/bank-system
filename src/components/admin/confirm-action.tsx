"use client";

import { useState } from "react";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// A button that opens a confirmation dialog. onConfirm returns an error message,
// or null on success (which closes the dialog).
export function ConfirmAction({
  label,
  title,
  description,
  confirmLabel,
  destructive,
  disabled,
  children,
  onConfirm,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  onConfirm: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
    else setOpen(false);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant={destructive ? "destructive" : "outline"} size="xs" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {/* Plain button, not AlertDialogAction, so the dialog stays open on error */}
          <Button variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel ?? label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Shared fetch helper for the admin tables: returns an error message or null
export async function adminRequest(url: string, method: "PATCH" | "DELETE", body?: object) {
  try {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return j.error || `Request failed (${r.status})`;
  } catch {
    return "Network error, please try again";
  }
}
