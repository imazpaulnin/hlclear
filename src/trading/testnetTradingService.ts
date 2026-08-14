import { ExchangeClient, HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from "@nktkas/hyperliquid";
import type { AbstractViemJsonRpcAccount } from "@nktkas/hyperliquid/signing";
import { createWalletClient, custom } from "viem";
import { getAddresses as getViemAddresses, signTypedData as signTypedDataWithViem } from "viem/actions";
import { calculateBreakEvenPrice } from "../domain/trade/breakEven";
import { getTradeOutcomeStatus } from "../domain/trade/simulation";
import { dec } from "../domain/decimal";
import type { HyperliquidSnapshot } from "../domain/types";
import type { TradePreparationResult, TradeSide } from "../domain/tradeTypes";
import type { Eip1193Provider } from "../wallet/types";
import type {
  ExecutionEligibility,
  LiveFill,
  LiveOpenOrder,
  LivePosition,
  MarginMode,
  PositionCloseInput,
  SubmitPreparedTradeInput,
  SubmittedOrderStatus,
  TradeConfirmationSummary,
  TradingSnapshot
} from "./types";

type TransportBundle = {
  infoClient: InfoClient;
  exchangeClient: ExchangeClient;
  subscriptionClient: SubscriptionClient;
  wsTransport: WebSocketTransport;
};

type TradingSubscriptions = {
  close: () => void;
};

type TradingUpdateListener = (patch: Partial<TradingSnapshot> | ((current: TradingSnapshot) => TradingSnapshot)) => void;

const TESTNET_CLEARINGHOUSE_URL = "https://api.hyperliquid-testnet.xyz";

export function getExecutionEligibility(args: {
  tradingEnvironment: "testnet" | "mainnet";
  walletAddress?: string;
  auditAddress: string;
  auditAddressMatches: boolean | undefined;
}): ExecutionEligibility {
  if (args.tradingEnvironment === "mainnet") {
    return {
      allowed: false,
      reason: "La operativa real todavia no esta habilitada."
    };
  }

  if (!args.walletAddress) {
    return {
      allowed: false,
      reason: "Conecta una wallet antes de operar en Testnet."
    };
  }

  if (!args.auditAddress) {
    return {
      allowed: false,
      reason: "Configura primero la direccion publica auditada."
    };
  }

  if (args.auditAddressMatches === false) {
    return {
      allowed: false,
      reason: "La wallet conectada no coincide con la direccion auditada. El envio queda bloqueado."
    };
  }

  return { allowed: true };
}

export function buildConfirmationSummary(intent: {
  prepared: TradePreparationResult;
  marginMode: MarginMode;
}): TradeConfirmationSummary {
  const { prepared, marginMode } = intent;
  return {
    title: `${prepared.side.toUpperCase()} ${prepared.asset.coin}`,
    side: prepared.side,
    coin: prepared.asset.coin,
    executionMode: prepared.executionMode,
    marginMode,
    marginUsdc: prepared.marginUsdc,
    leverage: prepared.leverage,
    notionalUsdc: prepared.notionalUsdc,
    estimatedEntryPrice: prepared.estimatedEntryPrice,
    entryFeeUsdc: prepared.entryFeeUsdc,
    exitFeeUsdc: prepared.exitFeeUsdc,
    fundingEstimateUsdc: prepared.fundingEstimateUsdc,
    slippageCostUsdc: prepared.slippageCostUsdc,
    breakEvenPrice: prepared.breakEvenPrice,
    breakEvenMovePct: prepared.breakEvenMovePct,
    liquidationPrice: prepared.liquidationReliable ? prepared.liquidationPrice : undefined,
    scenarios: prepared.finalScenarios
  };
}

export function createTestnetTradingClients(provider: Eip1193Provider): TransportBundle {
  const wallet = createBrowserWalletAdapter(provider);
  const httpTransport = new HttpTransport({
    isTestnet: true,
    apiUrl: TESTNET_CLEARINGHOUSE_URL
  });
  const wsTransport = new WebSocketTransport({
    isTestnet: true
  });

  return {
    infoClient: new InfoClient({ transport: httpTransport }),
    exchangeClient: new ExchangeClient({
      transport: httpTransport,
      wallet
    }) as ExchangeClient,
    subscriptionClient: new SubscriptionClient({ transport: wsTransport }),
    wsTransport
  };
}

export async function submitPreparedTrade(
  bundle: TransportBundle,
  input: SubmitPreparedTradeInput
): Promise<SubmittedOrderStatus> {
  const isCross = input.marginMode === "cross";
  await bundle.exchangeClient.updateLeverage({
    asset: input.assetIndex,
    isCross,
    leverage: Number(dec(input.leverage).toFixed(0))
  });

  const order = buildOpenOrder(input.prepared, input.assetIndex);
  const response = await bundle.exchangeClient.order({
    orders: [order],
    grouping: "na"
  });

  return mapSubmittedStatus(response.response.data.statuses[0]);
}

export async function cancelSingleOrder(
  bundle: TransportBundle,
  assetIndex: number,
  orderId: number
): Promise<SubmittedOrderStatus> {
  const response = await bundle.exchangeClient.cancel({
    cancels: [{ a: assetIndex, o: orderId }]
  });

  const status = response.response.data.statuses[0];
  if (status === "success") {
    return {
      phase: "cancelada",
      summary: `Orden ${orderId} cancelada en Testnet.`,
      orderId,
      rawStatus: "success"
    };
  }

  return {
    phase: "rechazada",
    summary: extractError(status),
    orderId,
    rawStatus: typeof status === "object" ? JSON.stringify(status) : String(status)
  };
}

export async function cancelAllOrders(
  bundle: TransportBundle,
  snapshot: TradingSnapshot,
  universe: HyperliquidSnapshot["universe"]
): Promise<SubmittedOrderStatus> {
  if (snapshot.openOrders.length === 0) {
    return {
      phase: "cancelada",
      summary: "No hay ordenes abiertas que cancelar."
    };
  }

  const cancels = snapshot.openOrders
    .map((order) => {
      const assetIndex = universe.findIndex((asset) => asset.name === order.coin);
      if (assetIndex < 0) {
        return undefined;
      }
      return { a: assetIndex, o: order.orderId };
    })
    .filter((entry): entry is { a: number; o: number } => Boolean(entry));

  if (cancels.length === 0) {
    return {
      phase: "rechazada",
      summary: "No se pudo resolver el activo de las ordenes abiertas."
    };
  }

  const response = await bundle.exchangeClient.cancel({ cancels });
  const failed = response.response.data.statuses.find((status) => status !== "success");

  if (!failed) {
    return {
      phase: "cancelada",
      summary: `Se cancelaron ${cancels.length} ordenes en Testnet.`,
      rawStatus: "success"
    };
  }

  return {
    phase: "rechazada",
    summary: extractError(failed),
    rawStatus: typeof failed === "object" ? JSON.stringify(failed) : String(failed)
  };
}

export async function closePosition(
  bundle: TransportBundle,
  position: LivePosition,
  input: PositionCloseInput,
  szDecimals = 3
): Promise<SubmittedOrderStatus> {
  const closeSide = position.side === "long" ? "short" : "long";
  const absoluteSize = dec(position.size).abs();
  const size = absoluteSize.mul(dec(input.percentage).div(100));
  const formattedSize = formatSize(size, szDecimals);

  if (dec(formattedSize).lte(0)) {
    return {
      phase: "rechazada",
      summary: "El porcentaje elegido deja un tamano demasiado pequeno para enviarlo."
    };
  }

  const referencePrice = position.markPrice ?? input.currentPrice;
  const orderResponse = await bundle.exchangeClient.order({
    orders: [
      {
        a: input.assetIndex,
        b: closeSide === "long",
        p: applySlippagePrice(referencePrice, closeSide, input.slippageBps),
        s: formattedSize,
        r: true,
        t: { limit: { tif: "Ioc" } }
      }
    ],
    grouping: "na"
  });

  return mapSubmittedStatus(orderResponse.response.data.statuses[0]);
}

export async function fetchInitialTradingSnapshot(
  bundle: TransportBundle,
  userAddress: string
): Promise<TradingSnapshot> {
  const [rawPositions, rawOpenOrders, rawFills] = await Promise.all([
    bundle.infoClient.clearinghouseState({ user: userAddress }),
    bundle.infoClient.frontendOpenOrders({ user: userAddress }),
    bundle.infoClient.userFills({ user: userAddress, aggregateByTime: false })
  ]);

  const recentFills = rawFills
    .slice(-20)
    .map((fill) => normalizeLiveFill(fill))
    .sort((left, right) => right.timestamp - left.timestamp);
  const feeSinceOpenByCoin = recentFills.reduce<Record<string, string>>((acc, fill) => {
    const current = dec(acc[fill.coin] ?? "0");
    acc[fill.coin] = current.plus(fill.feePaid).toString();
    return acc;
  }, {});

  return {
    connection: "ready",
    positions: normalizeLivePositions(rawPositions, feeSinceOpenByCoin),
    openOrders: rawOpenOrders.map((order) => normalizeLiveOpenOrder(order)),
    fills: recentFills,
    fundingSinceSession: "0"
  };
}

export async function subscribeToTradingState(
  bundle: TransportBundle,
  userAddress: string,
  onUpdate: TradingUpdateListener
): Promise<TradingSubscriptions> {
  const subscriptions = await Promise.all([
    bundle.subscriptionClient.clearinghouseState(
      { user: userAddress },
      (event) => {
        onUpdate((current) => {
          const feeByCoin = current.fills.reduce<Record<string, string>>((acc, fill) => {
            acc[fill.coin] = dec(acc[fill.coin] ?? "0").plus(fill.feePaid).toString();
            return acc;
          }, {});

          return {
            ...current,
            connection: "ready",
            positions: normalizeLivePositions(event.clearinghouseState, feeByCoin)
          };
        });
      },
      {
        onError: (error) => {
          onUpdate({
            connection: "error",
            connectionMessage: normalizeTradingError(error)
          });
        }
      }
    ),
    bundle.subscriptionClient.openOrders(
      { user: userAddress },
      (event) => {
        onUpdate({
          openOrders: event.orders.map((order) => normalizeLiveOpenOrder(order)),
          connection: "ready"
        });
      },
      {
        onError: (error) => {
          onUpdate({
            connection: "error",
            connectionMessage: normalizeTradingError(error)
          });
        }
      }
    ),
    bundle.subscriptionClient.userFills(
      { user: userAddress, aggregateByTime: false },
      (event) => {
        onUpdate((current) => {
          const nextFills = [...event.fills.map((fill) => normalizeLiveFill(fill)), ...current.fills]
            .sort((left, right) => right.timestamp - left.timestamp)
            .filter((fill, index, rows) => rows.findIndex((candidate) => isSameFill(candidate, fill)) === index)
            .slice(0, 30);

          const feeByCoin = nextFills.reduce<Record<string, string>>((acc, fill) => {
            acc[fill.coin] = dec(acc[fill.coin] ?? "0").plus(fill.feePaid).toString();
            return acc;
          }, {});

          return {
            ...current,
            fills: nextFills,
            positions: current.positions.map((position) => applyFeeSnapshot(position, feeByCoin[position.coin] ?? "0"))
          };
        });
      }
    ),
    bundle.subscriptionClient.userFundings(
      { user: userAddress },
      (event) => {
        onUpdate((current) => {
          const fundingDelta = event.fundings.reduce((sum, row) => sum.plus(row.usdc), dec(0));
          return {
            ...current,
            fundingSinceSession: dec(current.fundingSinceSession).plus(fundingDelta).toString(),
            positions: current.positions.map((position) => {
              const coinFunding = event.fundings
                .filter((row) => row.coin === position.coin)
                .reduce((sum, row) => sum.plus(row.usdc), dec(0));
              return applyFundingDelta(position, coinFunding.toString());
            })
          };
        });
      }
    ),
    bundle.subscriptionClient.orderUpdates(
      { user: userAddress },
      (event) => {
        const latest = event[0];
        if (!latest) {
          return;
        }
        onUpdate({
          latestOrderStatus: mapOrderUpdateStatus(latest.status, latest.order?.oid, latest.order?.sz, latest.order?.limitPx)
        });
      }
    )
  ]);

  return {
    close: () => {
      for (const subscription of subscriptions) {
        void subscription.unsubscribe();
      }
      bundle.wsTransport.close();
    }
  };
}

export function normalizeTradingError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Error de operativa Testnet.";
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("rejected the request") || lower.includes("denied")) {
    return "Firma cancelada en la wallet.";
  }
  if (lower.includes("failed to sign the typed data using the wallet") || lower.includes("sign typed data")) {
    return "La wallet conectada no pudo firmar la solicitud EIP-712 de Hyperliquid. Reintenta y, si sigue igual, cambia la variante de firma compatible con Rabby/WalletConnect.";
  }
  if (lower.includes("insufficient") || lower.includes("margin")) {
    return "Saldo o margen insuficiente para completar la operacion.";
  }
  if (lower.includes("nonce")) {
    return "La wallet devolvio un nonce no valido. Reintenta dentro de unos segundos.";
  }
  if (lower.includes("liquidity") || lower.includes("slippage")) {
    return "La orden no entra con el slippage configurado.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("socket")) {
    return "No se pudo contactar con Hyperliquid Testnet.";
  }

  return message;
}

