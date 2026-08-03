import { Decimal, dec } from "./decimal";
import type { Fill, FundingEntry, PositionCycle, TokenAggregate } from "./types";

interface MutableCycle {
  id: string;
  coin: string;
  side: "long" | "short";
  fills: Fill[];
  openQuantity: Decimal;
  rawClosedPnl: Decimal;
  rawFeeNetUsdc: Decimal;
  feePaidUsdc: Decimal;
  rebateReceivedUsdc: Decimal;
  totalBuilderFeeIncluded: Decimal;
  feesOtherTokens: Map<string, Decimal>;
  averageEntryAccumulator: Decimal;
  entrySizeAccumulator: Decimal;
  averageExitAccumulator: Decimal;
  exitSizeAccumulator: Decimal;
  firstOpenAt?: number;
  lastActivityAt?: number;
  closedAt?: number;
}

export function buildPositionCycles(fills: Fill[], fundings: FundingEntry[]): PositionCycle[] {
  const sorted = fills.slice().sort((left, right) => left.time - right.time);
  const cycles: MutableCycle[] = [];
  const active = new Map<string, MutableCycle>();

  for (const fill of sorted) {
    const side = inferSide(fill.direction);
    const signedSize = signedQuantity(fill);
    const key = `${fill.coin}:${side}`;

    let cycle = active.get(key);
    if (!cycle) {
      cycle = {
        id: `${key}:${fill.time}`,
        coin: fill.coin,
        side,
        fills: [],
        openQuantity: new Decimal(0),
        rawClosedPnl: new Decimal(0),
        rawFeeNetUsdc: new Decimal(0),
        feePaidUsdc: new Decimal(0),
        rebateReceivedUsdc: new Decimal(0),
        totalBuilderFeeIncluded: new Decimal(0),
        feesOtherTokens: new Map<string, Decimal>(),
        averageEntryAccumulator: new Decimal(0),
        entrySizeAccumulator: new Decimal(0),
        averageExitAccumulator: new Decimal(0),
        exitSizeAccumulator: new Decimal(0),
        firstOpenAt: fill.time
      };
      active.set(key, cycle);
      cycles.push(cycle);
    }

    cycle.fills.push(fill);
    cycle.lastActivityAt = fill.time;
    cycle.rawClosedPnl = cycle.rawClosedPnl.plus(dec(fill.rawClosedPnl));

    if (fill.feeToken.toUpperCase() === "USDC") {
      const rawFee = dec(fill.rawFee);
      cycle.rawFeeNetUsdc = cycle.rawFeeNetUsdc.plus(rawFee);
      if (rawFee.gt(0)) {
        cycle.feePaidUsdc = cycle.feePaidUsdc.plus(rawFee);
      } else if (rawFee.lt(0)) {
        cycle.rebateReceivedUsdc = cycle.rebateReceivedUsdc.plus(rawFee.abs());
      }
      cycle.totalBuilderFeeIncluded = cycle.totalBuilderFeeIncluded.plus(dec(fill.rawBuilderFee ?? "0"));
    } else {
      cycle.feesOtherTokens.set(fill.feeToken, dec(fill.rawFee).plus(cycle.feesOtherTokens.get(fill.feeToken) ?? 0));
    }

    if (isOpeningLike(fill.direction)) {
      cycle.averageEntryAccumulator = cycle.averageEntryAccumulator.plus(dec(fill.price).mul(dec(fill.size).abs()));
      cycle.entrySizeAccumulator = cycle.entrySizeAccumulator.plus(dec(fill.size).abs());
    } else {
      cycle.averageExitAccumulator = cycle.averageExitAccumulator.plus(dec(fill.price).mul(dec(fill.size).abs()));
      cycle.exitSizeAccumulator = cycle.exitSizeAccumulator.plus(dec(fill.size).abs());
    }

    cycle.openQuantity = cycle.openQuantity.plus(signedSize);

    if (cycle.openQuantity.abs().lte("0.00000001")) {
      cycle.closedAt = fill.time;
      active.delete(key);
    }
  }

  return cycles.map((cycle) => {
    const tokenAggregates: TokenAggregate[] = Array.from(cycle.feesOtherTokens.entries()).map(([token, amount]) => ({
      token,
      amount
    }));
    const fundingEntries = fundings.filter((entry) => entry.coin === cycle.coin && inRange(entry.time, cycle.firstOpenAt, cycle.closedAt ?? cycle.lastActivityAt));
    const fundingAttributed = fundingEntries.reduce((sum, entry) => sum.plus(dec(entry.rawFunding)), new Decimal(0));

    return {
      id: cycle.id,
      coin: cycle.coin,
      side: cycle.side,
      fills: cycle.fills,
      openQuantity: cycle.openQuantity,
      rawClosedPnl: cycle.rawClosedPnl,
      rawFeeNetUsdc: cycle.rawFeeNetUsdc,
      feePaidUsdc: cycle.feePaidUsdc,
      rebateReceivedUsdc: cycle.rebateReceivedUsdc,
      totalBuilderFeeIncluded: cycle.totalBuilderFeeIncluded,
      feesOtherTokens: tokenAggregates,
      fundingAttributed,
      fundingAttributionComplete: true,
      averageEntryPrice: cycle.entrySizeAccumulator.gt(0)
        ? cycle.averageEntryAccumulator.div(cycle.entrySizeAccumulator)
        : undefined,
      averageExitPrice: cycle.exitSizeAccumulator.gt(0)
        ? cycle.averageExitAccumulator.div(cycle.exitSizeAccumulator)
        : undefined,
      firstOpenAt: cycle.firstOpenAt,
      lastActivityAt: cycle.lastActivityAt,
      closedAt: cycle.closedAt
    };
  });
}

function inRange(time: number, start?: number, end?: number): boolean {
  if (start === undefined || end === undefined) {
    return false;
  }
  return time >= start && time <= end;
}

function inferSide(direction: string): "long" | "short" {
  return direction.toLowerCase().includes("short") ? "short" : "long";
}

function signedQuantity(fill: Fill): Decimal {
  const amount = dec(fill.size).abs();
  const opening = isOpeningLike(fill.direction);
  const side = inferSide(fill.direction);

  if (side === "long") {
    return opening ? amount : amount.neg();
  }

  return opening ? amount.neg() : amount;
}

function isOpeningLike(direction: string): boolean {
  return direction.toLowerCase().includes("open");
}
