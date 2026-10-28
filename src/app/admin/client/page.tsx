import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthlyTable } from "@/components/admin/monthly-table";
import { DocumentsTable } from "@/components/admin/documents-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UNKNOWN, getClientDetail, getClientSummaries, queryDocuments } from "@/lib/admin-queries";
import { parseFilters } from "@/lib/filters";
import { money } from "@/lib/format";
import type { DataRow } from "@/lib/admin-types";

export const dynamic = "force-dynamic";

function Stat({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

const td = "px-2 py-1 text-xs";

function TxnList({ rows }: { rows: DataRow[] }) {
  return (
    <div className="max-h-[40vh] overflow-auto rounded-md border">
      <Table className="border-collapse">
        <TableHeader className="sticky top-0 bg-muted">
          <TableRow>
            <TableHead className="h-8 px-2 text-xs">Date</TableHead>
            <TableHead className="h-8 px-2 text-xs">Description</TableHead>
            <TableHead className="h-8 px-2 text-right text-xs">Amount</TableHead>
            <TableHead className="h-8 px-2 text-xs">Statement</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.document_id}-${r.line_no}`} className="odd:bg-muted/30">
              <TableCell className={`${td} whitespace-nowrap font-mono`}>{r.txn_date}</TableCell>
              <TableCell className={`${td} max-w-[28rem] truncate`} title={r.description}>{r.description}</TableCell>
              <TableCell className={`${td} text-right font-mono tabular-nums ${r.type === "credit" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                {r.type === "debit" ? "−" : "+"}{money(r.amount, r.currency)}
              </TableCell>
              <TableCell className={td}>
                <Link href={`/documents/${r.document_id}`} className="hover:underline">{r.file_name}</Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function ClientPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const name = pick(sp.name) ?? pick(sp.client) ?? "";
  if (!name) notFound();

  const f = parseFilters({ ...sp, client: name });
  const [detail, summaries, docs] = await Promise.all([
    getClientDetail(name),
    getClientSummaries(f),
    queryDocuments(f.sort ? f : { ...f, sort: "start" }),
  ]);
  const s = summaries[0];
  if (!s) notFound();
  const display = s.name;

  const months = detail.months;
  const avgDeposits = months.length ? months.reduce((a, m) => a + m.deposits, 0) / months.length : null;
  const lowest = months.reduce<number | null>((a, m) => (m.min_balance === null ? a : a === null ? m.min_balance : Math.min(a, m.min_balance)), null);
  const nsf = months.reduce((a, m) => a + m.nsf, 0);
  const financing = months.reduce((a, m) => a + m.financing, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">← Summary</Link>
        <h2 className="text-xl font-semibold">{display === UNKNOWN ? "Unknown client" : display}</h2>
        <p className="text-sm text-muted-foreground">
          {s.banks ?? "Unknown bank"} · {s.statements} statement{s.statements === 1 ? "" : "s"} · {s.first_period ?? "?"} → {s.last_period ?? "?"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Months of data" value={months.length} />
        <Stat label="Avg monthly deposits" value={money(avgDeposits)} />
        <Stat label="Total deposits" value={money(s.deposits)} />
        <Stat label="Total withdrawals" value={money(s.withdrawals)} />
        <Stat label="Lowest balance" value={money(lowest)} warn={lowest !== null && lowest < 0} />
        <Stat label="NSF / overdraft" value={nsf} warn={nsf > 0} />
        <Stat label="Financing debits" value={financing} warn={financing > 0} />
        <Stat label="Missing months" value={detail.missingMonths.length} warn={detail.missingMonths.length > 0} />
      </div>

      {detail.missingMonths.length > 0 && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          No transactions found for {detail.missingMonths.join(", ")}. Statements may be missing.
        </p>
      )}
      {docs.rows.some((d) => d.overlap_count) && !f.dups && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Some statements overlap or duplicate each other (see the badges below). Days covered by more than one statement are counted once in the figures above.
        </p>
      )}
      {s.unreconciled > 0 && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {s.unreconciled} statement{s.unreconciled === 1 ? "" : "s"} did not reconcile. Verify those manually.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-base font-semibold">Month by month</h3>
        <MonthlyTable rows={months} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-base font-semibold">Flagged transactions</h3>
          {detail.flagged.length === 0 ? (
            <p className="text-sm text-muted-foreground">No NSF, overdraft or financing keywords found.</p>
          ) : (
            <TxnList rows={detail.flagged} />
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-base font-semibold">Largest deposits</h3>
          <TxnList rows={detail.topDeposits} />
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-base font-semibold">Statements</h3>
        <DocumentsTable docs={docs.rows} f={f} base="/admin/client" />
      </section>
    </div>
  );
}
