export type DocStatus = "processing" | "done" | "failed";

export type Role = "user" | "admin";

export type User = { id: string; email: string; role: Role };

export type AdminUserRow = {
  id: string;
  email: string;
  role: Role;
  disabled: number;
  created_at: number;
  last_login_at: number | null;
  totp_enabled: number;
  document_count: number;
};

export type AdminStats = {
  total_users: number;
  total_documents: number;
  by_status: { status: DocStatus; n: number }[];
  by_model: { model: string; n: number }[];
  avg_duration_ms: number | null;
  failed_last_24h: number;
};

export type TxType = "credit" | "debit";

export type Transaction = {
  line_no: number;
  txn_date: string | null;
  description: string;
  amount: number; // always positive; credit = +, debit = -
  type: TxType;
  category: string;
  reference: string | null;
  balance_after: number | null;
};

export type DocRecord = {
  id: string;
  user_id: string;
  owner_email?: string;
  file_hash: string;
  file_name: string;
  file_size: number;
  model: string;
  status: DocStatus;
  error: string | null;
  bank_name: string | null;
  account_holder: string | null;
  account_type: string | null;
  account_number_last4: string | null;
  period_start: string | null;
  period_end: string | null;
  currency: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  fees_total: number | null;
  interest_total: number | null;
  transaction_count: number | null;
  reconciled: number | null;
  notable_items: string[];
  text_chars: number | null;
  page_count: number | null;
  duration_ms: number | null;
  created_at: number;
  updated_at: number;
  // Admin-only (stripped for applicants): how the PDF was produced, duplicates and overlaps
  duplicate_of?: string | null; // same file first uploaded by someone else
  overlap_count?: number;
  overlap_with?: string | null;
  superseded?: number;
  client_key?: string;
  pdf_producer?: string | null;
  pdf_creator?: string | null;
  pdf_flags?: string[];
  pdf_stored?: number;
  transactions?: Transaction[]; // only loaded for a single document
};
