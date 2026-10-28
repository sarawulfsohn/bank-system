CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',   -- processing | done | failed
  error TEXT,
  bank_name TEXT,
  account_holder TEXT,
  account_type TEXT,
  account_number_last4 TEXT,
  period_start TEXT,
  period_end TEXT,
  currency TEXT,
  opening_balance REAL,
  closing_balance REAL,
  total_deposits REAL,
  total_withdrawals REAL,
  fees_total REAL,
  transaction_count INTEGER,
  reconciled INTEGER,                          -- 1 = balances add up, 0 = they don't, NULL = can't tell
  notable_items TEXT,                          -- JSON array of strings
  raw_json TEXT,
  text_chars INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
