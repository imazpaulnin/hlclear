import type { ProfitColor } from "../domain/types";
import type { TradeExecutionMode, TradePreparationResult, TradeSide } from "../domain/tradeTypes";

export type TradingEnvironment = "testnet" | "mainnet";
export type MarginMode = "cross" | "isolated";

export interface TradeIntent {
  prepared: TradePreparationResult;
  marginMode: MarginMode;
}

export interface SubmittedOrderStatus {
  phase: "aceptada" | "pendiente" | "ejecutada" | "parcial" | "cancelada" | "rechazada";
  summary: string;
  orderId?: number;
  filledSize?: string;
  averagePrice?: string;
  feePaid?: string;
  rawStatus?: string;
}

export interface LivePosition {
  coin: string;
  side: TradeSide;
  size: string;
  entryPrice: string;
  markPrice?: string;
  leverage: string;
  marginMode: MarginMode;
  marginUsed: string;
  liquidationPrice?: string;
  unrealizedPnl: string;
  fundingSinceOpen: string;
  feeSinceOpen: string;
  breakEvenPrice?: string;
  netPnl: string;
  trafficLight: {
    color: ProfitColor;
    label: "Perdida" | "Beneficio bruto" | "Beneficio neto";
    reason: string;
  };
}

export interface LiveOpenOrder {
  orderId: number;
  coin: string;
  side: TradeSide;
  size: string;
  limitPrice: string;
  status?: string;
  reduceOnly: boolean;
  timestamp?: number;
}

export interface LiveFill {
  orderId?: number;
  coin: string;
  side: TradeSide;
  price: string;
  size: string;
  feePaid: string;
  feeToken?: string;
  timestamp: number;
}

export interface TradingSnapshot {
  positions: LivePosition[];
  openOrders: LiveOpenOrder[];
  fills: LiveFill[];
  fundingSinceSession: string;
  latestOrderStatus?: SubmittedOrderStatus;
  connection: "idle" | "connecting" | "ready" | "error";
  connectionMessage?: string;
}

export interface SubmitPreparedTradeInput {
  prepared: TradePreparationResult;
  assetIndex: number;
  marginMode: MarginMode;
  slippageBps: string;
  leverage: string;
}

export interface PositionCloseInput {
  coin: string;
  assetIndex: number;
  percentage: 25 | 50 | 75 | 100;
  currentPrice: string;
  slippageBps: string;
}

export interface ExecutionEligibility {
  allowed: boolean;
  reason?: string;
}

export interface TradeConfirmationSummary {
  title: string;
  side: TradeSide;
  coin: string;
  executionMode: TradeExecutionMode;
  marginMode: MarginMode;
  marginUsdc: string;
  leverage: string;
  notionalUsdc: string;
  estimatedEntryPrice: string;
  entryFeeUsdc: string;
  exitFeeUsdc: string;
  fundingEstimateUsdc: string;
  slippageCostUsdc: string;
  breakEvenPrice: string;
  breakEvenMovePct: string;
  liquidationPrice?: string;
  scenarios: Array<{ movePct: string; netPnl: string }>;
}
