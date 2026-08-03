import { dec } from "../decimal";
import type { TradeSide } from "../tradeTypes";

export function estimateFundingPnl(notionalUsdc: string, fundingRate: string | undefined, side: TradeSide): string {
  const rate = dec(fundingRate ?? "0");
  const notional = dec(notionalUsdc);

  if (side === "long") {
    return notional.mul(rate).neg().toString();
  }

  return notional.mul(rate).toString();
}
