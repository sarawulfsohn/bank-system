-- Users, sessions and login rate limiting; documents become per-user.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,                  -- stored lowercased
  password_hash TEXT NOT NULL,                 -- pbkdf2$<iterations>$<saltB64>$<hashB64>
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                         -- SHA-256 hex of the session token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT NOT NULL,                           -- email|ip
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts(key, attempted_at);

-- Rebuild documents: UNIQUE(file_hash) becomes UNIQUE(user_id, file_hash) so one
-- user's upload can never return another user's cached result.
CREATE TABLE documents_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_hash TEXT NOT NULL,
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
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, file_hash)
);

-- Existing rows have no owner: give them to the first admin if one exists,
-- otherwise they are dropped (pre-auth dev data only).
INSERT INTO documents_new
SELECT d.id, (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1),
       d.file_hash, d.file_name, d.file_size, d.model, d.status, d.error,
       d.bank_name, d.account_holder, d.account_type, d.account_number_last4,
       d.period_start, d.period_end, d.currency, d.opening_balance, d.closing_balance,
       d.total_deposits, d.total_withdrawals, d.fees_total, d.transaction_count,
       d.reconciled, d.notable_items, d.raw_json, d.text_chars, d.duration_ms,
       d.created_at, d.updated_at
FROM documents d
WHERE EXISTS (SELECT 1 FROM users WHERE role = 'admin');

DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;

CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id, created_at DESC);
