import Link from "next/link";
import { PAGE_SIZE, filterQuery, type Filters } from "@/lib/filters";

export function Pager({ f, base, total }: { f: Filters; base: string; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (f.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, f.page * PAGE_SIZE);
  const href = (p: number) => `${base}?${filterQuery(f, { page: p })}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total.toLocaleString("en-US")}
      </span>
      <span className="flex items-center gap-3">
        {f.page > 1 ? <Link href={href(f.page - 1)} className="hover:underline">← Previous</Link> : <span className="opacity-40">← Previous</span>}
        <span>Page {f.page} of {pages}</span>
        {f.page < pages ? <Link href={href(f.page + 1)} className="hover:underline">Next →</Link> : <span className="opacity-40">Next →</span>}
      </span>
    </div>
  );
}
