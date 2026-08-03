import { dec } from "../domain/decimal";
import type {
  ApiPosition,
  ClearinghouseState,
  Fill,
  FundingEntry,
  HistoryCoverage,
  HyperliquidSnapshot,
  LedgerDelta,
  LedgerUpdate,
  MarginTable,
  MarketContext,
  Network,
  OpenOrder,
  PerpAssetMeta,
  PortfolioPeriod,
  UserFees
} from "../domain/types";

const API_URLS: Record<Network, string> = {
  mainnet: "https://api.hyperliquid.xyz",
  testnet: "https://api.hyperliquid-testnet.xyz"
};

const OFFICIAL_FILL_PAGE_LIMIT = 2000;
const OFFICIAL_RECENT_FILL_CAP = 10000;
const INTERNAL_PAGE_LIMIT = 64;

export class HyperliquidApiError extends Error {}

export async function fetchSnapshot(address: string, network: Network): Promise<HyperliquidSnapshot> {
  const baseUrl = API_URLS[network];
  const fetchedAt = new Date().toISOString();
  const end = Date.now();
  const start = end - 1000 * 60 * 60 * 24 * 365 * 3;

  const [
    clearinghouseRaw,
    portfolioRaw,
    userFeesRaw,
    metaRaw,
    openOrdersRaw,
    fillsPage,
    fundingPage,
    ledgerPage
  ] = await Promise.all([
    post(baseUrl, { type: "clearinghouseState", user: address }),
    post(baseUrl, { type: "portfolio", user: address }),
    post(baseUrl, { type: "userFees", user: address }),
    post(baseUrl, { type: "metaAndAssetCtxs" }),
    post(baseUrl, { type: "openOrders", user: address }),
    fetchPaginated(baseUrl, "userFillsByTime", address, start, end, { officialRecentCap: OFFICIAL_RECENT_FILL_CAP }),
    fetchPaginated(baseUrl, "userFunding", address, start, end),
    fetchPaginated(baseUrl, "userNonFundingLedgerUpdates", address, start, end)
  ]);

  const fills = dedupeFills(fillsPage.items.flatMap(normalizeFills));
  const fundings = dedupeById(fundingPage.items.flatMap(normalizeFundings));
  const ledgerUpdates = dedupeById(ledgerPage.items.flatMap(normalizeLedger));

  return {
    fetchedAt,
    address,
    network,
    stale: false,
    apiHealth: "healthy",
    raw: {
      clearinghouseState: clearinghouseRaw,
      portfolio: portfolioRaw,
      userFees: userFeesRaw,
      metaAndAssetCtxs: metaRaw,
      openOrders: openOrdersRaw,
      fills: fillsPage.raw,
      funding: fundingPage.raw,
      ledger: ledgerPage.raw
    },
    clearinghouseState: normalizeClearinghouseState(clearinghouseRaw),
    portfolio: normalizePortfolio(portfolioRaw),
    userFees: normalizeUserFees(userFeesRaw),
    universe: normalizeUniverse(metaRaw),
    marginTables: normalizeMarginTables(metaRaw),
    marketContexts: normalizeMarketContexts(metaRaw),
    openOrders: normalizeOpenOrders(openOrdersRaw),
    fills,
    fundings,
    ledgerUpdates,
    historyCoverage: combineCoverage(start, fills, fundings, ledgerUpdates, fillsPage, fundingPage, ledgerPage)
  };
}

export function getReadOnlyPayloads(address: string, endTime: number): Array<Record<string, unknown>> {
  return [
    { type: "clearinghouseState", user: address },
    { type: "portfolio", user: address },
    { type: "userFees", user: address },
    { type: "metaAndAssetCtxs" },
    { type: "openOrders", user: address },
    { type: "userFillsByTime", user: address, startTime: 0, endTime },
    { type: "userFunding", user: address, startTime: 0, endTime },
    { type: "userNonFundingLedgerUpdates", user: address, startTime: 0, endTime }
  ];
}

async function post(baseUrl: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${baseUrl}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new HyperliquidApiError(`HTTP ${response.status} al consultar ${String(body.type)}`);
  }

  return response.json();
}

