import { describe, expect, test } from "bun:test";
import { pdfProvenance, salvage, splitText } from "../src/lib/extract";
import { filterQuery, parseFilters } from "../src/lib/filters";
import { base32, decryptSecret, encryptSecret, fromBase32, verifyTotp } from "../src/lib/totp";

describe("splitText", () => {
  test("short text stays in one piece", () => {
    expect(splitText("# Page 1\nline one\nline two")).toHaveLength(1);
  });

  test("long text is split without losing or cutting any line", () => {
    const lines = Array.from({ length: 600 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, "0")} Payment number ${i} 12.34`);
    const text = lines.join("\n");
    const chunks = splitText(text);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.join("\n")).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThan(2500);
  });

  test("prefers to break at page headers", () => {
    const page = (n: number) => `# Page ${n}\n` + Array.from({ length: 20 }, (_, i) => `row ${n}-${i} amount 10.00`).join("\n");
    const chunks = splitText([1, 2, 3, 4].map(page).join("\n"));
    for (const c of chunks.slice(1)) expect(c.startsWith("# Page")).toBe(true);
  });
});

describe("pdfProvenance", () => {
  test("reads producer and creator and flags consumer editing tools", () => {
    const md = "## Metadata\n- Producer: Adobe Photoshop 25.0\n- Creator: Microsoft Word\n\n## Contents\nbody";
    const p = pdfProvenance(md);
    expect(p.producer).toBe("Adobe Photoshop 25.0");
    expect(p.flags.length).toBe(2);
  });

  test("reads the key=value form the converter prints", () => {
    const md = ["# f.pdf", "## Metadata", "- PDFFormatVersion=1.7", "- Producer=Sejda PDF Editor", "- Creator=Microsoft Word", "", "## Contents", "### Page 1", "x"].join("\n");
    const p = pdfProvenance(md);
    expect(p.producer).toBe("Sejda PDF Editor");
    expect(p.flags).toHaveLength(2);
  });

  test("does not flag a normal bank producer", () => {
    expect(pdfProvenance("## Metadata\nProducer: iText 5.5.13\nCreator: Oracle Reports\n\n## Contents\nx").flags).toEqual([]);
  });

  test("flags a file modified well after it was created", () => {
    const md = "## Metadata\nProducer: iText\nCreationDate: D:20260105120000\nModDate: D:20260301090000\n\n## Contents\nx";
    expect(pdfProvenance(md).flags).toContain("Modified after it was created");
  });
});

describe("filters", () => {
  test("rejects junk and keeps good values", () => {
    const f = parseFilters({ from: "not-a-date", to: "2026-02-01", min: "abc", max: "5", type: "weird", page: "-3", dir: "asc", dups: "1" });
    expect(f.from).toBe("");
    expect(f.to).toBe("2026-02-01");
    expect(f.min).toBe("");
    expect(f.max).toBe("5");
    expect(f.type).toBe("");
    expect(f.page).toBe(1);
    expect(f.dups).toBe("1");
  });

  test("filterQuery drops empty values and page 1 and applies overrides", () => {
    const f = parseFilters({ q: "rent", bank: "Chase" });
    expect(filterQuery(f)).toBe("q=rent&bank=Chase");
    expect(filterQuery(f, { page: 3 })).toBe("q=rent&bank=Chase&page=3");
  });
});

describe("totp", () => {
  const secret = base32(new TextEncoder().encode("12345678901234567890"));

  test("base32 round trips", () => {
    expect(new TextDecoder().decode(fromBase32(secret))).toBe("12345678901234567890");
  });

  test("matches the RFC 6238 test vector (time 59 s)", async () => {
    // RFC 6238 gives 94287082 for 8 digits, so the 6-digit code is 287082
    expect(await verifyTotp(secret, "287082", 59_000)).toBe(1);
  });

  test("accepts one step of drift, rejects older, wrong and malformed codes", async () => {
    expect(await verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(1);
    expect(await verifyTotp(secret, "287082", 59_000 + 90_000)).toBeNull();
    expect(await verifyTotp(secret, "000000", 59_000)).toBeNull();
    expect(await verifyTotp(secret, "12345", 59_000)).toBeNull();
  });

  test("a stored secret decrypts only with the same pepper", async () => {
    const stored = await encryptSecret("ABCDEF234567", "pepper-1");
    expect(await decryptSecret(stored, "pepper-1")).toBe("ABCDEF234567");
    expect(await decryptSecret(stored, "pepper-2")).toBeNull();
  });
});

describe("salvage", () => {
  test("keeps intact rows and header values from broken JSON", () => {
    const broken = '{"bank_name":"Maple Bank","opening_balance":100.5,"account_holder":null,"transactions":[["2026-03-01","Pay, ref 1",620,"credit","deposit",null,720.5],["2026-03-02","Card 2",-9,"debit","card",null,711.5] ["2026-03-03","Oops",5,"debit"';
    const r = salvage(broken)!;
    expect(r.bank_name).toBe("Maple Bank");
    expect(r.opening_balance).toBe(100.5);
    expect((r.transactions as unknown[]).length).toBe(2); // the truncated third row is dropped
  });

  test("gives up when nothing is recoverable", () => {
    expect(salvage("sorry, I cannot help with that")).toBeNull();
  });
});
