import { dec } from "../decimal";
import type { TradeAssetQuote, TradeCalculationInput, TradePreparationResult, TradeSide } from "../tradeTypes";
import { calculateBreakEvenMovePct, calculateBreakEvenPrice } from "./breakEven";
import { estimateTradeFee } from "./fees";
import { estimateFundingPnl } from "./funding";
import { calculateLiquidationPrice } from "./liquidation";
import { calculateRiskRows } from "./risk";
import { calculateSimulationResult } from "./simulation";

const DEFAULT_SIMULATION_MOVE_PCTS = ["-2", "-1", "-0.5", "0", "0.5", "1", "2"];
const DEFAULT_RISK_MOVE_PCTS = ["0.5", "1", "2", "3"];
const DEFAULT_FINAL_MOVE_PCTS = ["0.5", "1", "2"];

export function prepareTrade(input: TradeCalculationInput & { simulationMovePct: string }): TradePreparationResult {
  const validationErrors = validateTradeInput(input);
  const currentPrice = dec(input.asset.currentPrice || "0");
  const marginUsdc = dec(input.draft.marginUsdc || "0");
  const leverage = dec(input.draft.leverage || "0");
  const notionalUsdc = marginUsdc.mul(leverage);
  const slippageRate = dec(input.draft.slippageBps || "0").div(10000);
  const slippageDirection = input.draft.side === "long" ? dec(1) : dec(-1);
  const estimatedEntryPrice = currentPrice.mul(dec(1).plus(slippageRate.mul(slippageDirection)));
  const entryFeeUsdc = dec(estimateTradeFee(notionalUsdc.toString(), input.feeRate));
  const exitFeeUsdc = dec(estimateTradeFee(notionalUsdc.toString(), input.feeRate));
  const roundTripFees = entryFeeUsdc.plus(exitFeeUsdc);
  const slippageCostUsdc = notionalUsdc.mul(slippageRate).mul(2);
  const fundingPnl = dec(estimateFundingPnl(notionalUsdc.toString(), input.asset.fundingRate, input.draft.side));
  const allInCosts = roundTripFees.plus(slippageCostUsdc).minus(fundingPnl);
  const breakEvenMovePct = calculateBreakEvenMovePct(allInCosts.toString(), notionalUsdc.toString());
  const breakEvenPrice = calculateBreakEvenPrice(estimatedEntryPrice.toString(), breakEvenMovePct, input.draft.side);
  const liquidation = calculateLiquidationPrice();
  const executionCostsUsdc = roundTripFees.plus(slippageCostUsdc);

  const simulated = calculateSimulationResult({
    currentPrice: estimatedEntryPrice.toString(),
    movePct: input.simulationMovePct,
    side: input.draft.side,
    notionalUsdc: notionalUsdc.toString(),
    executionCostsUsdc: executionCostsUsdc.toString(),
    fundingPnl: fundingPnl.toString()
  });

  return {
    asset: input.asset,
    side: input.draft.side,
    executionMode: input.draft.executionMode,
    currentPrice: currentPrice.toString(),
    estimatedEntryPrice: estimatedEntryPrice.toString(),
    marginUsdc: marginUsdc.toString(),
    notionalUsdc: notionalUsdc.toString(),
    leverage: leverage.toString(),
    entryFeeUsdc: entryFeeUsdc.toString(),
    exitFeeUsdc: exitFeeUsdc.toString(),
    totalRoundTripFeesUsdc: roundTripFees.toString(),
    fundingRate: input.asset.fundingRate ?? "0",
    fundingEstimateUsdc: fundingPnl.toString(),
    slippageBps: input.draft.slippageBps,
    slippageCostUsdc: slippageCostUsdc.toString(),
    totalCostsUsdc: allInCosts.toString(),
    breakEvenMovePct,
    breakEvenPrice,
    liquidationPrice: liquidation.price,
    liquidationReliable: liquidation.reliable,
    simulated,
    riskRows: calculateRiskRows({
      side: input.draft.side,
      notionalUsdc: notionalUsdc.toString(),
      totalCostsUsdc: allInCosts.toString(),
      fundingPnl: fundingPnl.toString(),
      movePcts: DEFAULT_RISK_MOVE_PCTS
    }),
    finalScenarios: DEFAULT_FINAL_MOVE_PCTS.map((movePct) => ({
      movePct,
      netPnl: calculateSimulationResult({
        currentPrice: estimatedEntryPrice.toString(),
        movePct,
        side: input.draft.side,
        notionalUsdc: notionalUsdc.toString(),
        executionCostsUsdc: executionCostsUsdc.toString(),
        fundingPnl: fundingPnl.toString()
      }).netPnl
    })),
    validationErrors
  };
}

