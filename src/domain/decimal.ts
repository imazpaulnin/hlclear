import Decimal from "decimal.js";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP
});

export { Decimal };

export function dec(value: Decimal.Value | undefined | null): Decimal {
  if (value === undefined || value === null || value === "") {
    return new Decimal(0);
  }
  return new Decimal(value);
}

export function formatMoney(decimal: Decimal, digits = 2): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, 6)
  }).format(Number(decimal.toFixed(Math.max(digits, 6))));
}

export function formatNumber(decimal: Decimal, digits = 6): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(Number(decimal.toFixed(digits)));
}
