// Time-based one-time passwords (RFC 6238: HMAC-SHA1, 6 digits, 30 s) with WebCrypto only.
// The secret is stored AES-GCM encrypted under a key derived from PASSWORD_PEPPER, so a leaked
// database alone doesn't reveal the second factor.

const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(bytes: Uint8Array) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string) {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out) as Uint8Array<ArrayBuffer>;
}

export const newSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)));

async function hotp(secret: string, counter: number) {
  const key = await crypto.subtle.importKey("raw", fromBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setBigUint64(0, BigInt(counter));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

// The current code for a secret (for tests and tooling; the app only verifies)
export const totpCode = (secret: string, now = Date.now()) => hotp(secret, Math.floor(now / 1000 / STEP_SECONDS));

// Returns the 30 s step the code belongs to (so the caller can refuse a replay), or null.
// Accepts the previous and next step to allow for clock drift.
export async function verifyTotp(secret: string, code: string, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const s of [step, step - 1, step + 1]) if ((await hotp(secret, s)) === code) return s;
  return null;
}

export const otpauthUri = (secret: string, email: string, issuer = "Statement Parser") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=${STEP_SECONDS}`;

// ---------- encryption at rest ----------

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function aesKey(pepper: string) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`totp-secret|${pepper}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(secret: string, pepper: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(pepper), new TextEncoder().encode(secret)));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(stored: string, pepper: string): Promise<string | null> {
  try {
    const [iv, ct] = stored.split(".");
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(pepper), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