function buildOpenOrder(prepared: TradePreparationResult, assetIndex: number) {
  const currentPrice = dec(prepared.currentPrice);
  const entryPrice = dec(prepared.estimatedEntryPrice);
  const executionPrice = entryPrice.gt(0) ? entryPrice : currentPrice;
  const size = dec(prepared.notionalUsdc).div(executionPrice);

  return {
    a: assetIndex,
    b: prepared.side === "long",
    p: prepared.estimatedEntryPrice,
    s: size.toFixed(prepared.asset.szDecimals ?? 3),
    r: false,
    t: {
      limit: {
        tif: prepared.executionMode === "maker" ? "Alo" : "Ioc"
      }
    } as const
  };
}

function mapSubmittedStatus(status: unknown): SubmittedOrderStatus {
  if (status === "waitingForFill" || status === "waitingForTrigger") {
    return {
      phase: "pendiente",
      summary: status === "waitingForFill" ? "Orden aceptada y pendiente de ejecucion." : "Orden aceptada y pendiente de disparo.",
      rawStatus: status
    };
  }

  if (typeof status === "object" && status !== null) {
    const source = status as Record<string, unknown>;
    if ("resting" in source) {
      const resting = asRecord(source.resting);
      return {
        phase: "aceptada",
        summary: `Orden aceptada con id ${String(resting.oid ?? "")}.`,
        orderId: numberOrUndefined(resting.oid),
        rawStatus: "resting"
      };
    }

    if ("filled" in source) {
      const filled = asRecord(source.filled);
      return {
        phase: "ejecutada",
        summary: "Orden ejecutada en Testnet.",
        orderId: numberOrUndefined(filled.oid),
        filledSize: stringOrUndefined(filled.totalSz),
        averagePrice: stringOrUndefined(filled.avgPx),
        rawStatus: "filled"
      };
    }

    if ("error" in source) {
      return {
        phase: "rechazada",
        summary: String(source.error ?? "Hyperliquid rechazo la orden."),
        rawStatus: "error"
      };
    }
  }

  return {
    phase: "rechazada",
    summary: "Hyperliquid devolvio una respuesta que no se pudo interpretar.",
    rawStatus: String(status)
  };
}

