// Admin filters, shared by the pages, the CSV export and the SQL builders.
// Everything comes from the query string so a filtered view is a shareable link.

export type Filters = {
  q: string;
  client: string; // account holder as read from the statement
  bank: string;
  owner: string; // email of the user who uploaded
  status: string;
  reconciled: "" | "yes" | "no" | "unknown";
  from: string; // YYYY-MM-DD
  to: string;
  category: string;
  type: "" | "credit" | "debit";
  min: string;
  max: string;
  dups: "" | "1"; // 1 = count overlapping / duplicate statements too
  sort: string;
  dir: "asc" | "desc";
  page: number;
};

export const PAGE_SIZE = 100;
export const EXPORT_LIMIT = 50_000;

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const num = (v: string) => (v !== "" && Number.isFinite(Number(v)) ? v : "");

export function parseFilters(p: Params): Filters {
  const reconciled = one(p.reconciled);
  const type = one(p.type);
  return {
    q: one(p.q).trim().slice(0, 100),
    client: one(p.client).slice(0, 200),
    bank: one(p.bank).slice(0, 200),
    owner: one(p.owner).slice(0, 254),
    status: ["processing", "done", "failed"].includes(one(p.status)) ? one(p.status) : "",
    reconciled: reconciled === "yes" || reconciled === "no" || reconciled === "unknown" ? reconciled : "",
    from: date(one(p.from)),
    to: date(one(p.to)),
    category: one(p.category).slice(0, 40),
    type: type === "credit" || type === "debit" ? type : "",
    min: num(one(p.min)),
    max: num(one(p.max)),
    dups: one(p.dups) === "1" ? "1" : "",
    sort: one(p.sort).slice(0, 40),
    dir: one(p.dir) === "asc" ? "asc" : "desc",
    page: Math.max(1, Math.floor(Number(one(p.page))) || 1),
  };
}

// Query string for the current filters, with overrides (used for sort / page / export links)
export function filterQuery(f: Filters, over: Partial<Record<keyof Filters, string | number>> = {}) {
  const merged: Record<string, string | number> = { ...f, ...over };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === "" || v === undefined) continue;
    if (k === "page" && Number(v) === 1) continue;
    if (k === "dir" && !merged.sort) continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}
