import Link from "next/link";
import { DocumentsTable } from "@/components/admin/documents-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pager } from "@/components/admin/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLIENT_LIMIT, getClientSummaries, getFilterOptions, getSummaryTotals, queryDocuments } from "@/lib/admin-queries";
import { parseFilters } from "@/lib/filters";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

function Stat({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

const th = "h-8 whitespace-nowrap px-2 text-xs";
const td = "px-2 py-1 text-xs";
const numTd = `${td} text-right font-mono tabular-nums`;

export default async function AdminSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = parseFilters(await searchParams);
  const [options, totals, clients, docs] = await Promise.all([
    getFilterOptions(),
    getSummaryTotals(f),
    getClientSummaries(f),
    queryDocuments(f),
  ]);

  return (
    <div className="space-y-6">
      <FilterBar f={f} options={options} action="/admin" mode="statements" exportView="summary" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-9">
        <Stat label="Statements" value={totals.statements} />
        <Stat label="Clients" value={totals.clients} />
        <Stat label="Total deposits" value={money(totals.deposits)} />
        <Stat label="Total withdrawals" value={money(totals.withdrawals)} />
        <Stat label="Net" value={money(totals.deposits - totals.withdrawals)} />
        <Stat label="Fees" value={money(totals.fees)} />
        <Stat label="Don't reconcile" value={totals.unreconciled} warn={totals.unreconciled > 0} />
        <Stat label="Unverified" value={totals.unverified} warn={totals.unverified > 0} />
        <Stat label="Failed" value={totals.failed} warn={totals.failed > 0} />
      </div>

      {totals.currencies > 1 && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          These statements are in {totals.currencies} different currencies. Amounts are added up as plain numbers, with no conversion, so filter by bank or client before reading the totals.
        </p>
      )}
      {totals.unverified > 0 && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {totals.unverified} statement{totals.unverified === 1 ? "" : "s"} finished but the balances couldn&apos;t be checked (a figure was missing). Treat as unverified and compare with the original.
        </p>
      )}
      {(totals.excluded > 0 || totals.overlapping > 0) && !f.dups && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          {totals.excluded > 0 && (
            <>{totals.excluded} statement{totals.excluded === 1 ? " is" : "s are"} fully covered by an earlier upload of the same account and left out of these totals. </>
          )}
          {totals.overlapping > 0 && (
            <>{totals.overlapping} overlap{totals.overlapping === 1 ? "s" : ""} another statement; on the Monthly and All data tabs, days covered twice are counted once, but the statement totals here still include partial overlaps. </>
          )}
          Tick &quot;Include overlapping / duplicate statements&quot; to count everything.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">By client</h2>
        {clients.length >= CLIENT_LIMIT && (
          <p className="text-xs text-muted-foreground">Showing the top {CLIENT_LIMIT} clients by deposits. Narrow the filters to see others.</p>
        )}
        {clients.length === 0 ? (
          <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No statements match these filters.</p>
        ) : (
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table className="border-collapse">
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className={th}>Client</TableHead>
                  <TableHead className={th}>Bank(s)</TableHead>
                  <TableHead className={`${th} text-right`}>Statements</TableHead>
                  <TableHead className={th}>Covers</TableHead>
                  <TableHead className={`${th} text-right`}>Deposits</TableHead>
                  <TableHead className={`${th} text-right`}>Avg deposits / stmt</TableHead>
                  <TableHead className={`${th} text-right`}>Withdrawals</TableHead>
                  <TableHead className={`${th} text-right`}>Fees</TableHead>
                  <TableHead className={`${th} text-right`}>Latest closing</TableHead>
                  <TableHead className={`${th} text-right`}>Unreconciled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.client} className="odd:bg-muted/30">
                    <TableCell className={`${td} font-medium`}>
                      <Link
                        href={`/admin/client?name=${encodeURIComponent(c.client)}`}
                        className="hover:underline"
                        title="Open client profile"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className={td}>{c.banks ?? "—"}</TableCell>
                    <TableCell className={numTd}>{c.statements}</TableCell>
                    <TableCell className={`${td} whitespace-nowrap font-mono`}>
                      {c.first_period ?? "?"} → {c.last_period ?? "?"}
                    </TableCell>
                    <TableCell className={numTd}>{money(c.deposits)}</TableCell>
                    <TableCell className={numTd}>{money(c.avg_deposits)}</TableCell>
                    <TableCell className={numTd}>{money(c.withdrawals)}</TableCell>
                    <TableCell className={numTd}>{money(c.fees)}</TableCell>
                    <TableCell className={numTd}>{money(c.last_closing)}</TableCell>
                    <TableCell className={`${numTd} ${c.unreconciled ? "text-destructive" : ""}`}>{c.unreconciled}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Statements</h2>
        <DocumentsTable docs={docs.rows} f={f} />
        <Pager f={f} base="/admin" total={docs.total} />
      </section>
    </div>
  );
}