function mapOrderUpdateStatus(rawStatus: string, orderId?: number, filledSize?: string, price?: string): SubmittedOrderStatus {
  if (rawStatus === "filled") {
    return {
      phase: "ejecutada",
      summary: "Orden ejecutada.",
      orderId,
      filledSize,
      averagePrice: price,
      rawStatus
    };
  }

  if (rawStatus === "open" || rawStatus === "triggered") {
    return {
      phase: "pendiente",
      summary: rawStatus === "open" ? "Orden abierta y pendiente." : "Orden disparada y pendiente.",
      orderId,
      rawStatus
    };
  }

  if (rawStatus === "canceled" || rawStatus.endsWith("Canceled")) {
    return {
      phase: "cancelada",
      summary: "Orden cancelada.",
      orderId,
      rawStatus
    };
  }

  if (rawStatus === "rejected" || rawStatus.endsWith("Rejected")) {
    return {
      phase: "rechazada",
      summary: "Hyperliquid rechazo la orden.",
      orderId,
      rawStatus
    };
  }

  return {
    phase: "aceptada",
    summary: "Orden aceptada por Testnet.",
    orderId,
    rawStatus
  };
}

function normalizeLivePositions(
  rawState: unknown,
  feeSinceOpenByCoin: Record<string, string>
): LivePosition[] {
  const state = asRecord(rawState);
  const assetPositions = Array.isArray(state.assetPositions) ? state.assetPositions : [];

  return assetPositions
    .map((item) => asRecord(asRecord(item).position))
    .filter((position) => Object.keys(position).length > 0)
    .map((position) => {
      const size = String(position.szi ?? "0");
      const side: TradeSide = dec(size).gte(0) ? "long" : "short";
      const entryPrice = String(position.entryPx ?? "0");
      const liquidationPrice = stringOrUndefined(position.liquidationPx) ?? undefined;
      const leverage = String(asRecord(position.leverage).value ?? "1");
      const marginMode: MarginMode = asRecord(position.leverage).type === "isolated" ? "isolated" : "cross";
      const unrealizedPnl = String(position.unrealizedPnl ?? "0");
      const fundingSinceOpen = String(asRecord(position.cumFunding).sinceOpen ?? "0");
      const feeSinceOpen = feeSinceOpenByCoin[String(position.coin ?? "")] ?? "0";
      const netPnl = dec(unrealizedPnl).minus(feeSinceOpen).plus(fundingSinceOpen).toString();
      const grossMovePct = dec(String(position.returnOnEquity ?? "0")).mul(100);
      const breakEvenMove = dec(feeSinceOpen).minus(fundingSinceOpen).div(dec(String(position.positionValue ?? "1"))).mul(100).abs().toString();

      return {
        coin: String(position.coin ?? ""),
        side,
        size,
        entryPrice,
        leverage,
        marginMode,
        marginUsed: String(position.marginUsed ?? "0"),
        liquidationPrice,
        unrealizedPnl,
        fundingSinceOpen,
        feeSinceOpen,
        breakEvenPrice: calculateBreakEvenPrice(entryPrice, breakEvenMove, side),
        netPnl,
        trafficLight: getTradeOutcomeStatus(grossMovePct.toString(), netPnl)
      };
    });
}

