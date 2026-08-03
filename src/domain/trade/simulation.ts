import { dec } from "../decimal";
import type { TradeOutcomeStatus, TradeSide, TradeSimulationResult } from "../tradeTypes";

export function calculateGrossPnl(notionalUsdc: string, movePct: string, side: TradeSide): string {
  const move = dec(movePct).div(100);
  const direction = side === "long" ? dec(1) : dec(-1);
  return dec(notionalUsdc).mul(move).mul(direction).toString();
}

export function calculateFuturePrice(currentPrice: string, movePct: string): string {
  return dec(currentPrice).mul(dec(1).plus(dec(movePct).div(100))).toString();
}

export function getTradeOutcomeStatus(grossPnl: string, netPnl: string): TradeOutcomeStatus {
  const gross = dec(grossPnl);
  const net = dec(netPnl);

  if (net.gt(0)) {
    return {
      color: "green",
      label: "Beneficio neto",
      reason: "El beneficio neto estimado es positivo tras comisiones, slippage y funding."
    };
  }

  if (gross.gt(0) && net.lte(0)) {
    return {
      color: "orange",
      label: "Beneficio bruto",
      reason: "El precio va a favor, pero el resultado neto sigue siendo negativo por costes."
    };
  }

  return {
    color: "red",
    label: "Perdida",
    reason: "El escenario sigue en perdida neta."
  };
}

export function calculateSimulationResult(input: {
  currentPrice: string;
  movePct: string;
  side: TradeSide;
  notionalUsdc: string;
  executionCostsUsdc: string;
  fundingPnl: string;
}): TradeSimulationResult {
  const grossPnl = calculateGrossPnl(input.notionalUsdc, input.movePct, input.side);
  const netPnl = dec(grossPnl).plus(dec(input.fundingPnl)).minus(dec(input.executionCostsUsdc)).toString();
  const status = getTradeOutcomeStatus(grossPnl, netPnl);

  return {
    movePct: input.movePct,
    futurePrice: calculateFuturePrice(input.currentPrice, input.movePct),
    grossPnl,
    fees: input.executionCostsUsdc,
    funding: input.fundingPnl,
    netPnl,
    status
  };
}
