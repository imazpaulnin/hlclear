import { describe, expect, it } from "vitest";
import { calculateBreakEvenMovePct, calculateBreakEvenPrice } from "../domain/trade/breakEven";
import { estimateTradeFee, resolveTradeFeeRate } from "../domain/trade/fees";
import { estimateFundingPnl } from "../domain/trade/funding";
import { calculateLiquidationPrice } from "../domain/trade/liquidation";
import { prepareTrade } from "../domain/trade/prepareTrade";
import { calculateRiskRows } from "../domain/trade/risk";
import { calculateFuturePrice, calculateGrossPnl, calculateSimulationResult, getTradeOutcomeStatus } from "../domain/trade/simulation";
import type { TradeAssetQuote } from "../domain/tradeTypes";
import type { UserFees } from "../domain/types";

const asset: TradeAssetQuote = {
  coin: "BTC",
  currentPrice: "100000",
  priceChange24hPct: "2.5",
  fundingRate: "0.0001",
  maxLeverage: 20,
  szDecimals: 3
};

describe("trade preparation services", () => {
  it("computes long preparation with taker fees", () => {
    const result = prepareTrade({
      asset,
      draft: {
        coin: "BTC",
        side: "long",
        executionMode: "taker",
        marginUsdc: "100",
        leverage: "5",
        slippageBps: "5"
      },
      feeRate: "0.00045",
      simulationMovePct: "1"
    });

    expect(result.notionalUsdc).toBe("500");
    expect(result.entryFeeUsdc).toBe("0.225");
    expect(result.exitFeeUsdc).toBe("0.225");
    expect(result.breakEvenMovePct).not.toBe("0");
    expect(result.simulated.netPnl).not.toBe("0");
  });

  it("computes short preparation and gross pnl direction correctly", () => {
    expect(calculateGrossPnl("500", "1", "short")).toBe("-5");
    expect(calculateGrossPnl("500", "-1", "short")).toBe("5");
  });

  it("uses maker and taker fee schedules independently", () => {
    const fees: UserFees = {
      userCrossRate: "0.00045",
      userAddRate: "0.0001",
      activeReferralDiscount: "0",
      activeStakingDiscount: "0"
    };

    expect(resolveTradeFeeRate(fees, "maker")).toBe("0.0001");
    expect(resolveTradeFeeRate(fees, "taker")).toBe("0.00045");
    expect(estimateTradeFee("1000", "0.00045")).toBe("0.45");
  });

  it("applies positive funding as cost to longs and credit to shorts", () => {
    expect(estimateFundingPnl("1000", "0.0001", "long")).toBe("-0.1");
    expect(estimateFundingPnl("1000", "0.0001", "short")).toBe("0.1");
  });

  it("applies negative funding as credit to longs and cost to shorts", () => {
    expect(estimateFundingPnl("1000", "-0.0001", "long")).toBe("0.1");
    expect(estimateFundingPnl("1000", "-0.0001", "short")).toBe("-0.1");
  });

  it("calculates break-even move and price", () => {
    expect(calculateBreakEvenMovePct("1", "500")).toBe("0.2");
    expect(calculateBreakEvenPrice("100", "0.2", "long")).toBe("100.2");
    expect(calculateBreakEvenPrice("100", "0.2", "short")).toBe("99.8");
  });

  it("returns no liquidation when no reliable formula is available", () => {
    expect(calculateLiquidationPrice()).toEqual({ price: undefined, reliable: false });
  });

  it("distinguishes semaforo states", () => {
    expect(getTradeOutcomeStatus("-1", "-2").label).toBe("Perdida");
    expect(getTradeOutcomeStatus("2", "-1").label).toBe("Beneficio bruto");
    expect(getTradeOutcomeStatus("2", "1").label).toBe("Beneficio neto");
  });

  it("simulates price movement, future price and net pnl", () => {
    expect(calculateFuturePrice("100", "1")).toBe("101");
    const simulation = calculateSimulationResult({
      currentPrice: "100",
      movePct: "1",
      side: "long",
      notionalUsdc: "1000",
      executionCostsUsdc: "1",
      fundingPnl: "-0.1"
    });

    expect(simulation.grossPnl).toBe("10");
    expect(simulation.netPnl).toBe("8.9");
  });

  it("builds risk rows for adverse movement", () => {
    const rows = calculateRiskRows({
      side: "long",
      notionalUsdc: "1000",
      totalCostsUsdc: "2",
      fundingPnl: "-0.1",
      movePcts: ["0.5", "1"]
    });

    expect(rows[0]?.projectedLossUsdc).toBe("7.1");
    expect(rows[1]?.projectedLossUsdc).toBe("12.1");
  });

  it("includes slippage in all-in costs and validation for leverage cap", () => {
    const result = prepareTrade({
      asset,
      draft: {
        coin: "BTC",
        side: "long",
        executionMode: "taker",
        marginUsdc: "50",
        leverage: "25",
        slippageBps: "10"
      },
      feeRate: "0.00045",
      simulationMovePct: "0.5"
    });

    expect(result.slippageCostUsdc).toBe("2.5");
    expect(result.validationErrors[0]).toContain("20x");
  });
});
