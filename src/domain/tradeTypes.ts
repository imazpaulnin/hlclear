import type { ProfitColor } from "./types";

export type TradeSide = "long" | "short";
export type TradeExecutionMode = "maker" | "taker";

export interface TradeAssetQuote {
  coin: string;
  currentPrice: string;
  priceChange24hPct?: string;
  fundingRate?: string;
  maxLeverage: number;
  szDecimals?: number;
}

export interface TradeDraft {
  coin: string;
  side: TradeSide;
  executionMode: TradeExecutionMode;
  marginUsdc: string;
  leverage: string;
  slippageBps: string;
}

export interface TradeCalculationInput {
  asset: TradeAssetQuote;
  draft: TradeDraft;
  feeRate: string;
}

export interface TradeOutcomeStatus {
  color: ProfitColor;
  label: "Perdida" | "Beneficio bruto" | "Beneficio neto";
  reason: string;
}

export interface TradeRiskRow {
  movePct: string;
  projectedLossUsdc: string;
}

export interface TradeSimulationResult {
  movePct: string;
  futurePrice: string;
  grossPnl: string;
  fees: string;
  funding: string;
  netPnl: string;
  status: TradeOutcomeStatus;
}

export interface TradePreparationResult {
  asset: TradeAssetQuote;
  side: TradeSide;
  executionMode: TradeExecutionMode;
  currentPrice: string;
  estimatedEntryPrice: string;
  marginUsdc: string;
  notionalUsdc: string;
  leverage: string;
  entryFeeUsdc: string;
  exitFeeUsdc: string;
  totalRoundTripFeesUsdc: string;
  fundingRate: string;
  fundingEstimateUsdc: string;
  slippageBps: string;
  slippageCostUsdc: string;
  totalCostsUsdc: string;
  breakEvenMovePct: string;
  breakEvenPrice: string;
  liquidationPrice?: string;
  liquidationReliable: boolean;
  simulated: TradeSimulationResult;
  riskRows: TradeRiskRow[];
  finalScenarios: Array<{
    movePct: string;
    netPnl: string;
  }>;
  validationErrors: string[];
}
