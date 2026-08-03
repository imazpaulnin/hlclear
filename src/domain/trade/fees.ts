import { dec } from "../decimal";
import type { TradeExecutionMode } from "../tradeTypes";
import type { UserFees } from "../types";

export function resolveTradeFeeRate(userFees: UserFees | undefined, mode: TradeExecutionMode): string {
  if (!userFees) {
    return mode === "maker" ? "0.0001" : "0.00045";
  }

  if (mode === "maker") {
    return userFees.userAddRate || userFees.feeSchedule?.add || "0.0001";
  }

  return userFees.userCrossRate || userFees.feeSchedule?.cross || "0.00045";
}

export function estimateTradeFee(notionalUsdc: string, feeRate: string): string {
  return dec(notionalUsdc).mul(dec(feeRate).abs()).toString();
}
