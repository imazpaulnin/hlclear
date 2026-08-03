import Decimal from "decimal.js";

export type Network = "testnet" | "mainnet";
export type SyncState = "idle" | "loading" | "ready" | "error";
export type ProfitColor = "red" | "orange" | "green" | "gray";
export type CloseMode = "taker" | "maker";
export type FillAccountingMode = "includes_fee" | "excludes_fee" | "unverified";

export interface UserSettings {
  address: string;
  network: Network;
  closeMode: CloseMode;
  slippageBps: string;
  toleranceUsdc: string;
}

export interface StoredAppState {
  settings: UserSettings;
  snapshots?: Partial<Record<Network, HyperliquidSnapshot>>;
}

export interface MoneyValue {
  raw: string;
  exact: Decimal;
  rounded: string;
  estimated?: boolean;
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: string;
}

export interface PortfolioPeriod {
  period: string;
  accountValueHistory: TimeSeriesPoint[];
  pnlHistory: TimeSeriesPoint[];
  volume: string;
}

export interface ClearinghouseState {
  accountValue: string;
  withdrawable: string;
  marginUsed: string;
  unrealizedPnl: string;
  positions: ApiPosition[];
}

export interface ApiPosition {
  coin: string;
  size: string;
  entryPrice: string;
  positionValue: string;
  unrealizedPnl: string;
  liquidationPrice?: string;
  leverage: string;
  marginUsed: string;
  marginMode: string;
  returnOnEquity?: string;
}

export interface PerpAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  marginMode?: string;
  marginTableId?: number;
}

export interface MarginTier {
  lowerBound: string;
  maxLeverage: number;
}

export interface MarginTable {
  id: number;
  description: string;
  marginTiers: MarginTier[];
}

export interface MarketContext {
  coin: string;
  markPrice: string;
  oraclePrice?: string;
  midPrice?: string;
  fundingRate?: string;
  openInterest?: string;
  premium?: string;
  dayNotionalVolume?: string;
}

export interface UserFees {
  userCrossRate: string;
  userAddRate: string;
  activeReferralDiscount: string;
  activeStakingDiscount: string;
  feeSchedule?: {
    cross?: string;
    add?: string;
    referralDiscount?: string;
  };
}

export interface OpenOrder {
  oid: number;
  coin: string;
  side: string;
  size: string;
  limitPrice: string;
  timestamp: number;
}

export interface Fill {
  stableId: string;
  time: number;
  coin: string;
  direction: string;
  price: string;
  size: string;
  notional: string;
  rawClosedPnl: string;
  rawFee: string;
  rawBuilderFee?: string;
  feeToken: string;
  crossed: boolean;
  orderId?: number;
  hash?: string;
  startPosition?: string;
}

export interface FundingEntry {
  id: string;
  time: number;
  coin: string;
  rawFunding: string;
}

export interface LedgerBase {
  type: string;
}

export interface LedgerDeposit extends LedgerBase {
  type: "deposit";
  usdc: string;
}

export interface LedgerWithdraw extends LedgerBase {
  type: "withdraw";
  usdc: string;
  nonce?: number;
  fee?: string;
}

export interface LedgerInternalTransfer extends LedgerBase {
  type: "internalTransfer";
  usdc: string;
  user: string;
  destination: string;
  fee?: string;
}

export interface LedgerSubAccountTransfer extends LedgerBase {
  type: "subAccountTransfer";
  usdc: string;
  user: string;
  destination: string;
}

export interface LedgerLiquidation extends LedgerBase {
  type: "liquidation";
  liquidatedNtlPos?: string;
  accountValue?: string;
  leverageType?: string;
  liquidatedPositions?: Array<{ coin: string; szi: string }>;
}

export interface LedgerVaultDeposit extends LedgerBase {
  type: "vaultDeposit";
  vault: string;
  usdc: string;
}

export interface LedgerVaultWithdraw extends LedgerBase {
  type: "vaultWithdraw";
  vault: string;
  user: string;
  requestedUsd: string;
  commission?: string;
  closingCost?: string;
  basis?: string;
  netWithdrawnUsd?: string;
}

