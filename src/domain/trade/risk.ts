import { dec } from "../decimal";
import type { TradeRiskRow, TradeSide } from "../tradeTypes";
import { calculateGrossPnl } from "./simulation";

export function calculateRiskRows(input: {
  side: TradeSide;
  notionalUsdc: string;
  totalCostsUsdc: string;
  fundingPnl: string;
  movePcts: string[];
}): TradeRiskRow[] {
  return input.movePcts.map((movePct) => {
    const signedMove = input.side === "long" ? dec(movePct).neg().toString() : movePct;
    const grossPnl = calculateGrossPnl(input.notionalUsdc, signedMove, input.side);
    const netPnl = dec(grossPnl).plus(dec(input.fundingPnl)).minus(dec(input.totalCostsUsdc));
    const projectedLossUsdc = netPnl.lt(0) ? netPnl.abs().toString() : "0";

    return {
      movePct,
      projectedLossUsdc
    };
  });
}
