import Link from "next/link";
import { TableHead } from "@/components/ui/table";
import { filterQuery, type Filters } from "@/lib/filters";
import { cn } from "@/lib/utils";

// Column header that sorts by its key; clicking the active column flips the direction
export function SortHead({
  f, base, k, children, right, className,
}: {
  f: Filters;
  base: string;
  k: string;
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  const active = f.sort === k;
  const next = active && f.dir === "asc" ? "desc" : "asc";
  return (
    <TableHead
      aria-sort={active ? (f.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("sticky top-0 z-10 h-8 whitespace-nowrap border-r bg-muted px-2 text-xs last:border-r-0", right && "text-right", className)}
    >
      <Link href={`${base}?${filterQuery(f, { sort: k, dir: next, page: 1 })}`} className="hover:underline">
        {children}
        {active && <span aria-hidden> {f.dir === "asc" ? "▲" : "▼"}</span>}
      </Link>
    </TableHead>
  );
}
