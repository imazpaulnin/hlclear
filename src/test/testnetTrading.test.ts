import { describe, expect, it, vi } from "vitest";
import {
  cancelAllOrders,
  closePosition,
  createBrowserWalletAdapter,
  getExecutionEligibility,
  normalizeTradingError,
  submitPreparedTrade
} from "../trading/testnetTradingService";
import type { HyperliquidSnapshot } from "../domain/types";
import type { LivePosition, TradingSnapshot } from "../trading/types";

describe("testnet trading service", () => {
  it("blocks mainnet trading explicitly", () => {
    expect(
      getExecutionEligibility({
        tradingEnvironment: "mainnet",
        walletAddress: "0x1111111111111111111111111111111111111111",
        auditAddress: "0x1111111111111111111111111111111111111111",
        auditAddressMatches: true
      })
    ).toEqual({
      allowed: false,
      reason: "La operativa real todavia no esta habilitada."
    });
  });

  it("blocks when connected wallet does not match the audited address", () => {
    const result = getExecutionEligibility({
      tradingEnvironment: "testnet",
      walletAddress: "0x1111111111111111111111111111111111111111",
      auditAddress: "0x2222222222222222222222222222222222222222",
      auditAddressMatches: false
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no coincide");
  });

  it("submits an order only to testnet clients after setting leverage", async () => {
    const updateLeverage = vi.fn().mockResolvedValue({ status: "ok", response: { type: "default" } });
    const order = vi.fn().mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [{ resting: { oid: 123 } }]
        }
      }
    });

    const result = await submitPreparedTrade(
      {
        exchangeClient: { updateLeverage, order },
        infoClient: {} as never,
        subscriptionClient: {} as never,
        wsTransport: { close: vi.fn() } as never
      } as never,
      {
        assetIndex: 0,
        marginMode: "cross",
        leverage: "5",
        slippageBps: "5",
        prepared: {
          asset: { coin: "BTC", currentPrice: "100000", maxLeverage: 20, szDecimals: 3 },
          side: "long",
          executionMode: "taker",
          currentPrice: "100000",
          estimatedEntryPrice: "100050",
          marginUsdc: "100",
          notionalUsdc: "500",
          leverage: "5",
          entryFeeUsdc: "0.2",
          exitFeeUsdc: "0.2",
          totalRoundTripFeesUsdc: "0.4",
          fundingRate: "0.0001",
          fundingEstimateUsdc: "-0.05",
          slippageBps: "5",
          slippageCostUsdc: "0.25",
          totalCostsUsdc: "0.65",
          breakEvenMovePct: "0.13",
          breakEvenPrice: "100180",
          liquidationPrice: "80000",
          liquidationReliable: true,
          simulated: {
            movePct: "1",
            futurePrice: "101000",
            grossPnl: "5",
            fees: "0.4",
            funding: "-0.05",
            netPnl: "4.55",
            status: { color: "green", label: "Beneficio neto", reason: "ok" }
          },
          riskRows: [],
          finalScenarios: [],
          validationErrors: []
        }
      }
    );

    expect(updateLeverage).toHaveBeenCalledWith({
      asset: 0,
      isCross: true,
      leverage: 5
    });
    expect(order).toHaveBeenCalledTimes(1);
    expect(result.phase).toBe("aceptada");
  });

  it("cancels all open testnet orders by asset and oid", async () => {
    const cancel = vi.fn().mockResolvedValue({
      status: "ok",
      response: {
        type: "cancel",
        data: {
          statuses: ["success", "success"]
        }
      }
    });
    const snapshot: TradingSnapshot = {
      positions: [],
      openOrders: [
        { orderId: 11, coin: "BTC", side: "long", size: "0.1", limitPrice: "100000", reduceOnly: false },
        { orderId: 12, coin: "ETH", side: "short", size: "1", limitPrice: "3000", reduceOnly: true }
      ],
      fills: [],
      fundingSinceSession: "0",
      connection: "ready"
    };
    const universe = [{ name: "BTC" }, { name: "ETH" }] as HyperliquidSnapshot["universe"];

    const result = await cancelAllOrders(
      {
        exchangeClient: { cancel },
        infoClient: {} as never,
        subscriptionClient: {} as never,
        wsTransport: { close: vi.fn() } as never
      } as never,
      snapshot,
      universe
    );

    expect(cancel).toHaveBeenCalledWith({
      cancels: [
        { a: 0, o: 11 },
        { a: 1, o: 12 }
      ]
    });
    expect(result.phase).toBe("cancelada");
  });

  it("closes positions with reduce only IOC orders", async () => {
    const order = vi.fn().mockResolvedValue({
      status: "ok",
      response: {
        type: "order",
        data: {
          statuses: [{ filled: { totalSz: "0.5", avgPx: "101000", oid: 77 } }]
        }
      }
    });
    const position: LivePosition = {
      coin: "BTC",
      side: "long",
      size: "1",
      entryPrice: "100000",
      leverage: "5",
      marginMode: "cross",
      marginUsed: "100",
      unrealizedPnl: "10",
      fundingSinceOpen: "-0.1",
      feeSinceOpen: "0.2",
      netPnl: "9.7",
      trafficLight: { color: "green", label: "Beneficio neto", reason: "ok" }
    };

    const result = await closePosition(
      {
        exchangeClient: { order },
        infoClient: {} as never,
        subscriptionClient: {} as never,
        wsTransport: { close: vi.fn() } as never
      } as never,
      position,
      {
        coin: "BTC",
        assetIndex: 0,
        percentage: 50,
        currentPrice: "100000",
        slippageBps: "5"
      },
      3
    );

    expect(order).toHaveBeenCalledWith({
      orders: [
        {
          a: 0,
          b: false,
          p: "99950",
          s: "0.5",
          r: true,
          t: { limit: { tif: "Ioc" } }
        }
      ],
      grouping: "na"
    });
    expect(result.phase).toBe("ejecutada");
  });

  it("normalizes common signing and api errors into readable messages", () => {
    expect(normalizeTradingError(new Error("User rejected the request."))).toBe("Firma cancelada en la wallet.");
    expect(normalizeTradingError(new Error("insufficient margin"))).toBe("Saldo o margen insuficiente para completar la operacion.");
    expect(normalizeTradingError(new Error("nonce already used"))).toContain("nonce");
    expect(normalizeTradingError(new Error("socket closed"))).toBe("No se pudo contactar con Hyperliquid Testnet.");
    expect(normalizeTradingError(new Error("Failed to sign the typed data using the wallet"))).toContain("EIP-712");
  });

  it("includes EIP712Domain and falls back across typed-data RPC variants for mobile wallets", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(["0x890d13efc8e7fd6e97825b9d35b319a6b07d1460"])
      .mockRejectedValueOnce(new Error("method not supported"))
      .mockResolvedValueOnce("0xsigned");

    const wallet = createBrowserWalletAdapter({ request });
    const signature = await wallet.signTypedData({
      domain: {
        name: "Exchange",
        version: "1",
        chainId: 1337,
        verifyingContract: "0x0000000000000000000000000000000000000000"
      },
      types: {
        Agent: [
          { name: "source", type: "string" },
          { name: "connectionId", type: "bytes32" }
        ]
      },
      primaryType: "Agent",
      message: {
        source: "b",
        connectionId: "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    });

    expect(signature).toBe("0xsigned");
    const signAttempts = request.mock.calls
      .map((call) => call[0] as { method?: string; params?: unknown[] })
      .filter((call) => call.method?.startsWith("eth_signTypedData"));

    expect(signAttempts.length).toBeGreaterThan(0);
    expect(
      signAttempts.some((attempt) =>
        attempt.params?.some(
          (param) => typeof param === "string" && param.includes("\"EIP712Domain\"")
        )
      )
    ).toBe(true);
  });
});
