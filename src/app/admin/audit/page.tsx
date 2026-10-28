import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAudit } from "@/lib/audit";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const rows = await listAudit(300);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Admin sign-ins, exports, downloads of original statements, deletions and account changes. Newest first, last 300.
      </p>
      <div className="max-h-[70vh] overflow-auto rounded-md border">
        <Table className="border-collapse">
          <TableHeader className="sticky top-0 bg-muted">
            <TableRow>
              <TableHead className="h-8 px-2 text-xs">When</TableHead>
              <TableHead className="h-8 px-2 text-xs">Who</TableHead>
              <TableHead className="h-8 px-2 text-xs">Action</TableHead>
              <TableHead className="h-8 px-2 text-xs">Target</TableHead>
              <TableHead className="h-8 px-2 text-xs">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="odd:bg-muted/30">
                <TableCell className="whitespace-nowrap px-2 py-1 font-mono text-xs">{dateTime(r.at)}</TableCell>
                <TableCell className="px-2 py-1 text-xs">{r.actor_email ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap px-2 py-1 text-xs font-medium">{r.action}</TableCell>
                <TableCell className="max-w-[16rem] truncate px-2 py-1 font-mono text-xs" title={r.target ?? ""}>{r.target ?? ""}</TableCell>
                <TableCell className="max-w-[28rem] truncate px-2 py-1 font-mono text-xs" title={r.detail ?? ""}>{r.detail ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
