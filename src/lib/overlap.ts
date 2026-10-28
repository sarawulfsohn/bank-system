// Overlapping and duplicate statements.
//
// Two statements are "the same account" when bank_key and the last 4 digits match
// (statements without last 4 digits are never matched: we can't tell accounts apart).
// The earlier upload wins, so exactly one copy of any day is counted:
//   documents.superseded    1 = fully covered by an earlier upload; left out of totals
//   documents.overlap_count how many other statements overlap this one
//   transactions.counted    0 = that day is already covered by an earlier upload
// The flags are recomputed whenever a statement is added, finished or deleted, so
// reading them is a plain column lookup.

const SAME = `o.id != d.id AND o.status = 'done' AND d.status = 'done'
  AND o.account_number_last4 IS NOT NULL AND o.account_number_last4 = d.account_number_last4
  AND o.bank_key = d.bank_key
  AND o.period_start IS NOT NULL AND o.period_end IS NOT NULL
  AND d.period_start IS NOT NULL AND d.period_end IS NOT NULL`;
const EARLIER = "(o.created_at < d.created_at OR (o.created_at = d.created_at AND o.id < d.id))";

// scope = recompute just one account (binds ?1 = last4, ?2 = bank_key); otherwise everything
export function overlapStatements(scoped: boolean): string[] {
  const docScope = scoped ? "WHERE d.account_number_last4 = ?1 AND d.bank_key = ?2" : "";
  const txnScope = scoped
    ? "WHERE t.document_id IN (SELECT id FROM documents WHERE account_number_last4 = ?1 AND bank_key = ?2)"
    : "";
  return [
    `UPDATE documents AS d SET
       superseded = CASE WHEN EXISTS (SELECT 1 FROM documents o WHERE ${SAME}
         AND o.period_start <= d.period_start AND o.period_end >= d.period_end AND ${EARLIER}) THEN 1 ELSE 0 END,
       overlap_count = (SELECT COUNT(*) FROM documents o WHERE ${SAME}
         AND o.period_start <= d.period_end AND o.period_end >= d.period_start)
     ${docScope}`,
    `UPDATE transactions AS t SET
       counted = CASE WHEN EXISTS (SELECT 1 FROM documents d, documents o WHERE d.id = t.document_id AND ${SAME}
         AND o.period_start <= t.txn_date AND o.period_end >= t.txn_date AND ${EARLIER}) THEN 0 ELSE 1 END
     ${txnScope}`,
  ];
}

export async function recomputeOverlap(env: CloudflareEnv, last4: string | null, bankKey: string | null) {
  if (!last4) return; // such statements are never matched, so there is nothing to update
  const [docs, txns] = overlapStatements(true);
  await env.DB.batch([
    env.DB.prepare(docs).bind(last4, bankKey ?? ""),
    env.DB.prepare(txns).bind(last4, bankKey ?? ""),
  ]);
}
