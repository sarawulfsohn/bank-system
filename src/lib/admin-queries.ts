import { DOC_COLUMNS, DOC_FROM, getBindings, hydrateDocument } from "./db";
import { EXPORT_LIMIT, PAGE_SIZE, type Filters } from "./filters";
import type { ClientSummary, DataRow, FilterOptions, SummaryTotals } from "./admin-types";

// URL / filter value for statements with no readable account holder (client_key = '')
export const UNKNOWN = "(unknown)";
export const CLIENT_LIMIT = 500;
export const MONTHLY_LIMIT = 1000;

// Escape LIKE wildcards so a search for "50%" means 50%
const like = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

type Where = { conds: string[]; args: (string | number)[] };

// Statement-level conditions on documents d / users u. Overlap and duplicate handling is a
// precomputed column (see overlap.ts): superseded = 1 means an earlier upload covers it fully.
function docWhere(f: Filters, opts: { dates: boolean; text: boolean; dedupe?: boolean }): Where {
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (opts.dedupe && !f.dups) conds.push("d.superseded = 0");
  if (f.client) {
    conds.push("d.client_key = ?");
    args.push(f.client === UNKNOWN ? "" : f.client);
  }
  if (f.bank) { conds.push("d.bank_name = ?"); args.push(f.bank); }
  if (f.owner) { conds.push("u.email = ?"); args.push(f.owner); }
  if (f.status) { conds.push("d.status = ?"); args.push(f.status); }
  if (f.reconciled === "yes") conds.push("d.reconciled = 1");
  if (f.reconciled === "no") conds.push("d.reconciled = 0");
  if (f.reconciled === "unknown") conds.push("d.status = 'done' AND d.reconciled IS NULL");
  // a statement matches a date range when its period overlaps it
  if (opts.dates && f.from) { conds.push("d.period_end >= ?"); args.push(f.from); }
  if (opts.dates && f.to) { conds.push("d.period_start <= ?"); args.push(f.to); }
  if (opts.text && f.q) {
    conds.push(
      "(d.file_name LIKE ? ESCAPE '\\' OR d.account_holder LIKE ? ESCAPE '\\' OR d.bank_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')"
    );
    args.push(like(f.q), like(f.q), like(f.q), like(f.q));
  }
  return { conds, args };
}

const whereSql = (conds: string[]) => (conds.length ? `WHERE ${conds.join(" AND ")}` : "");
const dirSql = (f: Filters) => (f.dir === "asc" ? "ASC" : "DESC");
const paging = (f: Filters, all: boolean) =>
  all ? `LIMIT ${EXPORT_LIMIT}` : `LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`;

const DOC_SORT: Record<string, string> = {
  owner: "u.email", file: "d.file_name", client: "d.account_holder", bank: "d.bank_name",
  start: "d.period_start", end: "d.period_end", opening: "d.opening_balance", closing: "d.closing_balance",
  deposits: "d.total_deposits", withdrawals: "d.total_withdrawals", fees: "d.fees_total",
  txns: "d.transaction_count", status: "d.status", uploaded: "d.created_at",
};

// Statement grid: one row per uploaded statement
export async function queryDocuments(f: Filters, all = false) {
  const { env } = await getBindings();
  const w = docWhere(f, { dates: true, text: true });
  const where = whereSql(w.conds);
  const order = `${DOC_SORT[f.sort] ?? "d.created_at"} ${dirSql(f)}, d.id`;
  const [rows, count] = await env.DB.batch([
    env.DB.prepare(`SELECT ${DOC_COLUMNS} ${DOC_FROM} ${where} ORDER BY ${order} ${paging(f, all)}`).bind(...w.args),
    env.DB.prepare(`SELECT COUNT(*) AS n ${DOC_FROM} ${where}`).bind(...w.args),
  ]);
  return {
    rows: (rows.results ?? []).map((r) => hydrateDocument(r as Record<string, unknown>, true)),
    total: (count.results?.[0] as { n: number } | undefined)?.n ?? 0,
  };
}