async function fetchPaginated(
  baseUrl: string,
  type: string,
  address: string,
  startTime: number,
  endTime: number,
  options?: { officialRecentCap?: number }
): Promise<{
  items: unknown[];
  raw: unknown[];
  actualEarliestTimestamp?: number;
  actualLatestTimestamp?: number;
  reachedApiLimit: boolean;
  reachedInternalPageLimit: boolean;
  isCompleteForRequestedPeriod: boolean;
  reasonIfIncomplete?: string;
}> {
  let cursor = startTime;
  const items: unknown[] = [];
  const raw: unknown[] = [];
  let reachedApiLimit = false;
  let reachedInternalPageLimit = false;

  for (let page = 0; page < INTERNAL_PAGE_LIMIT; page += 1) {
    const payload = (await post(baseUrl, {
      type,
      user: address,
      startTime: cursor,
      endTime
    })) as unknown[];

    raw.push(...payload);
    items.push(...payload);

    if (payload.length === 0) {
      break;
    }

    const timestamps = payload
      .map((entry) => {
        if (typeof entry === "object" && entry !== null && "time" in entry) {
          return Number((entry as { time: number }).time);
        }
        return 0;
      })
      .filter((value) => value > 0);

    const next = timestamps.reduce((max, value) => Math.max(max, value), 0);

    if (payload.length < OFFICIAL_FILL_PAGE_LIMIT || next <= cursor) {
      break;
    }

    if (options?.officialRecentCap && items.length >= options.officialRecentCap) {
      reachedApiLimit = true;
      break;
    }

    cursor = next + 1;

    if (page === INTERNAL_PAGE_LIMIT - 1) {
      reachedInternalPageLimit = true;
    }
  }

  const actualEarliestTimestamp = extractEdgeTimestamp(items, "min");
  const actualLatestTimestamp = extractEdgeTimestamp(items, "max");
  const isCompleteForRequestedPeriod =
    !reachedApiLimit &&
    !reachedInternalPageLimit &&
    (items.length === 0 || actualEarliestTimestamp === undefined || actualEarliestTimestamp <= startTime);

  let reasonIfIncomplete: string | undefined;
  if (reachedApiLimit) {
    reasonIfIncomplete = "Se alcanzó el límite oficial de fills recientes disponible por la API.";
  } else if (reachedInternalPageLimit) {
    reasonIfIncomplete = "Se alcanzó el límite interno de paginación defensiva.";
  } else if (actualEarliestTimestamp !== undefined && actualEarliestTimestamp > startTime) {
    reasonIfIncomplete = "La primera marca temporal descargada es posterior al periodo solicitado.";
  }

  return {
    items,
    raw,
    actualEarliestTimestamp,
    actualLatestTimestamp,
    reachedApiLimit,
    reachedInternalPageLimit,
    isCompleteForRequestedPeriod,
    reasonIfIncomplete
  };
}

function combineCoverage(
  requestedStartTime: number,
  fills: Fill[],
  fundings: FundingEntry[],
  ledgerUpdates: LedgerUpdate[],
  fillsPage: Awaited<ReturnType<typeof fetchPaginated>>,
  fundingPage: Awaited<ReturnType<typeof fetchPaginated>>,
  ledgerPage: Awaited<ReturnType<typeof fetchPaginated>>
): HistoryCoverage {
  const earliest = minDefined([
    extractEdgeTimestamp(fills, "min", (entry) => entry.time),
    extractEdgeTimestamp(fundings, "min", (entry) => entry.time),
    extractEdgeTimestamp(ledgerUpdates, "min", (entry) => entry.time)
  ]);
  const latest = maxDefined([
    extractEdgeTimestamp(fills, "max", (entry) => entry.time),
    extractEdgeTimestamp(fundings, "max", (entry) => entry.time),
    extractEdgeTimestamp(ledgerUpdates, "max", (entry) => entry.time)
  ]);
  const reachedApiLimit = fillsPage.reachedApiLimit || fundingPage.reachedApiLimit || ledgerPage.reachedApiLimit;
  const reachedInternalPageLimit =
    fillsPage.reachedInternalPageLimit || fundingPage.reachedInternalPageLimit || ledgerPage.reachedInternalPageLimit;
  const isCompleteForRequestedPeriod =
    fillsPage.isCompleteForRequestedPeriod &&
    fundingPage.isCompleteForRequestedPeriod &&
    ledgerPage.isCompleteForRequestedPeriod;

  const reasons = [fillsPage.reasonIfIncomplete, fundingPage.reasonIfIncomplete, ledgerPage.reasonIfIncomplete].filter(Boolean);

  return {
    requestedStartTime,
    actualEarliestTimestamp: earliest,
    actualLatestTimestamp: latest,
    fillsDownloaded: fills.length,
    fundingEntriesDownloaded: fundings.length,
    ledgerEntriesDownloaded: ledgerUpdates.length,
    reachedApiLimit,
    reachedInternalPageLimit,
    isCompleteForRequestedPeriod,
    reasonIfIncomplete: reasons.join(" ")
  };
}

