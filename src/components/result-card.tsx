import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { modelLabel } from "@/lib/models";
import { money } from "@/lib/format";
import type { DocRecord, Transaction } from "@/lib/types";

function TransactionsTable({ rows, currency }: { rows: Transaction[]; currency: string | null }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.line_no}>
              <TableCell className="whitespace-nowrap text-xs">{t.txn_date ?? "—"}</TableCell>
              <TableCell className="max-w-[16rem] truncate" title={t.description}>
                {t.description}
                {t.reference && <span className="text-muted-foreground"> · #{t.reference}</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{t.category}</TableCell>
              <TableCell
                className={`whitespace-nowrap text-right font-medium ${
                  t.type === "credit" ? "text-green-700" : "text-red-600"
                }`}
              >
                {t.type === "credit" ? "+" : "−"}
                {money(t.amount, currency)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right text-xs">
                {t.balance_after === null ? "—" : money(t.balance_after, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ResultCard({ doc, cached }: { doc: DocRecord; cached?: boolean }) {
  if (doc.status === "processing") {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm">
            Reading <span className="font-medium">{doc.file_name}</span> with {modelLabel(doc.model)}…
          </p>
          <Progress value={60} className="animate-pulse" />
          <p className="text-xs text-muted-foreground">
            This runs in the background. You can leave this page and come back from the history list.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (doc.status === "failed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Processing failed</CardTitle>
          <CardDescription>{doc.file_name}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-red-600">
          {doc.error ?? "Unknown error"}
        </CardContent>
      </Card>
    );
  }

  const stats: [string, string][] = [
    ["Total deposits", money(doc.total_deposits, doc.currency)],
    ["Total withdrawals", money(doc.total_withdrawals, doc.currency)],
    ["Fees", money(doc.fees_total, doc.currency)],
    ["Interest", money(doc.interest_total, doc.currency)],
    ["Opening balance", money(doc.opening_balance, doc.currency)],
    ["Closing balance", money(doc.closing_balance, doc.currency)],
    ["Transactions", doc.transaction_count?.toString() ?? "—"],
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{doc.bank_name ?? "Unknown bank"}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {cached && <Badge variant="secondary">Cached result</Badge>}
            {doc.reconciled === 1 && <Badge variant="secondary">Balances reconcile</Badge>}
            {doc.reconciled === null && <Badge variant="outline">Balances couldn&apos;t be checked</Badge>}
            {doc.reconciled === 0 && (
              <Badge variant="destructive">Totals don&apos;t reconcile, verify manually</Badge>
            )}
            <Badge variant="outline">{modelLabel(doc.model)}</Badge>
          </div>
        </div>
        <CardDescription>
          {doc.period_start ?? "?"} → {doc.period_end ?? "?"}
          {doc.account_type && ` · ${doc.account_type}`}
          {doc.account_number_last4 && ` · account ••${doc.account_number_last4}`}
          {doc.account_holder && ` · ${doc.account_holder}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>

        {doc.transactions && doc.transactions.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Transactions ({doc.transactions.length})</h3>
            <TransactionsTable rows={doc.transactions} currency={doc.currency} />
          </div>
        )}

        {doc.notable_items.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Notable items</h3>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {doc.notable_items.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {doc.file_name}
            {doc.duration_ms ? ` · processed in ${(doc.duration_ms / 1000).toFixed(1)}s` : ""}
          </span>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/documents/${doc.id}?download=1`}>Download JSON</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
