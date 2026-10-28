"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ConfirmAction, adminRequest } from "@/components/admin/confirm-action";
import { SortHead } from "@/components/admin/sort-head";
import { money } from "@/lib/format";
import type { Filters } from "@/lib/filters";
import type { DocRecord } from "@/lib/types";

const cell = "border-r px-2 py-1 text-xs last:border-r-0";
const num = `${cell} text-right font-mono tabular-nums`;

// Statement-level grid: one row per uploaded statement
export function DocumentsTable({ docs, f, base = "/admin" }: { docs: DocRecord[]; f: Filters; base?: string }) {
  const router = useRouter();
  const head = { f, base };

  if (docs.length === 0)
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No statements match these filters.</p>;

  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border">
      <Table className="border-collapse">
        <thead>
          <tr className="border-b">
            <SortHead {...head} k="client">Client</SortHead>
            <SortHead {...head} k="bank">Bank</SortHead>
            <SortHead {...head} k="start">Period start</SortHead>
            <SortHead {...head} k="end">Period end</SortHead>
            <SortHead {...head} k="opening" right>Opening</SortHead>
            <SortHead {...head} k="deposits" right>Deposits</SortHead>
            <SortHead {...head} k="withdrawals" right>Withdrawals</SortHead>
            <SortHead {...head} k="fees" right>Fees</SortHead>
            <SortHead {...head} k="closing" right>Closing</SortHead>
            <SortHead {...head} k="txns" right>Txns</SortHead>
            <SortHead {...head} k="status">Status</SortHead>
            <SortHead {...head} k="owner">Uploaded by</SortHead>
            <SortHead {...head} k="file">File</SortHead>
            <SortHead {...head} k="uploaded">Uploaded</SortHead>
            <th className="sticky top-0 z-10 bg-muted" />
          </tr>
        </thead>
        <TableBody>
          {docs.map((d) => (
            <TableRow key={d.id} className="odd:bg-muted/30">
              <TableCell className={`${cell} whitespace-nowrap font-medium`}>
                {d.account_holder ?? "—"}
                {d.account_number_last4 && <span className="ml-1 text-muted-foreground">••{d.account_number_last4}</span>}
              </TableCell>
              <TableCell className={`${cell} whitespace-nowrap`}>{d.bank_name ?? "—"}</TableCell>
              <TableCell className={`${cell} whitespace-nowrap font-mono`}>{d.period_start ?? "—"}</TableCell>
              <TableCell className={`${cell} whitespace-nowrap font-mono`}>{d.period_end ?? "—"}</TableCell>
              <TableCell className={num}>{money(d.opening_balance, d.currency)}</TableCell>
              <TableCell className={num}>{money(d.total_deposits, d.currency)}</TableCell>
              <TableCell className={num}>{money(d.total_withdrawals, d.currency)}</TableCell>
              <TableCell className={num}>{money(d.fees_total, d.currency)}</TableCell>
              <TableCell className={num}>{money(d.closing_balance, d.currency)}</TableCell>
              <TableCell className={num}>{d.transaction_count ?? "—"}</TableCell>
              <TableCell className={`${cell} whitespace-nowrap`}>
                <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{d.status}</Badge>
                {d.status === "done" && d.reconciled === 0 && <Badge variant="outline" className="ml-1">check</Badge>}
                {d.status === "done" && d.reconciled === null && (
                  <Badge variant="outline" className="ml-1" title="Balances couldn't be checked">unverified</Badge>
                )}
                {d.duplicate_of && (
                  <Badge variant="outline" className="ml-1 border-amber-500 text-amber-600" title="The identical file was uploaded by another user first">
                    same file
                  </Badge>
                )}
                {d.pdf_flags && d.pdf_flags.length > 0 && (
                  <Badge variant="outline" className="ml-1 border-destructive text-destructive" title={d.pdf_flags.join("; ")}>
                    pdf?
                  </Badge>
                )}
                {d.superseded ? (
                  <Badge variant="outline" className="ml-1" title="Covered entirely by an earlier upload of the same account. Left out of totals.">
                    duplicate
                  </Badge>
                ) : d.overlap_count ? (
                  <Badge variant="outline" className="ml-1 border-amber-500 text-amber-600" title={`Overlaps ${d.overlap_count} other statement(s). Overlapping days are counted once.`}>
                    overlap
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className={`${cell} whitespace-nowrap`}>{d.owner_email}</TableCell>
              <TableCell className={`${cell} max-w-[12rem] truncate`}>
                <Link href={`/documents/${d.id}`} className="hover:underline" title={d.file_name}>
                  {d.file_name}
                </Link>
              </TableCell>
              <TableCell className={`${cell} whitespace-nowrap font-mono`}>
                {new Date(d.created_at).toISOString().slice(0, 10)}
              </TableCell>
              <TableCell className="px-2 py-1">
                <ConfirmAction
                  label="Delete"
                  destructive
                  title={`Delete ${d.file_name}?`}
                  description={`This removes ${d.owner_email}'s saved result. This can't be undone.`}
                  onConfirm={async () => {
                    const err = await adminRequest(`/api/admin/documents/${d.id}`, "DELETE");
                    if (!err) router.refresh();
                    return err;
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