export interface LedgerAccountClassTransfer extends LedgerBase {
  type: "accountClassTransfer";
  usdc: string;
  toPerp: boolean;
}

export interface LedgerSpotTransfer extends LedgerBase {
  type: "spotTransfer";
  token?: number | string;
  amount?: string;
  usdc?: string;
}

export interface LedgerRewardsClaim extends LedgerBase {
  type: "rewardsClaim";
  usdc?: string;
  amount?: string;
}

export interface LedgerVaultLeaderCommission extends LedgerBase {
  type: "vaultLeaderCommission";
  vault?: string;
  usdc?: string;
}

export interface LedgerSpotGenesis extends LedgerBase {
  type: "spotGenesis";
  token?: number | string;
  amount?: string;
}

export interface LedgerUnknown extends LedgerBase {
  type: "unknown";
  originalType?: string;
}

export type LedgerDelta =
  | LedgerDeposit
  | LedgerWithdraw
  | LedgerInternalTransfer
  | LedgerSubAccountTransfer
  | LedgerLiquidation
  | LedgerVaultDeposit
  | LedgerVaultWithdraw
  | LedgerAccountClassTransfer
  | LedgerSpotTransfer
  | LedgerRewardsClaim
  | LedgerVaultLeaderCommission
  | LedgerSpotGenesis
  | LedgerUnknown;

export type MovementGroup =
  | "externalDeposits"
  | "externalWithdrawals"
  | "internalTransfers"
  | "liquidations"
  | "rewards"
  | "credits"
  | "debits"
  | "vaultMovements"
  | "unknown";

export interface LedgerUpdate {
  id: string;
  time: number;
  hash?: string;
  delta: LedgerDelta;
  movementGroup: MovementGroup;
  displayAmount?: string;
  asset: string;
  raw: unknown;
  affectsReconciliation: boolean;
}

export interface HistoryCoverage {
  requestedStartTime: number;
  actualEarliestTimestamp?: number;
  actualLatestTimestamp?: number;
  fillsDownloaded: number;
  fundingEntriesDownloaded: number;
  ledgerEntriesDownloaded: number;
  reachedApiLimit: boolean;
  reachedInternalPageLimit: boolean;
  isCompleteForRequestedPeriod: boolean;
  reasonIfIncomplete?: string;
}

export interface FillSemanticsReport {
  mode: FillAccountingMode;
  verified: boolean;
  reason: string;
  exampleOpenFill?: Fill;
  exampleCloseFill?: Fill;
}

export interface TokenAggregate {
  token: string;
  amount: Decimal;
}

export interface PositionCycle {
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
  feesOtherTokens: TokenAggregate[];
  fundingAttributed?: Decimal;
  fundingAttributionComplete: boolean;
  averageEntryPrice?: Decimal;
  averageExitPrice?: Decimal;
  firstOpenAt?: number;
  lastActivityAt?: number;
  closedAt?: number;
}

export interface ProfitStatus {
  color: ProfitColor;
  icon: string;
  label: string;
  reason: string;
}

export interface AccountingAudit {
  rawClosedPnl: MoneyValue;
  rawFeeNet: MoneyValue;
  feePaid: MoneyValue;
  rebateReceived: MoneyValue;
  rawBuilderFeeIncluded: MoneyValue;
  rawFunding: MoneyValue;
  grossTradingPnl?: MoneyValue;
  netPnlDerived?: MoneyValue;
  accountValueAdjustedResult: MoneyValue;
  semantics: FillSemanticsReport;
  formulas: string[];
}

export interface PositionPresentation {
  key: string;
  coin: string;
  direction: "Long" | "Short";
  markPrice?: MoneyValue;
  entryPrice?: MoneyValue;
  liquidationPrice?: MoneyValue;
  nominalRemaining: MoneyValue;
  grossUnrealized: MoneyValue;
  rawClosedPnlAttributed: MoneyValue;
  rawFeeNet: MoneyValue;
  feePaid: MoneyValue;
  rebateReceived: MoneyValue;
  builderFeeIncluded: MoneyValue;
  fundingNet: MoneyValue;
  estimatedCloseFee: MoneyValue;
  estimatedCloseFeeMaker: MoneyValue;
  netIfCloseNow?: MoneyValue;
  conservativeNet?: MoneyValue;
  grossTradingPnl?: MoneyValue;
  movementToNetProfit?: MoneyValue;
  leverage?: string;
  roe?: string;
  marginMode: string;
  marginUsed: MoneyValue;
  feeRateUsed: string;
  stale: boolean;
  status: ProfitStatus;
  warnings: string[];
  cycle: PositionCycle;
  lastUpdated: string;
}

