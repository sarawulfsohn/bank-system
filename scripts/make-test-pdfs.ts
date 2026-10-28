// Generates FAKE bank statement PDFs for testing (no real data, no dependencies).
// Usage: bun scripts/make-test-pdfs.ts [outDir]
//   statement.pdf    text-based statement that reconciles
//   statement-b.pdf  same layout, different numbers (distinct file hash)
//   scanned.pdf      image-only page with no text layer
//   corrupt.pdf      not a real PDF
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] ?? "test-fixtures";
mkdirSync(outDir, { recursive: true });

// Minimal single-page PDF writer with correct xref offsets
function buildPdf(content: string): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);
const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tx = [date: string, desc: string, amount: number];

function statement(opts: { number: string; opening: number; txs: Tx[]; scale?: number }) {
  const scale = opts.scale ?? 1;
  const txs = opts.txs.map(([d, s, a]) => [d, s, Math.round(a * scale * 100) / 100] as Tx);
  const lines: string[] = [];
  const text = (x: number, y: number, s: string, bold = false, size = 10) =>
    lines.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  const right = (x: number, y: number, s: string, bold = false) =>
    text(x - s.length * 5.2, y, s, bold);

  const deposits = txs.filter((t) => t[2] > 0).reduce((s, t) => s + t[2], 0);
  const withdrawals = -txs.filter((t) => t[2] < 0).reduce((s, t) => s + t[2], 0);
  const fees = -txs.filter((t) => /\bfee\b/i.test(t[1])).reduce((s, t) => s + t[2], 0);
  const closing = opts.opening + deposits - withdrawals;

  text(50, 740, "Maple Ridge Community Bank", true, 18);
  text(50, 722, "PO Box 4100, Springfield, OR 97477  |  (555) 010-2200  |  FAKE TEST DOCUMENT");
  text(50, 690, "Account holder: Jordan Q. Sample", true);
  text(50, 676, "123 Example Lane, Springfield, OR 97477");
  text(360, 690, "Everyday Checking", true);
  text(360, 676, "Account number: XXXX-XXXX-4821");
  text(360, 662, `Statement no. ${opts.number}`);
  text(360, 648, "Statement period: October 1, 2026 - October 31, 2026");

  text(50, 615, "Account Summary", true, 12);
  const summary: [string, number][] = [
    ["Beginning balance on 10/01/2026", opts.opening],
    ["Deposits and other credits", deposits],
    ["Withdrawals and other debits", -withdrawals],
    ["  includes service fees", -fees],
    ["Ending balance on 10/31/2026", closing],
  ];
  summary.forEach(([k, v], i) => {
    text(50, 598 - i * 14, k);
    right(330, 598 - i * 14, (v < 0 ? "-$" : "$") + fmt(Math.abs(v)));
  });
  text(50, 520, `Number of transactions this period: ${txs.length}`);

  text(50, 490, "Transaction Details", true, 12);
  let y = 472;
  text(50, y, "Date", true); text(110, y, "Description", true);
  right(430, y, "Amount", true); right(540, y, "Balance", true);
  let bal = opts.opening;
  for (const [d, s, a] of txs) {
    y -= 16;
    bal += a;
    text(50, y, d); text(110, y, s);
    right(430, y, (a < 0 ? "-" : "") + fmt(Math.abs(a)));
    right(540, y, fmt(bal));
  }
  y -= 30;
  text(50, y, "This statement was generated for software testing and contains no real customer data.");
  return buildPdf(lines.join("\n"));
}

const TXS: Tx[] = [
  ["10/01", "Direct Deposit - ACME Logistics Payroll", 2850.0],
  ["10/03", "Online Transfer - Rent, Oak Street Apartments", -1650.0],
  ["10/05", "Debit Card - Green Basket Grocery", -142.86],
  ["10/08", "ACH Payment - Springfield Electric Co", -96.4],
  ["10/12", "Mobile Check Deposit #1043", 325.0],
  ["10/15", "Direct Deposit - ACME Logistics Payroll", 2850.0],
  ["10/18", "Debit Card - Corner Coffee House", -6.75],
  ["10/20", "ACH Payment - Pinecrest Auto Insurance", -128.5],
  ["10/22", "Check #2211", -400.0],
  ["10/25", "Monthly Maintenance Fee", -12.0],
  ["10/28", "Transfer to Savings XXXX-7730", -500.0],
  ["10/31", "Interest Paid", 1.23],
];

writeFileSync(join(outDir, "statement.pdf"), statement({ number: "2026-10-0001", opening: 4215.37, txs: TXS }));
writeFileSync(
  join(outDir, "statement-b.pdf"),
  statement({ number: "2026-10-0002", opening: 1980.12, txs: TXS, scale: 0.8 })
);

// "Scanned" page: only drawn shapes, no text layer
const bars: string[] = ["0.2 g"];
for (let i = 0; i < 40; i++) {
  const w = 200 + ((i * 97) % 300);
  bars.push(`50 ${740 - i * 16} ${w} 8 re f`);
}
writeFileSync(join(outDir, "scanned.pdf"), buildPdf(bars.join("\n")));

writeFileSync(join(outDir, "corrupt.pdf"), Buffer.from("this is not really a pdf file\n".repeat(20)));

console.log(`Wrote fake test PDFs to ${outDir}/`);
