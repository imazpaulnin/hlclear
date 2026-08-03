import { dec } from "../decimal";
import type { TradeSide } from "../tradeTypes";

export function calculateBreakEvenMovePct(totalCostsUsdc: string, notionalUsdc: string): string {
  const notional = dec(notionalUsdc);
  if (notional.lte(0)) {
    return "0";
  }

  return dec(totalCostsUsdc).div(notional).mul(100).toString();
}

export function calculateBreakEvenPrice(entryPrice: string, breakEvenMovePct: string, side: TradeSide): string {
  const move = dec(breakEvenMovePct).div(100);
  const base = dec(entryPrice);
  if (base.lte(0)) {
    return "0";
  }

  return side === "long" ? base.mul(dec(1).plus(move)).toString() : base.mul(dec(1).minus(move)).toString();
}