export async function getSummaryTotals(f: Filters): Promise<SummaryTotals> {
  const { env } = await getBindings();
  const w = docWhere(f, { dates: true, text: true });
  // Statements fully covered by an earlier upload of the same account are left out unless asked for
  const keep = f.dups ? "1" : "d.superseded = 0";
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(${keep}), 0) AS statements,
            COUNT(DISTINCT CASE WHEN ${keep} THEN d.client_key END) AS clients,
            COALESCE(SUM(CASE WHEN ${keep} THEN d.total_deposits END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN ${keep} THEN d.total_withdrawals END), 0) AS withdrawals,
            COALESCE(SUM(CASE WHEN ${keep} THEN d.fees_total END), 0) AS fees,
            COALESCE(SUM(CASE WHEN ${keep} THEN d.interest_total END), 0) AS interest,
            COALESCE(SUM(CASE WHEN ${keep} THEN d.reconciled = 0 END), 0) AS unreconciled,
            COALESCE(SUM(CASE WHEN ${keep} AND d.status = 'done' AND d.reconciled IS NULL THEN 1 END), 0) AS unverified,
            COALESCE(SUM(d.status = 'failed'), 0) AS failed,
            COALESCE(SUM(NOT (${keep})), 0) AS excluded,
            COALESCE(SUM(d.overlap_count > 0), 0) AS overlapping,
            COUNT(DISTINCT CASE WHEN ${keep} THEN d.currency END) AS currencies
       ${DOC_FROM} ${whereSql(w.conds)}`
  ).bind(...w.args).first<SummaryTotals>();
  return row ?? { statements: 0, clients: 0, deposits: 0, withdrawals: 0, fees: 0, interest: 0, unreconciled: 0, unverified: 0, failed: 0, excluded: 0, overlapping: 0, currencies: 0 };
}

// One row per client (normalised account holder) over the statements that match the filters
export async function getClientSummaries(f: Filters): Promise<ClientSummary[]> {
  const { env } = await getBindings();
  const w = docWhere(f, { dates: true, text: true, dedupe: true });
  const { results } = await env.DB.prepare(
    `SELECT CASE WHEN d.client_key = '' THEN '${UNKNOWN}' ELSE d.client_key END AS client,
            COALESCE(NULLIF(MAX(d.account_holder), ''), '${UNKNOWN}') AS name,
            COUNT(*) AS statements,
            GROUP_CONCAT(DISTINCT d.bank_name) AS banks,
            MIN(d.period_start) AS first_period,
            MAX(d.period_end) AS last_period,
            COALESCE(SUM(d.total_deposits), 0) AS deposits,
            COALESCE(SUM(d.total_withdrawals), 0) AS withdrawals,
            COALESCE(SUM(d.fees_total), 0) AS fees,
            AVG(d.total_deposits) AS avg_deposits,
            (SELECT d2.closing_balance FROM documents d2
               WHERE d2.client_key = d.client_key AND d2.status = 'done' AND d2.superseded = 0
               ORDER BY d2.period_end DESC LIMIT 1) AS last_closing,
            COALESCE(SUM(d.reconciled = 0), 0) AS unreconciled
       ${DOC_FROM} ${whereSql(w.conds)}
      GROUP BY d.client_key
      ORDER BY deposits DESC
      LIMIT ${CLIENT_LIMIT}`
  ).bind(...w.args).all<ClientSummary>();
  return results ?? [];
}

const TXN_FROM = "FROM transactions t JOIN documents d ON d.id = t.document_id JOIN users u ON u.id = d.user_id";

const TXN_SORT: Record<string, string> = {
  date: "t.txn_date", client: "d.account_holder", bank: "d.bank_name", owner: "u.email",
  description: "t.description", category: "t.category", type: "t.type", amount: "t.amount",
  balance: "t.balance_after", reference: "t.reference", file: "d.file_name",
};

function txnWhere(f: Filters): Where {
  const w = docWhere(f, { dates: false, text: false });
  const conds = [...w.conds];
  const args = [...w.args];
  if (f.from) { conds.push("t.txn_date >= ?"); args.push(f.from); }
  if (f.to) { conds.push("t.txn_date <= ?"); args.push(f.to); }
  if (f.category) { conds.push("t.category = ?"); args.push(f.category); }
  if (f.type) { conds.push("t.type = ?"); args.push(f.type); }
  if (f.min) { conds.push("t.amount >= ?"); args.push(Number(f.min)); }
  if (f.max) { conds.push("t.amount <= ?"); args.push(Number(f.max)); }
  if (f.q) {
    conds.push("(t.description LIKE ? ESCAPE '\\' OR t.reference LIKE ? ESCAPE '\\')");
    args.push(like(f.q), like(f.q));
  }
  // Days already covered by an earlier upload of the same account are counted once
  if (!f.dups) conds.push("t.counted = 1");
  return { conds, args };
}

// Heuristic keyword flags on transaction descriptions (not a substitute for reading the statement)
const NSF_SQL =
  "(t.description LIKE '%NSF%' OR t.description LIKE '%overdraft%' OR t.description LIKE '%insufficient%' OR t.description LIKE '%returned item%' OR t.description LIKE '%return item%')";
const FINANCING_SQL =
  "(t.type = 'debit' AND (t.description LIKE '%advance%' OR t.description LIKE '%capital%' OR t.description LIKE '%funding%' OR t.description LIKE '%loan%' OR t.description LIKE '%lending%'))";

export type MonthlyRow = {
  client: string; // client key (UNKNOWN when there is no readable holder)
  name: string;
  month: string;
  deposits: number;
  withdrawals: number;
  txns: number;
  deposit_count: number;
  min_balance: number | null;
  fees: number;
  nsf: number;
  financing: number;
};

const MONTHLY_SELECT = `SELECT CASE WHEN d.client_key = '' THEN '${UNKNOWN}' ELSE d.client_key END AS client,
       COALESCE(NULLIF(MAX(d.account_holder), ''), '${UNKNOWN}') AS name,
       substr(t.txn_date, 1, 7) AS month,
       COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount END), 0) AS deposits,
       COALESCE(SUM(CASE WHEN t.type = 'debit' THEN t.amount END), 0) AS withdrawals,
       COUNT(*) AS txns,
       SUM(t.type = 'credit') AS deposit_count,
       MIN(t.balance_after) AS min_balance,
       COALESCE(SUM(CASE WHEN t.category = 'fee' THEN t.amount END), 0) AS fees,
       COALESCE(SUM(${NSF_SQL}), 0) AS nsf,
       COALESCE(SUM(${FINANCING_SQL}), 0) AS financing`;

// Client x calendar month, from the transaction dates, with overlapping days counted once
export async function queryMonthly(f: Filters, all = false): Promise<MonthlyRow[]> {
  const { env } = await getBindings();
  const w = txnWhere(f);
  const conds = ["t.txn_date IS NOT NULL", ...w.conds];
  const { results } = await env.DB.prepare(
    `${MONTHLY_SELECT} ${TXN_FROM} ${whereSql(conds)}
      GROUP BY d.client_key, substr(t.txn_date, 1, 7)
      ORDER BY name, month DESC LIMIT ${all ? EXPORT_LIMIT : MONTHLY_LIMIT}`
  ).bind(...w.args).all<MonthlyRow>();
  return results ?? [];
}

export type ClientDetail = {
  months: MonthlyRow[];
  missingMonths: string[];
  flagged: DataRow[];
  topDeposits: DataRow[];
};

const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

export async function getClientDetail(client: string): Promise<ClientDetail> {
  const { env } = await getBindings();
  const key = client === UNKNOWN ? "" : client;
  const base = "d.client_key = ? AND t.txn_date IS NOT NULL AND t.counted = 1";
  const cols = `t.document_id, t.line_no, t.txn_date, t.description, t.amount, t.type, t.category, t.reference,
       t.balance_after, d.account_holder AS client, d.bank_name, d.account_number_last4, d.currency,
       u.email AS owner_email, d.file_name`;
  const [months, flagged, top] = await env.DB.batch([
    env.DB.prepare(`${MONTHLY_SELECT} ${TXN_FROM} WHERE ${base} GROUP BY substr(t.txn_date, 1, 7) ORDER BY month DESC LIMIT 240`).bind(key),
    env.DB.prepare(`SELECT ${cols} ${TXN_FROM} WHERE ${base} AND (${NSF_SQL} OR ${FINANCING_SQL}) ORDER BY t.txn_date DESC LIMIT 100`).bind(key),
    env.DB.prepare(`SELECT ${cols} ${TXN_FROM} WHERE ${base} AND t.type = 'credit' ORDER BY t.amount DESC LIMIT 10`).bind(key),
  ]);
  const rows = (months.results ?? []) as MonthlyRow[];
  // months with no transactions between the first and last month we have
  const have = new Set(rows.map((r) => r.month));
  const missingMonths: string[] = [];
  if (rows.length > 1) {
    for (let m = rows[rows.length - 1].month; m < rows[0].month; m = nextMonth(m)) if (!have.has(m)) missingMonths.push(m);
  }
  return {
    months: rows,
    missingMonths,
    flagged: (flagged.results ?? []) as DataRow[],
    topDeposits: (top.results ?? []) as DataRow[],
  };
}

// Transaction grid. Date filters apply to each transaction's own date.
export async function queryTransactions(f: Filters, all = false) {
  const { env } = await getBindings();
  const { conds, args } = txnWhere(f);
  const where = whereSql(conds);
  const order = `${TXN_SORT[f.sort] ?? "t.txn_date"} ${dirSql(f)}, t.document_id, t.line_no`;
  const [rows, sums] = await env.DB.batch([
    env.DB.prepare(
      `SELECT t.document_id, t.line_no, t.txn_date, t.description, t.amount, t.type, t.category, t.reference,
              t.balance_after, d.account_holder AS client, d.bank_name, d.account_number_last4, d.currency,
              u.email AS owner_email, d.file_name
         ${TXN_FROM} ${where} ORDER BY ${order} ${paging(f, all)}`
    ).bind(...args),
    env.DB.prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount END), 0) AS credits,
              COALESCE(SUM(CASE WHEN t.type = 'debit' THEN t.amount END), 0) AS debits
         ${TXN_FROM} ${where}`
    ).bind(...args),
  ]);
  const s = (sums.results?.[0] ?? {}) as { n?: number; credits?: number; debits?: number };
  return {
    rows: (rows.results ?? []) as DataRow[],
    total: s.n ?? 0,
    credits: s.credits ?? 0,
    debits: s.debits ?? 0,
  };
}

export async function getFilterOptions(): Promise<FilterOptions> {
  const { env } = await getBindings();
  const [clients, banks, owners, cats] = await env.DB.batch([
    env.DB.prepare(
      "SELECT client_key AS value, MAX(account_holder) AS label FROM documents WHERE client_key != '' GROUP BY client_key ORDER BY 2 LIMIT 1000"
    ),
    env.DB.prepare("SELECT DISTINCT bank_name AS v FROM documents WHERE bank_name IS NOT NULL AND bank_name != '' ORDER BY 1 LIMIT 500"),
    env.DB.prepare("SELECT DISTINCT u.email AS v FROM users u JOIN documents d ON d.user_id = u.id ORDER BY 1 LIMIT 1000"),
    env.DB.prepare("SELECT DISTINCT category AS v FROM transactions ORDER BY 1 LIMIT 50"),
  ]);
  const vals = (r: D1Result) => (r.results ?? []).map((x) => (x as { v: string }).v);
  return {
    clients: (clients.results ?? []) as { value: string; label: string }[],
    banks: vals(banks),
    owners: vals(owners),
    categories: vals(cats),
  };
}
