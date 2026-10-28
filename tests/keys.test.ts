import { describe, expect, test } from "bun:test";
import { bankKey, clientKey } from "../src/lib/keys";

describe("matching keys", () => {
  test("client names that differ only in punctuation, case or legal suffix match", () => {
    const k = clientKey("Acme Roofing LLC");
    for (const v of ["ACME ROOFING, L.L.C", "acme roofing llc", "Acme  Roofing, LLC", "Acme Roofing", "Acme Roofing Inc."])
      expect(clientKey(v)).toBe(k);
    expect(clientKey("Acme Roofing")).not.toBe(clientKey("Acme Plumbing"));
  });

  test("missing names give an empty key", () => {
    expect(clientKey(null)).toBe("");
    expect(clientKey("  ")).toBe("");
    expect(bankKey(undefined)).toBe("");
  });

  test("bank names match across the usual variants", () => {
    expect(bankKey("JPMorgan Chase Bank, N.A.")).toBe(bankKey("Chase"));
    expect(bankKey("Wells Fargo Bank, N.A.")).toBe(bankKey("Wells Fargo"));
    expect(bankKey("Chase")).not.toBe(bankKey("Wells Fargo"));
  });

  test("the SQL backfill in the migration gives exactly what the TypeScript gives", () => {
    const names = [
      "Acme Roofing LLC", "ACME ROOFING, L.L.C.", "O'Brien & Sons, Inc.", "Smith Incorporated", "Lincoln Corp",
      "Jane Q. Public", "Foo-Bar Ltd", "", "Wells Fargo Bank, N.A.", "JPMorgan Chase Bank, National Association",
      "Bank of America", "U.S. Bank", "Chase", "Navy Federal Credit Union",
    ];
    // Run the real 0005 migration over rows created before it existed
    const dir = require("node:path").join(import.meta.dir, "..", "migrations") + "/";
    const { Database } = require("bun:sqlite");
    const { readFileSync, readdirSync } = require("node:fs");
    const db = new Database(":memory:");
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    for (const f of files.filter((f: string) => f < "0005")) db.exec(readFileSync(dir + f, "utf8"));
    db.run("INSERT INTO users (id, email, password_hash, role, created_at) VALUES ('u', 'u@example.com', 'x', 'user', 1)");
    names.forEach((n, i) =>
      db.run(
        "INSERT INTO documents (id, user_id, file_hash, file_name, file_size, model, account_holder, bank_name, created_at, updated_at) VALUES (?, 'u', ?, 'f.pdf', 1, 'm', ?, ?, 1, 1)",
        [`d${i}`, `h${i}`, n || null, n || null]
      )
    );
    for (const f of files.filter((f: string) => f >= "0005")) db.exec(readFileSync(dir + f, "utf8"));
    const rows = db.query("SELECT account_holder, bank_name, client_key, bank_key FROM documents ORDER BY id").all();
    for (const r of rows) {
      expect(r.client_key).toBe(clientKey(r.account_holder));
      expect(r.bank_key).toBe(bankKey(r.bank_name));
    }
  });
});
