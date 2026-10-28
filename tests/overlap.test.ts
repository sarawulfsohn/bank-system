import { describe, expect, test } from "bun:test";
import { overlapStatements } from "../src/lib/overlap";
import { addDoc, addTxn, addUser, migratedDb } from "./helpers";

function recompute(db: ReturnType<typeof migratedDb>, scope?: [string, string]) {
  for (const sql of overlapStatements(Boolean(scope))) db.run(sql, scope ?? []);
}

const flags = (db: ReturnType<typeof migratedDb>) =>
  Object.fromEntries(
    (db.query("SELECT id, superseded, overlap_count FROM documents ORDER BY id").all() as { id: string; superseded: number; overlap_count: number }[]).map(
      (r) => [r.id, [r.superseded, r.overlap_count]]
    )
  );
const counted = (db: ReturnType<typeof migratedDb>, doc: string) =>
  (db.query("SELECT line_no, counted FROM transactions WHERE document_id = ? ORDER BY line_no").all(doc) as { counted: number }[]).map((r) => r.counted);

describe("overlap flags", () => {
  test("an identical later upload is superseded, the earlier one is not", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100 });
    addDoc(db, { id: "b", start: "2026-01-01", end: "2026-01-31", created: 200 });
    recompute(db);
    expect(flags(db)).toEqual({ a: [0, 1], b: [1, 1] });
  });

  test("a partial overlap is flagged on both but superseded on neither, and the overlapping days count once", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100 });
    addDoc(db, { id: "c", start: "2026-01-15", end: "2026-02-15", created: 300 });
    addTxn(db, "a", 1, "2026-01-05");
    addTxn(db, "a", 2, "2026-01-20");
    addTxn(db, "c", 1, "2026-01-20"); // already covered by a
    addTxn(db, "c", 2, "2026-02-10");
    recompute(db);
    expect(flags(db)).toEqual({ a: [0, 1], c: [0, 1] });
    expect(counted(db, "a")).toEqual([1, 1]);
    expect(counted(db, "c")).toEqual([0, 1]);
  });

  test("different accounts, banks or missing last 4 digits never match", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100 });
    addDoc(db, { id: "b", start: "2026-01-01", end: "2026-01-31", created: 200, last4: "9999" });
    addDoc(db, { id: "c", start: "2026-01-01", end: "2026-01-31", created: 300, bankKey: "wellsfargo" });
    addDoc(db, { id: "d", start: "2026-01-01", end: "2026-01-31", created: 400, last4: null });
    addDoc(db, { id: "e", start: "2026-01-01", end: "2026-01-31", created: 500, last4: null });
    recompute(db);
    expect(flags(db)).toEqual({ a: [0, 0], b: [0, 0], c: [0, 0], d: [0, 0], e: [0, 0] });
  });

  test("failed statements are ignored", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100, status: "failed" });
    addDoc(db, { id: "b", start: "2026-01-01", end: "2026-01-31", created: 200 });
    recompute(db);
    expect(flags(db)).toEqual({ a: [0, 0], b: [0, 0] });
  });

  test("an identical creation time is broken by id so exactly one copy survives", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100 });
    addDoc(db, { id: "b", start: "2026-01-01", end: "2026-01-31", created: 100 });
    recompute(db);
    const f = flags(db);
    expect(f.a[0] + f.b[0]).toBe(1);
  });

  test("scoped recompute only touches that account and removing the first copy restores the second", () => {
    const db = migratedDb();
    addUser(db);
    addDoc(db, { id: "a", start: "2026-01-01", end: "2026-01-31", created: 100 });
    addDoc(db, { id: "b", start: "2026-01-01", end: "2026-01-31", created: 200 });
    addDoc(db, { id: "z", start: "2026-01-01", end: "2026-01-31", created: 300, last4: "9999" });
    db.run("UPDATE documents SET superseded = 1 WHERE id = 'z'"); // stale value outside the scope
    recompute(db, ["1234", "chase"]);
    expect(flags(db).b[0]).toBe(1);
    expect(flags(db).z[0]).toBe(1); // untouched

    db.run("DELETE FROM documents WHERE id = 'a'");
    recompute(db, ["1234", "chase"]);
    expect(flags(db).b).toEqual([0, 0]);
  });
});
