// Matching keys for names the AI reads off statements ("ACME, LLC" vs "Acme LLC").
// These must stay in step with the SQL in migrations/0005_hardening.sql, which backfills
// the same keys for existing rows: same steps, same order.

const STRIP = /[ ,.'"\-&/]/g;
const LEGAL_SUFFIXES = ["incorporated", "llc", "inc", "corp", "ltd"];
const BANK_WORDS = ["jpmorgan", "bank", "national", "association"];

const base = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(STRIP, "");

// "Acme Roofing, LLC" -> "acmeroofing"
export function clientKey(name: string | null | undefined): string {
  const k = base(name);
  const suffix = LEGAL_SUFFIXES.find((w) => k.endsWith(w));
  return suffix ? k.slice(0, k.length - suffix.length) : k;
}

// "JPMorgan Chase Bank, N.A." -> "chase", "Chase" -> "chase"
export function bankKey(name: string | null | undefined): string {
  let k = base(name);
  for (const w of BANK_WORDS) k = k.split(w).join("");
  return k.endsWith("na") ? k.slice(0, -2) : k;
}