function normalizeClearinghouseState(input: unknown): ClearinghouseState {
  const source = asRecord(input);
  const summary = asRecord(source.marginSummary ?? source.crossMarginSummary);
  const positions = Array.isArray(source.assetPositions)
    ? source.assetPositions
        .map((entry) => asRecord(asRecord(entry).position))
        .filter((entry) => Object.keys(entry).length > 0)
        .map(
          (entry): ApiPosition => ({
            coin: String(entry.coin ?? ""),
            size: String(entry.szi ?? "0"),
            entryPrice: String(entry.entryPx ?? "0"),
            positionValue: String(entry.positionValue ?? "0"),
            unrealizedPnl: String(entry.unrealizedPnl ?? "0"),
            liquidationPrice: entry.liquidationPx ? String(entry.liquidationPx) : undefined,
            leverage: String(asRecord(entry.leverage).value ?? entry.maxLeverage ?? "0"),
            marginUsed: String(entry.marginUsed ?? "0"),
            marginMode: String(asRecord(entry.leverage).type ?? entry.marginMode ?? "unknown"),
            returnOnEquity: entry.returnOnEquity ? String(entry.returnOnEquity) : undefined
          })
        )
    : [];

  return {
    accountValue: String(summary.accountValue ?? "0"),
    withdrawable: String(source.withdrawable ?? "0"),
    marginUsed: String(summary.totalMarginUsed ?? "0"),
    unrealizedPnl: positions.reduce((sum, position) => sum.plus(dec(position.unrealizedPnl)), dec(0)).toString(),
    positions
  };
}

function normalizePortfolio(input: unknown): PortfolioPeriod[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return [];
    }
    const [period, raw] = entry;
    const source = asRecord(raw);
    return [
      {
        period: String(period),
        accountValueHistory: toPoints(source.accountValueHistory),
        pnlHistory: toPoints(source.pnlHistory),
        volume: String(source.vlm ?? "0")
      }
    ];
  });
}

function normalizeUserFees(input: unknown): UserFees {
  const source = asRecord(input);
  return {
    userCrossRate: String(source.userCrossRate ?? "0"),
    userAddRate: String(source.userAddRate ?? "0"),
    activeReferralDiscount: String(source.activeReferralDiscount ?? "0"),
    activeStakingDiscount: String(asRecord(source.activeStakingDiscount).discount ?? "0"),
    feeSchedule: source.feeSchedule
      ? {
          cross: asRecord(source.feeSchedule).cross ? String(asRecord(source.feeSchedule).cross) : undefined,
          add: asRecord(source.feeSchedule).add ? String(asRecord(source.feeSchedule).add) : undefined,
          referralDiscount: asRecord(source.feeSchedule).referralDiscount
            ? String(asRecord(source.feeSchedule).referralDiscount)
            : undefined
        }
      : undefined
  };
}

function normalizeMarketContexts(input: unknown): MarketContext[] {
  if (!Array.isArray(input) || input.length < 2 || !Array.isArray(input[1])) {
    return [];
  }
  const contexts = input[1] as unknown[];
  const universe = Array.isArray(input[0]) ? [] : asRecord(input[0]).universe;
  const universeArray = Array.isArray(universe) ? universe : [];

  return contexts.map((entry, index) => {
    const record = asRecord(entry);
    const market = asRecord(universeArray[index]);
    return {
      coin: String(record.coin ?? market.name ?? `Asset ${index}`),
      markPrice: String(record.markPx ?? "0"),
      oraclePrice: record.oraclePx ? String(record.oraclePx) : undefined,
      midPrice: record.midPx ? String(record.midPx) : undefined,
      fundingRate: record.funding ? String(record.funding) : undefined,
      openInterest: record.openInterest ? String(record.openInterest) : undefined,
      premium: record.premium ? String(record.premium) : undefined,
      dayNotionalVolume: record.dayNtlVlm ? String(record.dayNtlVlm) : undefined
    };
  });
}

function normalizeUniverse(input: unknown): PerpAssetMeta[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  const source = asRecord(input[0]);
  const universe = Array.isArray(source.universe) ? source.universe : [];
  return universe.map((entry) => {
    const record = asRecord(entry);
    return {
      name: String(record.name ?? ""),
      szDecimals: Number(record.szDecimals ?? 0),
      maxLeverage: Number(record.maxLeverage ?? 1),
      onlyIsolated: Boolean(record.onlyIsolated ?? false),
      marginMode: record.marginMode ? String(record.marginMode) : undefined,
      marginTableId: record.marginTableId ? Number(record.marginTableId) : undefined
    };
  });
}

