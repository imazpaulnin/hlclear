import { Decimal, dec } from "./decimal";
import type { ProfitStatus } from "./types";

export interface ProfitStatusInput {
  gross: Decimal;
  net: Decimal;
  tolerance: Decimal;
  incomplete: boolean;
  stale: boolean;
  feeTokenUnknown: boolean;
  fundingIncomplete: boolean;
  reconciled: boolean;
  ambiguousAccounting: boolean;
}

export function determineProfitStatus(input: ProfitStatusInput): ProfitStatus {
  if (
    input.incomplete ||
    input.stale ||
    input.feeTokenUnknown ||
    input.fundingIncomplete ||
    !input.reconciled ||
    input.ambiguousAccounting ||
    input.gross.abs().lte(input.tolerance)
  ) {
    return {
      color: "gray",
      icon: "●",
      label: "Equilibrio o datos insuficientes",
      reason: "El resultado está en tolerancia o faltan datos fiables para clasificarlo con seguridad."
    };
  }

  if (input.gross.lt(input.tolerance.neg())) {
    return {
      color: "red",
      icon: "↘",
      label: "Pérdida bruta",
      reason: "El P&L bruto de mercado es negativo más allá de la tolerancia configurada."
    };
  }

  if (input.gross.gt(input.tolerance) && input.net.lt(input.tolerance.neg())) {
    return {
      color: "orange",
      icon: "▲",
      label: "Bruto positivo, neto negativo",
      reason: "La posición parece ir en beneficio, pero cerrarla ahora produciría una pérdida neta."
    };
  }

  if (input.net.gt(input.tolerance)) {
    return {
      color: "green",
      icon: "✓",
      label: "Beneficio neto",
      reason: "El resultado neto tras comisiones, funding y cierre estimado es positivo."
    };
  }

  return {
    color: "gray",
    icon: "●",
    label: "Equilibrio o datos insuficientes",
    reason: "La clasificación conservadora no puede confirmar beneficio neto."
  };
}

export function hasUnknownFeeToken(tokens: string[]): boolean {
  return tokens.some((token) => token.toUpperCase() !== "USDC");
}

export function toleranceDecimal(value: string): Decimal {
  return dec(value || "0.01");
}
