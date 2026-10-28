-- Hardening: precomputed matching keys and overlap flags, PDF provenance, 2FA, invites, audit log.
-- Keys must stay in step with src/lib/keys.ts; overlap flags with src/lib/overlap.ts.

-- Normalised names, so "ACME, LLC" and "Acme LLC" are one client and "JPMorgan Chase" matches "Chase"
ALTER TABLE documents ADD COLUMN client_key TEXT NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN bank_key TEXT NOT NULL DEFAULT '';
-- Precomputed overlap flags (see overlap.ts)
ALTER TABLE documents ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN overlap_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN counted INTEGER NOT NULL DEFAULT 1;
-- Where the original PDF came from: the PDF's own producer / creator fields and anything odd about them
ALTER TABLE documents ADD COLUMN pdf_producer TEXT;
ALTER TABLE documents ADD COLUMN pdf_creator TEXT;
ALTER TABLE documents ADD COLUMN pdf_flags TEXT;
ALTER TABLE documents ADD COLUMN pdf_stored INTEGER NOT NULL DEFAULT 0;   -- 1 = original kept in R2 under file_hash

UPDATE documents SET client_key = CASE WHEN replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') LIKE '%incorporated' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '')) - 12) WHEN replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') LIKE '%llc' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '')) - 3) WHEN replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') LIKE '%inc' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '')) - 3) WHEN replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') LIKE '%corp' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '')) - 4) WHEN replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') LIKE '%ltd' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '')) - 3) ELSE replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(account_holder, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', '') END, bank_key = CASE WHEN replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(bank_name, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 'jpmorgan', ''), 'bank', ''), 'national', ''), 'association', '') LIKE '%na' THEN substr(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(bank_name, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 'jpmorgan', ''), 'bank', ''), 'national', ''), 'association', ''), 1, length(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(bank_name, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 'jpmorgan', ''), 'bank', ''), 'national', ''), 'association', '')) - 2) ELSE replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(COALESCE(bank_name, '')), ' ', ''), ',', ''), '.', ''), '''', ''), '"', ''), '-', ''), '&', ''), '/', ''), 'jpmorgan', ''), 'bank', ''), 'national', ''), 'association', '') END;
UPDATE documents AS d SET
       superseded = CASE WHEN EXISTS (SELECT 1 FROM documents o WHERE o.id != d.id AND o.status = 'done' AND d.status = 'done'
  AND o.account_number_last4 IS NOT NULL AND o.account_number_last4 = d.account_number_last4
  AND o.bank_key = d.bank_key
  AND o.period_start IS NOT NULL AND o.period_end IS NOT NULL
  AND d.period_start IS NOT NULL AND d.period_end IS NOT NULL
         AND o.period_start <= d.period_start AND o.period_end >= d.period_end AND (o.created_at < d.created_at OR (o.created_at = d.created_at AND o.id < d.id))) THEN 1 ELSE 0 END,
       overlap_count = (SELECT COUNT(*) FROM documents o WHERE o.id != d.id AND o.status = 'done' AND d.status = 'done'
  AND o.account_number_last4 IS NOT NULL AND o.account_number_last4 = d.account_number_last4
  AND o.bank_key = d.bank_key
  AND o.period_start IS NOT NULL AND o.period_end IS NOT NULL
  AND d.period_start IS NOT NULL AND d.period_end IS NOT NULL
         AND o.period_start <= d.period_end AND o.period_end >= d.period_start)
     ;
UPDATE transactions AS t SET
       counted = CASE WHEN EXISTS (SELECT 1 FROM documents d, documents o WHERE d.id = t.document_id AND o.id != d.id AND o.status = 'done' AND d.status = 'done'
  AND o.account_number_last4 IS NOT NULL AND o.account_number_last4 = d.account_number_last4
  AND o.bank_key = d.bank_key
  AND o.period_start IS NOT NULL AND o.period_end IS NOT NULL
  AND d.period_start IS NOT NULL AND d.period_end IS NOT NULL
         AND o.period_start <= t.txn_date AND o.period_end >= t.txn_date AND (o.created_at < d.created_at OR (o.created_at = d.created_at AND o.id < d.id))) THEN 0 ELSE 1 END
     ;

CREATE INDEX IF NOT EXISTS idx_documents_account2 ON documents(account_number_last4, bank_key);
CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_key);
CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_counted ON transactions(counted, txn_date);

-- Admin two-factor (TOTP). The secret is stored encrypted.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;   -- last accepted 30 s step, so a code works only once

-- Single-use sign-up links created by admins
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,            -- SHA-256 hex of the token in the link
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Who did what. actor_email is copied so entries outlive the account.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at DESC);