function normalizeLiveOpenOrder(input: unknown): LiveOpenOrder {
  const order = asRecord(input);
  const isBuy = Boolean(order.isBuy ?? (String(order.side ?? "").toUpperCase() === "B"));
  return {
    orderId: Number(order.oid ?? 0),
    coin: String(order.coin ?? ""),
    side: isBuy ? "long" : "short",
    size: String(order.sz ?? "0"),
    limitPrice: String(order.limitPx ?? "0"),
    status: stringOrUndefined(order.status),
    reduceOnly: Boolean(order.reduceOnly ?? false),
    timestamp: numberOrUndefined(order.timestamp)
  };
}

function normalizeLiveFill(input: unknown): LiveFill {
  const fill = asRecord(input);
  return {
    orderId: numberOrUndefined(fill.oid),
    coin: String(fill.coin ?? ""),
    side: normalizeFillSide(String(fill.dir ?? "")),
    price: String(fill.px ?? "0"),
    size: String(fill.sz ?? "0"),
    feePaid: String(fill.fee ?? "0"),
    feeToken: stringOrUndefined(fill.feeToken),
    timestamp: Number(fill.time ?? 0)
  };
}

function normalizeFillSide(direction: string): TradeSide {
  return direction.toLowerCase().includes("short") || direction.toLowerCase().includes("sell") ? "short" : "long";
}

