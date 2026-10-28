-- One row per transaction line read from a statement. The statement-level
-- details (bank, period, balances, totals) stay on the documents row.
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,                    -- order on the statement, from 1
  txn_date TEXT,                               -- YYYY-MM-DD
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),    -- always positive; the sign is in type
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),  -- credit = + money in, debit = - money out
  category TEXT NOT NULL DEFAULT 'other',      -- deposit | transfer | card | check | atm | fee | interest | payment | refund | other
  reference TEXT,                              -- check or reference number, if printed
  balance_after REAL,                          -- running balance printed on the line, if any
  UNIQUE (document_id, line_no)
);

CREATE INDEX idx_transactions_document ON transactions(document_id, line_no);

-- Details that were missing from the report row
ALTER TABLE documents ADD COLUMN interest_total REAL;
ALTER TABLE documents ADD COLUMN page_count INTEGER;