function normalizeMarginTables(input: unknown): MarginTable[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [];
  }
  const source = asRecord(input[0]);
  const rawTables = Array.isArray(source.marginTables) ? source.marginTables : [];

  return rawTables.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return [];
    }
    const [idValue, rawTable] = entry;
    const record = asRecord(rawTable);
    const tiers = Array.isArray(record.marginTiers) ? record.marginTiers : [];
    return [
      {
        id: Number(idValue),
        description: String(record.description ?? ""),
        marginTiers: tiers.map((tier) => {
          const tierRecord = asRecord(tier);
          return {
            lowerBound: String(tierRecord.lowerBound ?? "0"),
            maxLeverage: Number(tierRecord.maxLeverage ?? 1)
          };
        })
      }
    ];
  });
}

function normalizeOpenOrders(input: unknown): OpenOrder[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((entry) => {
    const source = asRecord(entry);
    return {
      oid: Number(source.oid ?? 0),
      coin: String(source.coin ?? ""),
      side: String(source.side ?? ""),
      size: String(source.sz ?? "0"),
      limitPrice: String(source.limitPx ?? "0"),
      timestamp: Number(source.timestamp ?? 0)
    };
  });
}

function normalizeFills(input: unknown): Fill[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((entry) => {
    const source = asRecord(entry);
    const tid = Number(source.tid ?? -1);
    const oid = Number(source.oid ?? -1);
    const time = Number(source.time ?? 0);
    const hash = source.hash ? String(source.hash) : undefined;
    return {
      stableId: `${tid}-${oid}-${time}-${hash ?? "nohash"}`,
      time,
      coin: String(source.coin ?? ""),
      direction: String(source.dir ?? ""),
      price: String(source.px ?? "0"),
      size: String(source.sz ?? "0"),
      notional: dec(String(source.px ?? "0")).mul(dec(String(source.sz ?? "0")).abs()).toString(),
      rawClosedPnl: String(source.closedPnl ?? "0"),
      rawFee: String(source.fee ?? "0"),
      rawBuilderFee: source.builderFee ? String(source.builderFee) : undefined,
      feeToken: String(source.feeToken ?? "USDC"),
      crossed: Boolean(source.crossed ?? false),
      orderId: source.oid ? Number(source.oid) : undefined,
      hash,
      startPosition: source.startPosition ? String(source.startPosition) : undefined
    };
  });
}

function normalizeFundings(input: unknown): FundingEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((entry) => {
    const source = asRecord(entry);
    const amount = source.usdc ?? source.funding ?? source.delta ?? "0";
    return {
      id: `${String(source.coin ?? "USDC")}-${String(source.time ?? "0")}-${String(amount)}`,
      time: Number(source.time ?? 0),
      coin: String(source.coin ?? "USDC"),
      rawFunding: String(amount)
    };
  });
}

function normalizeLedger(input: unknown): LedgerUpdate[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((entry) => {
    const source = asRecord(entry);
    const rawDelta = asRecord(source.delta);
    const decoded = decodeLedgerDelta(rawDelta);
    return {
      id: `${String(source.time ?? "0")}-${decoded.type}-${String(source.hash ?? "nohash")}`,
      time: Number(source.time ?? 0),
      hash: source.hash ? String(source.hash) : undefined,
      delta: decoded,
      movementGroup: classifyMovement(decoded),
      displayAmount: extractLedgerAmount(decoded),
      asset: "USDC",
      raw: entry,
      affectsReconciliation: classifyMovement(decoded) !== "unknown"
    };
  });
}

