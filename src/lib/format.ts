export function money(v: number | null | undefined, currency?: string | null) {
  if (v === null || v === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

// Fixed UTC format so server and client render identical text (no hydration mismatch)
export function dateTime(ms: number | null | undefined) {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function seconds(ms: number | null | undefined) {
  return ms ? `${(ms / 1000).toFixed(1)}s` : "—";
}