function applyFeeSnapshot(position: LivePosition, feeSinceOpen: string): LivePosition {
  const netPnl = dec(position.unrealizedPnl).minus(feeSinceOpen).plus(position.fundingSinceOpen).toString();
  const breakEvenMove = dec(feeSinceOpen).minus(position.fundingSinceOpen).div(dec(position.marginUsed).mul(dec(position.leverage))).mul(100).abs();
  return {
    ...position,
    feeSinceOpen,
    breakEvenPrice: calculateBreakEvenPrice(position.entryPrice, breakEvenMove.toString(), position.side),
    netPnl,
    trafficLight: getTradeOutcomeStatus(position.unrealizedPnl, netPnl)
  };
}

function applyFundingDelta(position: LivePosition, fundingDelta: string): LivePosition {
  const fundingSinceOpen = dec(position.fundingSinceOpen).plus(fundingDelta).toString();
  const netPnl = dec(position.unrealizedPnl).minus(position.feeSinceOpen).plus(fundingSinceOpen).toString();
  return {
    ...position,
    fundingSinceOpen,
    netPnl,
    trafficLight: getTradeOutcomeStatus(position.unrealizedPnl, netPnl)
  };
}

function applySlippagePrice(currentPrice: string, side: TradeSide, slippageBps: string): string {
  const multiplier = dec(slippageBps).div(10_000);
  return side === "long"
    ? dec(currentPrice).mul(dec(1).plus(multiplier)).toString()
    : dec(currentPrice).mul(dec(1).minus(multiplier)).toString();
}