export function buildTradeAssetQuotes(input: {
  favorites?: string[];
  marketContexts: Array<{ coin: string; markPrice: string; prevDayPrice?: string; fundingRate?: string }>;
  universe: Array<{ name: string; maxLeverage: number; szDecimals: number }>;
}): TradeAssetQuote[] {
  const favorites = input.favorites ?? ["BTC", "ETH", "SOL", "HYPE", "XRP"];
  const byCoin = new Map(input.marketContexts.map((market) => [market.coin, market]));
  const universeByCoin = new Map(input.universe.map((asset) => [asset.name, asset]));
  const orderedCoins = [...new Set([...favorites, ...input.universe.map((asset) => asset.name)])];

  return orderedCoins
    .map((coin) => {
      const market = byCoin.get(coin);
      const meta = universeByCoin.get(coin);
      const currentPrice = market?.markPrice ?? "0";
      const prevDayPrice = market?.prevDayPrice;
      const change24hPct = prevDayPrice && dec(prevDayPrice).gt(0)
        ? dec(currentPrice).minus(dec(prevDayPrice)).div(dec(prevDayPrice)).mul(100).toString()
        : undefined;

      return {
        coin,
        currentPrice,
        priceChange24hPct: change24hPct,
        fundingRate: market?.fundingRate,
        maxLeverage: meta?.maxLeverage ?? 1,
        szDecimals: meta?.szDecimals
      };
    })
    .filter((asset) => dec(asset.currentPrice).gt(0) || favorites.includes(asset.coin));
}

export function clampTradeLeverage(rawLeverage: string, asset: TradeAssetQuote | undefined): string {
  const leverage = dec(rawLeverage || "1");
  const max = dec(asset?.maxLeverage ?? 1);
  if (leverage.lt(1)) {
    return "1";
  }
  if (leverage.gt(max)) {
    return max.toString();
  }
  return leverage.toString();
}

export function resolveMaxMarginUsdc(input: {
  riskLimitUsdc: string;
  availableUsdc?: string;
}): string {
  const riskLimit = dec(input.riskLimitUsdc || "0");
  const available = dec(input.availableUsdc ?? input.riskLimitUsdc ?? "0");
  const minimum = DecimalMin(riskLimit, available);
  return minimum.lt(0) ? "0" : minimum.toString();
}

function validateTradeInput(input: TradeCalculationInput): string[] {
  const errors: string[] = [];
  if (!input.asset.coin) {
    errors.push("Selecciona un activo.");
  }
  if (dec(input.asset.currentPrice).lte(0)) {
    errors.push("Falta un precio de mercado valido.");
  }
  if (dec(input.draft.marginUsdc || "0").lte(0)) {
    errors.push("El margen debe ser mayor que cero.");
  }
  if (dec(input.draft.leverage || "0").lt(1)) {
    errors.push("El apalancamiento minimo es 1x.");
  }
  if (dec(input.draft.leverage || "0").gt(dec(input.asset.maxLeverage))) {
    errors.push(`El activo no permite superar ${input.asset.maxLeverage}x.`);
  }
  return errors;
}

function DecimalMin(left: ReturnType<typeof dec>, right: ReturnType<typeof dec>) {
  return left.lte(right) ? left : right;
}

export function getAdverseMoveLabel(side: TradeSide): string {
  return side === "long" ? "Si el precio cae..." : "Si el precio sube...";
}

export const tradeSimulationOptions = DEFAULT_SIMULATION_MOVE_PCTS;
