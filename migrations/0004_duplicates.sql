-- Set when another user uploaded the identical file first: the new row is a copy of
-- that result (no AI call) and points back at the original.
ALTER TABLE documents ADD COLUMN duplicate_of TEXT;

-- Finding statements of the same account that overlap in time
CREATE INDEX IF NOT EXISTS idx_documents_account ON documents(account_number_last4, bank_name);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