function formatSize(size: ReturnType<typeof dec>, szDecimals: number): string {
  return size.toDecimalPlaces(szDecimals, 1).toString();
}

function extractError(status: unknown): string {
  if (typeof status === "object" && status !== null && "error" in status) {
    return String((status as { error?: unknown }).error ?? "Hyperliquid rechazo la accion.");
  }
  return "Hyperliquid rechazo la accion.";
}

function isSameFill(left: LiveFill, right: LiveFill): boolean {
  return left.coin === right.coin && left.orderId === right.orderId && left.price === right.price && left.timestamp === right.timestamp;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function createBrowserWalletAdapter(provider: Eip1193Provider): AbstractViemJsonRpcAccount {
  const walletClient = createWalletClient({
    transport: custom(provider)
  });

  return {
    async signTypedData(params) {
      const [address] = await this.getAddresses();
      const signature = await requestTypedDataSignature(walletClient, provider, address, params);

      return String(signature) as `0x${string}`;
    },
    async getAddresses() {
      const accounts = await getViemAddresses(walletClient);
      return accounts.map((account) => account as `0x${string}`);
    },
    async getChainId() {
      const rawChainId = (await provider.request({ method: "eth_chainId" })) as string;
      return Number.parseInt(rawChainId, 16);
    }
  };
}

async function requestTypedDataSignature(
  walletClient: ReturnType<typeof createWalletClient>,
  provider: Eip1193Provider,
  address: `0x${string}`,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }
) {
  try {
    return await signTypedDataWithViem(walletClient, {
      account: address,
      domain: typedData.domain as {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message
    });
  } catch (error) {
    const payload = JSON.stringify({
      domain: typedData.domain,
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" }
        ],
        ...typedData.types
      },
      primaryType: typedData.primaryType,
      message: typedData.message
    });

    return await requestTypedDataSignatureFallback(provider, address, payload, typedData, error);
  }
}

async function requestTypedDataSignatureFallback(
  provider: Eip1193Provider,
  address: `0x${string}`,
  payload: string,
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  },
  initialError: unknown
) {
  const attempts: Array<{ method: string; params: unknown[] }> = [
    { method: "eth_signTypedData_v4", params: [address, payload] },
    { method: "eth_signTypedData_v4", params: [payload, address] },
    { method: "eth_signTypedData_v4", params: [address, typedData] },
    { method: "eth_signTypedData_v3", params: [address, payload] },
    { method: "eth_signTypedData_v3", params: [payload, address] },
    { method: "eth_signTypedData", params: [address, typedData] },
    { method: "eth_signTypedData", params: [payload, address] },
    { method: "eth_signTypedData", params: [address, payload] }
  ];

  let lastError: unknown = initialError;
  for (const attempt of attempts) {
    try {
      return await provider.request({
        method: attempt.method,
        params: attempt.params
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to sign the typed data using the wallet");
}

function stringOrUndefined(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : Number(value);
}
