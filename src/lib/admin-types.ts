import type { Transaction } from "./types";

// One row of the admin "all data" grid: a transaction plus its statement's details
export type DataRow = Transaction & {
  document_id: string;
  client: string | null;
  bank_name: string | null;
  account_number_last4: string | null;
  currency: string | null;
  owner_email: string;
  file_name: string;
};

export type SummaryTotals = {
  statements: number;
  clients: number;
  deposits: number;
  withdrawals: number;
  fees: number;
  interest: number;
  unreconciled: number;
  unverified: number; // finished, but balances couldn't be checked
  failed: number;
  excluded: number; // statements left out because an earlier upload covers them
  overlapping: number; // statements that overlap another one for the same account
  currencies: number; // distinct currencies among the counted statements
};

export type ClientSummary = {
  client: string; // client key, used in links and filters
  name: string; // display name
  statements: number;
  banks: string | null;
  first_period: string | null;
  last_period: string | null;
  deposits: number;
  withdrawals: number;
  fees: number;
  avg_deposits: number | null;
  last_closing: number | null;
  unreconciled: number;
};

export type FilterOptions = {
  clients: { value: string; label: string }[];
  banks: string[];
  owners: string[];
  categories: string[];
};
