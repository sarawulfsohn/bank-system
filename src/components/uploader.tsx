"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResultCard } from "@/components/result-card";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";
import type { DocRecord } from "@/lib/types";

const MAX_BYTES = 10 * 1024 * 1024;

export function Uploader({ history }: { history: DocRecord[] }) {
  const router = useRouter();
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopPolling, []);

  const poll = useCallback(
    (id: string) => {
      stopPolling();
      const startedAt = Date.now();
      const tick = async () => {
        // The server fails a dead job after ~75 s; this only guards against it being unreachable
        if (Date.now() - startedAt > 100_000) {
          stopPolling();
          setBusy(false);
          setError("This is taking longer than expected. Please upload the file again.");
          return;
        }
        try {
          const r = await fetch(`/api/documents/${id}`);
          if (r.status === 401) {
            stopPolling();
            router.replace("/login");
            return;
          }
          if (!r.ok) return;
          const d: DocRecord = await r.json();
          setDoc(d);
          if (d.status !== "processing") {
            stopPolling();
            setBusy(false);
            router.refresh(); // re-run the server component to refresh the history list
          }
        } catch {
          /* transient network error, next tick retries */
        }
      };
      tick();
      timer.current = setInterval(tick, 1500);
    },
    [router]
  );

  function pick(f: File | null | undefined) {
    if (!f) return;
    setError(null);
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("That file is larger than 10 MB.");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setBusy(true);
    setDoc(null);
    setCached(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("model", model);
      const r = await fetch("/api/documents", { method: "POST", body: fd });
      if (r.status === 401) {
        router.replace("/login");
        return;
      }
      const j: { id: string; cached?: boolean; error?: string } = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setCached(Boolean(j.cached));
      poll(j.id);
    } catch (e: unknown) {
      setError((e instanceof Error && e.message) || "Upload failed");
      setBusy(false);
    }
  }



  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition ${
              drag ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:bg-muted/40"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <p className="font-medium">
                {file.name}{" "}
                <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Drag a bank statement PDF here, or click to browse (max 10 MB)
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label} · {m.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submit} disabled={!file || busy}>
              {busy ? "Processing…" : "Extract"}
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {doc && <ResultCard doc={doc} cached={cached} />}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent documents</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <button
                  className="min-w-0 flex-1 text-left hover:underline"
                  onClick={() => {
                    setCached(true);
                    setDoc(h);
                    if (h.status === "processing") poll(h.id);
                  }}
                >
                  <span className="font-medium">{h.bank_name ?? h.file_name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {h.period_start ?? ""} {h.period_end ? `→ ${h.period_end}` : ""}
                  </span>
                </button>
                <Badge variant={h.status === "failed" ? "destructive" : "secondary"}>{h.status}</Badge>
                <Link href={`/documents/${h.id}`} className="text-xs text-muted-foreground hover:underline">
                  open
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