function decodeLedgerDelta(delta: Record<string, unknown>): LedgerDelta {
  const type = String(delta.type ?? "unknown");

  switch (type) {
    case "deposit":
      return { type, usdc: String(delta.usdc ?? "0") };
    case "withdraw":
      return { type, usdc: String(delta.usdc ?? "0"), nonce: numberOrUndefined(delta.nonce), fee: stringOrUndefined(delta.fee) };
    case "internalTransfer":
      return {
        type,
        usdc: String(delta.usdc ?? "0"),
        user: String(delta.user ?? ""),
        destination: String(delta.destination ?? ""),
        fee: stringOrUndefined(delta.fee)
      };
    case "subAccountTransfer":
      return {
        type,
        usdc: String(delta.usdc ?? "0"),
        user: String(delta.user ?? ""),
        destination: String(delta.destination ?? "")
      };
    case "liquidation":
      return {
        type,
        liquidatedNtlPos: stringOrUndefined(delta.liquidatedNtlPos),
        accountValue: stringOrUndefined(delta.accountValue),
        leverageType: stringOrUndefined(delta.leverageType),
        liquidatedPositions: Array.isArray(delta.liquidatedPositions)
          ? delta.liquidatedPositions.map((row) => {
              const record = asRecord(row);
              return { coin: String(record.coin ?? ""), szi: String(record.szi ?? "0") };
            })
          : undefined
      };
    case "vaultDeposit":
      return { type, vault: String(delta.vault ?? ""), usdc: String(delta.usdc ?? "0") };
    case "vaultWithdraw":
      return {
        type,
        vault: String(delta.vault ?? ""),
        user: String(delta.user ?? ""),
        requestedUsd: String(delta.requestedUsd ?? "0"),
        commission: stringOrUndefined(delta.commission),
        closingCost: stringOrUndefined(delta.closingCost),
        basis: stringOrUndefined(delta.basis),
        netWithdrawnUsd: stringOrUndefined(delta.netWithdrawnUsd)
      };
    case "accountClassTransfer":
      return { type, usdc: String(delta.usdc ?? "0"), toPerp: Boolean(delta.toPerp) };
    case "spotTransfer":
      return { type, token: delta.token as number | string | undefined, amount: stringOrUndefined(delta.amount), usdc: stringOrUndefined(delta.usdc) };
    case "rewardsClaim":
      return { type, usdc: stringOrUndefined(delta.usdc), amount: stringOrUndefined(delta.amount) };
    case "vaultLeaderCommission":
      return { type, vault: stringOrUndefined(delta.vault), usdc: stringOrUndefined(delta.usdc) };
    case "spotGenesis":
      return { type, token: delta.token as number | string | undefined, amount: stringOrUndefined(delta.amount) };
    default:
      return { type: "unknown", originalType: type };
  }
}

function classifyMovement(delta: LedgerDelta): LedgerUpdate["movementGroup"] {
  switch (delta.type) {
    case "deposit":
      return "externalDeposits";
    case "withdraw":
      return "externalWithdrawals";
    case "internalTransfer":
    case "subAccountTransfer":
    case "accountClassTransfer":
    case "spotTransfer":
      return "internalTransfers";
    case "liquidation":
      return "liquidations";
    case "rewardsClaim":
    case "vaultLeaderCommission":
      return "rewards";
    case "vaultDeposit":
    case "vaultWithdraw":
      return "vaultMovements";
    case "spotGenesis":
      return "credits";
    case "unknown":
    default:
      return "unknown";
  }
}

function extractLedgerAmount(delta: LedgerDelta): string | undefined {
  switch (delta.type) {
    case "deposit":
    case "withdraw":
    case "internalTransfer":
    case "subAccountTransfer":
    case "accountClassTransfer":
    case "vaultDeposit":
      return delta.usdc;
    case "vaultWithdraw":
      return delta.netWithdrawnUsd ?? delta.requestedUsd;
    case "rewardsClaim":
      return delta.usdc ?? delta.amount;
    case "vaultLeaderCommission":
      return delta.usdc;
    default:
      return undefined;
  }
}

function dedupeFills(fills: Fill[]): Fill[] {
  const seen = new Set<string>();
  return fills
    .slice()
    .sort((left, right) => left.time - right.time)
    .filter((fill) => {
      if (seen.has(fill.stableId)) {
        return false;
      }
      seen.add(fill.stableId);
      return true;
    });
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

function toPoints(input: unknown): PortfolioPeriod["accountValueHistory"] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return [];
    }
    return [{ timestamp: Number(entry[0]), value: String(entry[1] ?? "0") }];
  });
}

function extractEdgeTimestamp<T>(
  rows: T[],
  edge: "min" | "max",
  select?: (row: T) => number
): number | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const values = rows
    .map((row) =>
      select
        ? select(row)
        : typeof row === "object" && row !== null && "time" in (row as Record<string, unknown>)
          ? Number((row as unknown as { time: number }).time)
          : 0
    )
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return undefined;
  }

  return edge === "min" ? Math.min(...values) : Math.max(...values);
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => value !== undefined);
  return filtered.length > 0 ? Math.min(...filtered) : undefined;
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const filtered = values.filter((value): value is number => value !== undefined);
  return filtered.length > 0 ? Math.max(...filtered) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : Number(value);
}

export function getApiBaseUrl(network: Network): string {
  return API_URLS[network];
}

export function isAddressValid(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}