export interface DailySummaryPresentation {
  day: string;
  apiClosedPnl: MoneyValue;
  makerFeePaid: MoneyValue;
  takerFeePaid: MoneyValue;
  makerRebateReceived: MoneyValue;
  takerRebateReceived: MoneyValue;
  rawFeeNet: MoneyValue;
  funding: MoneyValue;
  derivedNetPnl?: MoneyValue;
  volume: MoneyValue;
  executions: number;
  status: ProfitStatus;
  verified: boolean;
}

export interface ClosedCyclePresentation {
  id: string;
  coin: string;
  status: ProfitStatus;
  apiClosedPnl: MoneyValue;
  rawFeeNet: MoneyValue;
  feePaid: MoneyValue;
  rebateReceived: MoneyValue;
  builderFeeIncluded: MoneyValue;
  funding: MoneyValue;
  derivedNetPnl?: MoneyValue;
  executions: number;
  durationLabel: string;
  averageEntryPrice?: MoneyValue;
  averageExitPrice?: MoneyValue;
  verified: boolean;
}

export interface ReconciliationPresentation {
  accountValueAdjustedResult: MoneyValue;
  netPnlDerived?: MoneyValue;
  difference?: MoneyValue;
  warning: boolean;
  verified: boolean;
}

export interface EstimatePresentation {
  label: string;
  value: MoneyValue;
}

export interface SummaryPresentation {
  accountValue: MoneyValue;
  withdrawable: MoneyValue;
  marginUsed: MoneyValue;
  netExternalDeposits: MoneyValue;
  accountValueAdjustedResult: MoneyValue;
  apiClosedPnl: MoneyValue;
  rawFeeNet: MoneyValue;
  feePaid: MoneyValue;
  rebateReceived: MoneyValue;
  builderFeeIncluded: MoneyValue;
  feeOtherTokens: TokenAggregate[];
  funding: MoneyValue;
  grossTradingPnl?: MoneyValue;
  netPnlDerived?: MoneyValue;
  unrealizedPnl: MoneyValue;
  officialEstimates: EstimatePresentation[];
  stale: boolean;
  status: ProfitStatus;
  semantics: FillSemanticsReport;
}

export interface DashboardPresentation {
  summary: SummaryPresentation;
  positions: PositionPresentation[];
  rawFills: Fill[];
  dailySummaries: DailySummaryPresentation[];
  closedCycles: ClosedCyclePresentation[];
  movements: Record<string, LedgerUpdate[]>;
  openOrders: OpenOrder[];
  reconciliation: ReconciliationPresentation;
  methodologyWarnings: string[];
  builderFeeDetected: boolean;
  historyCoverage: HistoryCoverage;
  audit: AccountingAudit;
}

export interface HyperliquidSnapshot {
  fetchedAt: string;
  address: string;
  network: Network;
  stale: boolean;
  apiHealth: "healthy" | "error";
  raw: {
    clearinghouseState: unknown;
    portfolio: unknown;
    userFees: unknown;
    metaAndAssetCtxs: unknown;
    openOrders: unknown;
    fills: unknown;
    funding: unknown;
    ledger: unknown;
  };
  clearinghouseState: ClearinghouseState;
  portfolio: PortfolioPeriod[];
  userFees: UserFees;
  universe: PerpAssetMeta[];
  marginTables: MarginTable[];
  marketContexts: MarketContext[];
  openOrders: OpenOrder[];
  fills: Fill[];
  fundings: FundingEntry[];
  ledgerUpdates: LedgerUpdate[];
  historyCoverage: HistoryCoverage;
}
