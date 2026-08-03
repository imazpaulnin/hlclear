import { Decimal, dec, formatMoney } from "./decimal";
import type { MoneyValue } from "./types";

export function money(raw: string | Decimal, options?: { estimated?: boolean; digits?: number }): MoneyValue {
  const exact = raw instanceof Decimal ? raw : dec(raw);
  return {
    raw: raw instanceof Decimal ? exact.toString() : raw,
    exact,
    rounded: formatMoney(exact, options?.digits ?? 2),
    estimated: options?.estimated
  };
}
