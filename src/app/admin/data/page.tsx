import Link from "next/link";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pager } from "@/components/admin/pager";
import { SortHead } from "@/components/admin/sort-head";
import { Table, TableBody, TableCell, TableFooter, TableRow } from "@/components/ui/table";
import { getFilterOptions, queryTransactions } from "@/lib/admin-queries";
import { parseFilters } from "@/lib/filters";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const cell = "border-r px-2 py-1 text-xs last:border-r-0";
const num = `${cell} text-right font-mono tabular-nums`;

export default async function AdminDataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = parseFilters(await searchParams);
  const [options, data] = await Promise.all([getFilterOptions(), queryTransactions(f)]);
  const base = "/admin/data";
  const head = { f, base };

  return (
    <div className="space-y-4">
      <FilterBar f={f} options={options} action={base} mode="transactions" exportView="data" />

      {data.rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No transactions match these filters.</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <Table className="border-collapse">
            <thead>
              <tr className="border-b">
                <SortHead {...head} k="date">Date</SortHead>
                <SortHead {...head} k="client">Client</SortHead>
                <SortHead {...head} k="bank">Bank</SortHead>
                <SortHead {...head} k="description">Description</SortHead>
                <SortHead {...head} k="category">Category</SortHead>
                <SortHead {...head} k="reference">Ref</SortHead>
                <SortHead {...head} k="amount" right>Amount</SortHead>
                <SortHead {...head} k="type">In / out</SortHead>
                <SortHead {...head} k="balance" right>Balance</SortHead>
                <SortHead {...head} k="owner">Uploaded by</SortHead>
                <SortHead {...head} k="file">Statement</SortHead>
              </tr>
            </thead>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={`${r.document_id}-${r.line_no}`} className="odd:bg-muted/30">
                  <TableCell className={`${cell} whitespace-nowrap font-mono`}>{r.txn_date ?? "—"}</TableCell>
                  <TableCell className={`${cell} whitespace-nowrap`}>{r.client ?? "—"}</TableCell>
                  <TableCell className={`${cell} whitespace-nowrap`}>{r.bank_name ?? "—"}</TableCell>
                  <TableCell className={`${cell} max-w-[22rem] truncate`} title={r.description}>
                    {r.description}
                  </TableCell>
                  <TableCell className={`${cell} whitespace-nowrap`}>{r.category}</TableCell>
                  <TableCell className={`${cell} whitespace-nowrap font-mono`}>{r.reference ?? ""}</TableCell>
                  <TableCell
                    className={`${num} ${r.type === "credit" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
                  >
                    {r.type === "debit" ? "−" : "+"}
                    {money(r.amount, r.currency)}
                  </TableCell>
                  <TableCell className={`${cell} whitespace-nowrap`}>{r.type === "credit" ? "In" : "Out"}</TableCell>
                  <TableCell className={num}>{r.balance_after === null ? "" : money(r.balance_after, r.currency)}</TableCell>
                  <TableCell className={`${cell} whitespace-nowrap`}>{r.owner_email}</TableCell>
                  <TableCell className={`${cell} max-w-[10rem] truncate`}>
                    <Link href={`/documents/${r.document_id}`} className="hover:underline" title={r.file_name}>
                      {r.file_name}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="sticky bottom-0 bg-muted">
              <TableRow>
                <TableCell colSpan={11} className="px-2 py-1.5 text-xs">
                  All {data.total.toLocaleString("en-US")} matching rows: in{" "}
                  <span className="font-mono">{money(data.credits)}</span>, out{" "}
                  <span className="font-mono">{money(data.debits)}</span>, net{" "}
                  <span className="font-mono">{money(data.credits - data.debits)}</span>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
      <Pager f={f} base={base} total={data.total} />
    </div>
  );
}
