import { FilterBar } from "@/components/admin/filter-bar";
import { MONTHLY_LIMIT, getFilterOptions, queryMonthly } from "@/lib/admin-queries";
import { parseFilters } from "@/lib/filters";
import { MonthlyTable } from "@/components/admin/monthly-table";

export const dynamic = "force-dynamic";

export default async function AdminMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const f = parseFilters(await searchParams);
  const [options, rows] = await Promise.all([getFilterOptions(), queryMonthly(f)]);

  return (
    <div className="space-y-4">
      <FilterBar f={f} options={options} action="/admin/monthly" mode="monthly" exportView="monthly" />
      <p className="text-xs text-muted-foreground">
        Grouped by transaction date. NSF and financing flags are keyword matches on descriptions, so treat them as
        pointers to check, not findings.
      </p>
      {rows.length >= MONTHLY_LIMIT && (
        <p className="text-xs text-muted-foreground">Showing the first {MONTHLY_LIMIT} rows. Narrow the filters or export the CSV for everything.</p>
      )}
      {rows.length === 0 ? (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">No transactions match these filters.</p>
      ) : (
        <MonthlyTable rows={rows} showClient />
      )}
    </div>
  );
}
