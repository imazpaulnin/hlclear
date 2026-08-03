import { describe, expect, it } from "vitest";
import { buildPositionCycles } from "../domain/cycles";
import { dec } from "../domain/decimal";

describe("financial fixtures", () => {
  it("operacion ganadora que termina en perdida neta por comisiones", () => {
    const fills = [
      makeFill("Open Long", "100", "1", "0", "0.2"),
      makeFill("Close Long", "100.3", "1", "0.3", "0.25")
    ];
    const cycle = buildPositionCycles(fills, [])[0];
    const net = cycle.rawClosedPnl.minus(cycle.rawFeeNetUsdc);
    expect(net.lt(0)).toBe(true);
  });

  it("feeToken distinto de USDC se conserva separado", () => {
    const cycle = buildPositionCycles([makeFill("Close Long", "100.3", "1", "0.3", "0.25", "HYPE")], [])[0];
    expect(cycle.feesOtherTokens[0]?.token).toBe("HYPE");
  });
});

function makeFill(direction: string, price: string, size: string, rawClosedPnl: string, rawFee: string, feeToken = "USDC") {
  return {
    stableId: `${direction}-${price}-${size}-${rawClosedPnl}-${rawFee}-${feeToken}`,
    time: Date.parse("2026-08-03T10:00:00Z"),
    coin: "BTC",
    direction,
    price,
    size,
    notional: dec(price).mul(dec(size)).toString(),
    rawClosedPnl,
    rawFee,
    feeToken,
    crossed: false
  };
}
