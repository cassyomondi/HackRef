// PostgreSQL integer range. API money is always integer USD cents.
export const MAX_CENTS = 2_147_483_647;

export function usdToCents(value: string): number {
  if (!value) throw new Error("Enter a USD amount; use 0.00 for no prize funds.");
  if (value.startsWith("-")) throw new Error("USD amounts cannot be negative.");
  if (/^\d+\.\d{3,}$/.test(value))
    throw new Error("Use at most two decimal places. Amounts are never rounded.");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Use digits and an optional decimal point, for example 1.50. Do not use commas, spaces or exponents.");
  const [whole, fraction = ""] = value.split(".");
  const significant = whole.replace(/^0+/, "") || "0";
  if (significant.length > 8) throw new Error("The maximum is USD 21,474,836.47.");
  const cents = BigInt(significant) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(MAX_CENTS)) throw new Error("The maximum is USD 21,474,836.47.");
  return Number(cents);
}

export function centsToUsdInput(cents: number): string {
  const value = BigInt(cents);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function formatUsd(cents: number): string {
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `USD ${value < 0n ? "−" : ""}${(absolute / 100n).toLocaleString("en-US")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function maskRecipient(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain?.slice(0, 1) ?? ""}•••`;
}
