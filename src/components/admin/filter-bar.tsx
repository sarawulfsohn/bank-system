import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterQuery, type Filters } from "@/lib/filters";
import type { FilterOptions } from "@/lib/admin-types";

const field = "flex min-w-[9rem] flex-1 flex-col gap-1 text-xs text-muted-foreground";
const selectCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Select({ name, value, label, options }: { name: string; value: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <label className={field}>
      {label}
      <select name={name} defaultValue={value} className={selectCls}>
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const same = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

// A plain GET form: filters live in the URL, so a filtered view can be bookmarked or shared
export function FilterBar({
  f, options, action, mode, exportView,
}: {
  f: Filters;
  options: FilterOptions;
  action: string;
  mode: "statements" | "transactions" | "monthly";
  exportView: "summary" | "data" | "monthly";
}) {
  return (
    <form method="get" action={action} className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap gap-3">
        <label className={`${field} min-w-[14rem]`}>
          Search
          <Input name="q" defaultValue={f.q} placeholder={mode === "monthly" ? "Description contains, e.g. payroll" : mode === "transactions" ? "Description or reference" : "File, client, bank, uploader"} />
        </label>
        <Select name="client" value={f.client} label="Client" options={options.clients} />
        <Select name="bank" value={f.bank} label="Bank" options={same(options.banks)} />
        <Select name="owner" value={f.owner} label="Uploaded by" options={same(options.owners)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className={field}>
          {mode !== "statements" ? "Date from" : "Period from"}
          <Input type="date" name="from" defaultValue={f.from} />
        </label>
        <label className={field}>
          {mode !== "statements" ? "Date to" : "Period to"}
          <Input type="date" name="to" defaultValue={f.to} />
        </label>
        {mode === "statements" ? (
          <>
            <Select name="status" value={f.status} label="Status" options={same(["done", "processing", "failed"])} />
            <Select name="reconciled" value={f.reconciled} label="Balances" options={[{ value: "yes", label: "Reconciled" }, { value: "no", label: "Don't reconcile" }, { value: "unknown", label: "Couldn't verify" }]} />
          </>
        ) : mode === "monthly" ? null : (
          <>
            <Select name="category" value={f.category} label="Category" options={same(options.categories)} />
            <Select name="type" value={f.type} label="Type" options={[{ value: "credit", label: "Credit (in)" }, { value: "debit", label: "Debit (out)" }]} />
            <label className={`${field} min-w-[7rem]`}>
              Min amount
              <Input type="number" step="0.01" min="0" name="min" defaultValue={f.min} />
            </label>
            <label className={`${field} min-w-[7rem]`}>
              Max amount
              <Input type="number" step="0.01" min="0" name="max" defaultValue={f.max} />
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {f.sort && <input type="hidden" name="sort" value={f.sort} />}
        {f.sort && <input type="hidden" name="dir" value={f.dir} />}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="dups" value="1" defaultChecked={f.dups === "1"} />
          Include overlapping / duplicate statements
        </label>
        <Button type="submit" size="sm">Apply filters</Button>
        <Button asChild variant="ghost" size="sm"><Link href={action}>Clear</Link></Button>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={`/api/admin/export?view=${exportView}&${filterQuery(f, { page: 1 })}`}>Export CSV</a>
        </Button>
      </div>
    </form>
  );
}
