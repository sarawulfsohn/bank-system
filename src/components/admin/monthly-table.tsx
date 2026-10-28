import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MonthlyRow } from "@/lib/admin-queries";
import { money } from "@/lib/format";

const th = "h-8 whitespace-nowrap px-2 text-xs";
const td = "px-2 py-1 text-xs";
const num = `${td} text-right font-mono tabular-nums`;

// Client x month grid (or just months, on a client's own page)
export function MonthlyTable({ rows, showClient }: { rows: MonthlyRow[]; showClient?: boolean }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border">
      <Table className="border-collapse">
        <TableHeader className="sticky top-0 z-10 bg-muted">
          <TableRow>
            {showClient && <TableHead className={th}>Client</TableHead>}
            <TableHead className={th}>Month</TableHead>
            <TableHead className={`${th} text-right`}>Deposits</TableHead>
            <TableHead className={`${th} text-right`}># Deposits</TableHead>
            <TableHead className={`${th} text-right`}>Withdrawals</TableHead>
            <TableHead className={`${th} text-right`}>Net</TableHead>
            <TableHead className={`${th} text-right`}>Lowest balance</TableHead>
            <TableHead className={`${th} text-right`}>Fees</TableHead>
            <TableHead className={`${th} text-right`}>NSF / overdraft</TableHead>
            <TableHead className={`${th} text-right`}>Financing debits</TableHead>
            <TableHead className={`${th} text-right`}>Txns</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const net = r.deposits - r.withdrawals;
            return (
              <TableRow key={`${r.client}-${r.month}`} className="odd:bg-muted/30">
                {showClient && (
                  <TableCell className={`${td} whitespace-nowrap font-medium`}>
                    <Link href={`/admin/client?name=${encodeURIComponent(r.client)}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                )}
                <TableCell className={`${td} font-mono`}>{r.month}</TableCell>
                <TableCell className={num}>{money(r.deposits)}</TableCell>
                <TableCell className={num}>{r.deposit_count}</TableCell>
                <TableCell className={num}>{money(r.withdrawals)}</TableCell>
                <TableCell className={`${num} ${net < 0 ? "text-destructive" : ""}`}>{money(net)}</TableCell>
                <TableCell className={`${num} ${r.min_balance !== null && r.min_balance < 0 ? "text-destructive" : ""}`}>
                  {r.min_balance === null ? "—" : money(r.min_balance)}
                </TableCell>
                <TableCell className={num}>{money(r.fees)}</TableCell>
                <TableCell className={`${num} ${r.nsf ? "font-semibold text-destructive" : ""}`}>{r.nsf}</TableCell>
                <TableCell className={`${num} ${r.financing ? "font-semibold text-amber-600" : ""}`}>{r.financing}</TableCell>
                <TableCell className={num}>{r.txns}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
