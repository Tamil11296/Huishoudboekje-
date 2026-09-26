export const eur = (v) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));

export const eur2 = (v) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));

export const pct = (v) => `${Number(v || 0).toFixed(1)}%`;

export function apiErr(e, fallback = "Er ging iets mis") {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d.map((x) => (x && x.msg ? x.msg : JSON.stringify(x))).join(" ");
  if (d && d.msg) return d.msg;
  return e?.message || fallback;
}
