import { queryDocuments, queryMonthly, queryTransactions } from "@/lib/admin-queries";
import { audit } from "@/lib/audit";
import { errorResponse, requireAdmin } from "@/lib/auth";
import { EXPORT_LIMIT, parseFilters } from "@/lib/filters";

// Statement text comes from uploaded PDFs, so neutralise anything a spreadsheet would run as a formula
function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(req.url);
    const f = parseFilters(Object.fromEntries(url.searchParams));
    const v = url.searchParams.get("view");
    const view = v === "data" || v === "monthly" ? v : "summary";

    let csv: string;
    let rowCount = 0;
    if (view === "data") {
      const { rows } = await queryTransactions(f, true);
      rowCount = rows.length;
      csv = toCsv(
        ["Date", "Client", "Bank", "Account", "Description", "Category", "Reference", "Type", "Amount", "Balance", "Currency", "Uploaded by", "Statement"],
        rows.map((r) => [
          r.txn_date, r.client, r.bank_name, r.account_number_last4, r.description, r.category, r.reference,
          r.type, r.type === "debit" ? -r.amount : r.amount, r.balance_after, r.currency, r.owner_email, r.file_name,
        ])
      );
    } else if (view === "monthly") {
      const rows = await queryMonthly(f, true);
      rowCount = rows.length;
      csv = toCsv(
        ["Client", "Month", "Deposits", "Deposit count", "Withdrawals", "Net", "Lowest balance", "Fees", "NSF/overdraft", "Financing debits", "Transactions"],
        rows.map((r) => [
          r.name, r.month, r.deposits, r.deposit_count, r.withdrawals, r.deposits - r.withdrawals,
          r.min_balance, r.fees, r.nsf, r.financing, r.txns,
        ])
      );
    } else {
      const { rows } = await queryDocuments(f, true);
      rowCount = rows.length;
      csv = toCsv(
        ["Client", "Bank", "Account", "Period start", "Period end", "Opening", "Deposits", "Withdrawals", "Fees", "Interest", "Closing", "Transactions", "Status", "Reconciled", "Currency", "Uploaded by", "File", "Uploaded"],
        rows.map((d) => [
          d.account_holder, d.bank_name, d.account_number_last4, d.period_start, d.period_end, d.opening_balance,
          d.total_deposits, d.total_withdrawals, d.fees_total, d.interest_total, d.closing_balance, d.transaction_count,
          d.status, d.reconciled === null ? "" : d.reconciled ? "yes" : "no", d.currency, d.owner_email, d.file_name,
          new Date(d.created_at).toISOString(),
        ])
      );
    }

    if (rowCount >= EXPORT_LIMIT) csv += `"# Export stopped at ${EXPORT_LIMIT} rows; narrow the filters for the rest"\r\n`;
    await audit(admin, "export.csv", view, Object.fromEntries(url.searchParams));
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="statements-${view}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
