import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// An in-memory SQLite with every migration applied, in order, like D1 would have it
export function migratedDb() {
  const db = new Database(":memory:");
  const dir = join(import.meta.dir, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

export function addUser(db: Database, id = "u1") {
  db.run("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, 'x', 'user', 1)", [id, `${id}@example.com`]);
}

export type Doc = {
  id: string;
  user?: string;
  start: string;
  end: string;
  created: number;
  last4?: string | null;
  bankKey?: string;
  status?: string;
};

export function addDoc(db: Database, d: Doc) {
  db.run(
    `INSERT INTO documents (id, user_id, file_hash, file_name, file_size, model, status, account_number_last4,
       bank_key, period_start, period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'm', ?, ?, ?, ?, ?, ?, ?)`,
    [d.id, d.user ?? "u1", `hash-${d.id}`, `${d.id}.pdf`, d.status ?? "done", d.last4 === undefined ? "1234" : d.last4,
      d.bankKey ?? "chase", d.start, d.end, d.created, d.created]
  );
}

export function addTxn(db: Database, doc: string, line: number, date: string, amount = 100) {
  db.run(
    "INSERT INTO transactions (document_id, line_no, txn_date, description, amount, type, category) VALUES (?, ?, ?, 'x', ?, 'credit', 'deposit')",
    [doc, line, date, amount]
  );
}
