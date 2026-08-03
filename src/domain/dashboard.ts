import { Decimal, dec } from "./decimal";
import { money } from "./money";
import { buildPositionCycles } from "./cycles";
import { buildAccountingAudit, deriveGrossTradingPnl, deriveNetPnl, hasUnknownLedgerRows, splitRawFee } from "./accounting";
import { determineProfitStatus, hasUnknownFeeToken, toleranceDecimal } from "./profitStatus";
import type {
  AccountMode,
  ClosedCyclePresentation,
  DailySummaryPresentation,
  DashboardPresentation,
  Fill,
  HyperliquidSnapshot,
  LedgerUpdate,
  PositionPresentation,
  ProfitStatus,
  UserSettings
} from "./types";

export function buildDashboard(snapshot: HyperliquidSnapshot, settings: UserSettings): DashboardPresentation {
  const tolerance = toleranceDecimal(settings.toleranceUsdc);
  const accountValue = dec(snapshot.clearinghouseState.accountValue);
  const withdrawable = dec(snapshot.clearinghouseState.withdrawable);
  const marginUsed = dec(snapshot.clearinghouseState.marginUsed);
  const unrealizedPnl = dec(snapshot.clearinghouseState.unrealizedPnl);
  const accountSummary = buildAccountSummary(snapshot);
  const fills = snapshot.fills;
  const fundings = snapshot.fundings;
  const builderFeeDetected = fills.some((fill) => dec(fill.rawBuilderFee ?? "0").gt(0));
  const cycles = buildPositionCycles(fills, fundings);

  const externalDeposits = sumLedger(snapshot.ledgerUpdates, "externalDeposits");
  const externalWithdrawals = sumLedger(snapshot.ledgerUpdates, "externalWithdrawals");
  const netExternalDeposits = externalDeposits.minus(externalWithdrawals);
  const rawClosedPnl = fills.reduce((sum, fill) => sum.plus(dec(fill.rawClosedPnl)), new Decimal(0));
  const rawFeeNet = fills
    .filter((fill) => fill.feeToken.toUpperCase() === "USDC")
    .reduce((sum, fill) => sum.plus(dec(fill.rawFee)), new Decimal(0));
  const feePaid = fills
    .filter((fill) => fill.feeToken.toUpperCase() === "USDC" && dec(fill.rawFee).gt(0))
    .reduce((sum, fill) => sum.plus(dec(fill.rawFee)), new Decimal(0));
  const rebateReceived = fills
    .filter((fill) => fill.feeToken.toUpperCase() === "USDC" && dec(fill.rawFee).lt(0))
    .reduce((sum, fill) => sum.plus(dec(fill.rawFee).abs()), new Decimal(0));
  const builderFeeIncluded = fills
    .filter((fill) => fill.feeToken.toUpperCase() === "USDC")
    .reduce((sum, fill) => sum.plus(dec(fill.rawBuilderFee ?? "0")), new Decimal(0));
  const nonUsdcFeeTokens = aggregateNonUsdcFees(fills);
  const funding = fundings.reduce((sum, entry) => sum.plus(dec(entry.rawFunding)), new Decimal(0));
  const accountValueAdjustedResult = accountValue.plus(externalWithdrawals).minus(externalDeposits);
  const otherAdjustments = sumReconciliationAdjustments(snapshot.ledgerUpdates);
  const audit = buildAccountingAudit(snapshot, accountValueAdjustedResult, rawClosedPnl, rawFeeNet, builderFeeIncluded, funding, otherAdjustments);
  const netPnlDerived = audit.netPnlDerived?.exact;
  const grossTradingPnl = audit.grossTradingPnl?.exact;
  const unknownLedger = hasUnknownLedgerRows(snapshot.ledgerUpdates);
  const reconciliationVerified =
    audit.semantics.verified && snapshot.historyCoverage.isCompleteForRequestedPeriod && !unknownLedger && netPnlDerived !== undefined;
  const reconciliationDifference =
    reconciliationVerified && netPnlDerived !== undefined ? accountValueAdjustedResult.minus(netPnlDerived) : undefined;

  const summaryStatus = determineProfitStatus({
    gross: grossTradingPnl?.plus(unrealizedPnl) ?? rawClosedPnl.plus(unrealizedPnl),
    net: netPnlDerived ?? rawClosedPnl.plus(unrealizedPnl),
    tolerance,
    incomplete: !snapshot.historyCoverage.isCompleteForRequestedPeriod,
    stale: snapshot.stale,
    feeTokenUnknown: nonUsdcFeeTokens.length > 0,
    fundingIncomplete: false,
    reconciled: reconciliationDifference?.abs().lte(new Decimal(0.01)) ?? false,
    ambiguousAccounting: !audit.semantics.verified || unknownLedger
  });

  return {
    summary: {
      accountMode: snapshot.accountIdentity.mode,
      accountModeLabel: accountModeLabel(snapshot.accountIdentity.mode),
      totalEquity: money(accountSummary.totalEquity, { estimated: accountSummary.totalEquityEstimated }),
      tradingEquity: money(accountSummary.tradingEquity, { estimated: accountSummary.tradingEquityEstimated }),
      totalEquityVerified: accountSummary.totalEquityVerified,
      totalEquitySource: accountSummary.totalEquitySource,
      tradingEquitySource: accountSummary.tradingEquitySource,
      totalEquityFormula: accountSummary.totalEquityFormula,
      tradingEquityFormula: accountSummary.tradingEquityFormula,
      totalEquityWarning: accountSummary.totalEquityWarning,
      usdcTotal: money(accountSummary.usdcTotal),
      usdcHeld: money(accountSummary.usdcHeld),
      usdcAvailable: money(accountSummary.usdcAvailable),
      openPositionsCount: snapshot.clearinghouseState.positions.length,
      otherSpotAssets: accountSummary.otherSpotAssets.map((asset) => ({
        coin: asset.coin,
        total: money(asset.total),
        held: money(asset.held),
        available: money(asset.available),
        entryNotional: asset.entryNotional ? money(asset.entryNotional, { estimated: true }) : undefined
      })),
      duplicateRiskWarning: accountSummary.duplicateRiskWarning,
      accountValue: money(accountValue),
      withdrawable: money(withdrawable),
      marginUsed: money(marginUsed),
      netExternalDeposits: money(netExternalDeposits),
      accountValueAdjustedResult: money(accountValueAdjustedResult),
      apiClosedPnl: money(rawClosedPnl),
      rawFeeNet: money(rawFeeNet),
      feePaid: money(feePaid),
      rebateReceived: money(rebateReceived),
      builderFeeIncluded: money(builderFeeIncluded),
      feeOtherTokens: nonUsdcFeeTokens,
      funding: money(funding),
      grossTradingPnl: grossTradingPnl ? money(grossTradingPnl) : undefined,
      netPnlDerived: netPnlDerived ? money(netPnlDerived) : undefined,
      unrealizedPnl: money(unrealizedPnl),
      officialEstimates: [
        { label: "Estimación oficial 24 h", value: money(getPortfolioEstimate(snapshot, "day"), { estimated: true }) },
        { label: "Estimación oficial 7 días", value: money(getPortfolioEstimate(snapshot, "week"), { estimated: true }) },
        { label: "Estimación oficial 30 días", value: money(getPortfolioEstimate(snapshot, "month"), { estimated: true }) }
      ],
      stale: snapshot.stale,
      status: summaryStatus,
      semantics: audit.semantics
    },
    positions: buildPositionPresentation(snapshot, cycles, settings, reconciliationDifference, audit.semantics.verified, unknownLedger),
    rawFills: fills.slice().sort((a, b) => b.time - a.time),
    dailySummaries: buildDailySummaries(snapshot, settings),
    closedCycles: buildClosedCyclePresentation(snapshot, cycles, settings),
    movements: groupMovements(snapshot.ledgerUpdates),
    openOrders: snapshot.openOrders,
    reconciliation: {
      accountValueAdjustedResult: money(accountValueAdjustedResult),
      netPnlDerived: netPnlDerived ? money(netPnlDerived) : undefined,
      difference: reconciliationDifference ? money(reconciliationDifference) : undefined,
      warning: reconciliationDifference?.abs().gt(new Decimal(0.01)) ?? true,
      verified: reconciliationVerified && (reconciliationDifference?.abs().lte(new Decimal(0.01)) ?? false)
    },
    methodologyWarnings: collectWarnings(snapshot, builderFeeDetected, unknownLedger, audit.semantics.verified),
    builderFeeDetected,
    historyCoverage: snapshot.historyCoverage,
    audit,
    diagnostics: {
      environment: snapshot.network,
      addressShort: shortAddress(snapshot.address),
      userAbstractionRaw: snapshot.raw.userAbstraction,
      userRoleRaw: snapshot.raw.userRole,
      clearinghouseStateRaw: snapshot.raw.clearinghouseState,
      spotClearinghouseStateRaw: snapshot.raw.spotClearinghouseState,
      subAccountsRaw: snapshot.raw.subAccounts,
      fieldsUsed: [
        { label: "Tipo de cuenta", field: "raw.userAbstraction -> accountIdentity.mode" },
        { label: "Total Equity", field: accountSummary.totalEquitySource },
        { label: "Trading Equity", field: accountSummary.tradingEquitySource },
        { label: "USDC total", field: "spotClearinghouseState.balances[coin=USDC].total" },
        { label: "USDC retenido", field: "spotClearinghouseState.balances[coin=USDC].hold" },
        { label: "USDC disponible", field: "spotClearinghouseState.balances[coin=USDC].total - hold" },
        { label: "Margen usado", field: "clearinghouseState.marginUsed" },
        { label: "Posiciones abiertas", field: "clearinghouseState.assetPositions" }
      ],
      formulas: [
        { label: "Total Equity", formula: accountSummary.totalEquityFormula },
        { label: "Trading Equity", formula: accountSummary.tradingEquityFormula },
        { label: "USDC disponible", formula: "USDC total - USDC retenido" }
      ],
      duplicationWarning: accountSummary.duplicateRiskWarning
    }
  };
}

function buildAccountSummary(snapshot: HyperliquidSnapshot) {
  const usdcBalance = snapshot.spotClearinghouseState.balances.find((balance) => balance.coin.toUpperCase() === "USDC");
  const usdcTotal = dec(usdcBalance?.total ?? "0");
  const usdcHeld = dec(usdcBalance?.hold ?? "0");
  const usdcAvailable = usdcTotal.minus(usdcHeld);
  const otherSpotAssets = snapshot.spotClearinghouseState.balances
    .filter((balance) => balance.coin.toUpperCase() !== "USDC")
    .map((balance) => {
      const total = dec(balance.total);
      const held = dec(balance.hold);
      return {
        coin: balance.coin,
        total,
        held,
        available: total.minus(held),
        entryNotional: balance.entryNtl ? dec(balance.entryNtl) : undefined
      };
    });
  const otherSpotEntryNotional = otherSpotAssets.reduce((sum, balance) => sum.plus(balance.entryNotional ?? dec(0)), dec(0));
  const otherAssetsPresent = otherSpotAssets.length > 0;
  const clearinghouseValue = dec(snapshot.clearinghouseState.accountValue);
  const duplicateRiskWarning =
    snapshot.accountIdentity.mode === "standard"
      ? "No se suma spot y perps automaticamente salvo cuando la lectura es inequívoca, para evitar doble contabilización."
      : "No se suma clearinghouseState.accountValue al spot en cuentas unificadas para evitar doble contabilización.";

  if (snapshot.accountIdentity.mode === "unifiedAccount" || snapshot.accountIdentity.mode === "portfolioMargin") {
    return {
      totalEquity: usdcTotal.plus(otherSpotEntryNotional),
      tradingEquity: usdcTotal.plus(otherSpotEntryNotional),
      totalEquityEstimated: otherAssetsPresent,
      tradingEquityEstimated: otherAssetsPresent,
      totalEquityVerified: !otherAssetsPresent,
      totalEquitySource:
        snapshot.accountIdentity.mode === "unifiedAccount"
          ? "spotClearinghouseState.balances (cuenta unificada)"
          : "spotClearinghouseState.balances (portfolio margin)",
      tradingEquitySource: "spotClearinghouseState.balances",
      totalEquityFormula: otherAssetsPresent ? "USDC total + suma(entryNtl de otros activos spot)" : "USDC total",
      tradingEquityFormula: otherAssetsPresent ? "USDC total + suma(entryNtl de otros activos spot)" : "USDC total",
      totalEquityWarning: otherAssetsPresent
        ? "La equity incluye otros activos spot valorados con entryNtl y queda marcada como estimada."
        : undefined,
      usdcTotal,
      usdcHeld,
      usdcAvailable,
      otherSpotAssets,
      duplicateRiskWarning
    };
  }

  if (snapshot.accountIdentity.mode === "standard") {
    const onlyPerps = clearinghouseValue.gt(0) && usdcTotal.eq(0);
    const onlySpot = clearinghouseValue.eq(0) && usdcTotal.gt(0) && !otherAssetsPresent;
    const canCombine = onlyPerps || onlySpot;
    return {
      totalEquity: onlyPerps ? clearinghouseValue : onlySpot ? usdcTotal : dec(0),
      tradingEquity: clearinghouseValue,
      totalEquityEstimated: false,
      tradingEquityEstimated: false,
      totalEquityVerified: canCombine,
      totalEquitySource: canCombine
        ? onlyPerps
          ? "clearinghouseState.marginSummary.accountValue"
          : "spotClearinghouseState.balances[coin=USDC].total"
        : "Separado: perps y spot sin combinar",
      tradingEquitySource: "clearinghouseState.marginSummary.accountValue",
      totalEquityFormula: canCombine
        ? onlyPerps
          ? "accountValue de perps"
          : "USDC total spot"
        : "No verificado: se muestran perps y spot por separado",
      tradingEquityFormula: "clearinghouseState.accountValue",
      totalEquityWarning: canCombine ? undefined : "Total combinado no verificado para evitar doble contabilización.",
      usdcTotal,
      usdcHeld,
      usdcAvailable,
      otherSpotAssets,
      duplicateRiskWarning
    };
  }

  const spotValid = usdcTotal.gt(0) || otherAssetsPresent;
  const clearinghouseValid = clearinghouseValue.gt(0);
  return {
    totalEquity: dec(0),
    tradingEquity: clearinghouseValid ? clearinghouseValue : usdcTotal.plus(otherSpotEntryNotional),
    totalEquityEstimated: false,
    tradingEquityEstimated: otherAssetsPresent,
    totalEquityVerified: false,
    totalEquitySource: "No verificado",
    tradingEquitySource: clearinghouseValid ? "clearinghouseState.accountValue" : "spotClearinghouseState.balances",
    totalEquityFormula: "No verificado: raw spot y raw perps se muestran por separado",
    tradingEquityFormula: clearinghouseValid ? "clearinghouseState.accountValue" : "USDC total + suma(entryNtl spot)",
    totalEquityWarning:
      spotValid || clearinghouseValid
        ? "Modo de cuenta desconocido. Se evita promover un total combinado hasta verificar la fuente correcta."
        : "No hay una fuente verificada suficiente para el total.",
    usdcTotal,
    usdcHeld,
    usdcAvailable,
    otherSpotAssets,
    duplicateRiskWarning
  };
}

function buildPositionPresentation(
  snapshot: HyperliquidSnapshot,
  cycles: ReturnType<typeof buildPositionCycles>,
  settings: UserSettings,
  reconciliationDifference: Decimal | undefined,
  semanticsVerified: boolean,
  unknownLedger: boolean
): PositionPresentation[] {
  const tolerance = toleranceDecimal(settings.toleranceUsdc);
  const closeRateTaker = dec(snapshot.userFees.userCrossRate);
  const closeRateMaker = dec(snapshot.userFees.userAddRate);
  const slippageRate = dec(settings.slippageBps).div(10000);
  const markMap = new Map(snapshot.marketContexts.map((context) => [context.coin, dec(context.markPrice)]));

  return snapshot.clearinghouseState.positions.map((position) => {
    const exactSize = dec(position.size);
    const mark = markMap.get(position.coin);
    const cycle = [...cycles].reverse().find((candidate) => candidate.coin === position.coin && candidate.openQuantity.abs().gt(0));
    const nominal = dec(position.positionValue).abs();
    const rawClosedPnlAttributed = cycle?.rawClosedPnl ?? dec(0);
    const rawFeeNet = cycle?.rawFeeNetUsdc ?? dec(0);
    const feePaid = cycle?.feePaidUsdc ?? dec(0);
    const rebateReceived = cycle?.rebateReceivedUsdc ?? dec(0);
    const funding = cycle?.fundingAttributed ?? dec(0);
    const estimatedCloseFeeTaker = nominal.mul(closeRateTaker);
    const estimatedCloseFeeMaker = nominal.mul(closeRateMaker);
    const netIfCloseNow = deriveNetPnl("includes_fee", rawClosedPnlAttributed, rawFeeNet, funding, dec(position.unrealizedPnl), estimatedCloseFeeTaker.neg());
    const conservativeNet = netIfCloseNow?.minus(nominal.mul(slippageRate));
    const feeTokens = cycle?.feesOtherTokens.map((entry) => entry.token) ?? [];
    const accountingAmbiguous = !semanticsVerified || unknownLedger;
    const status = determineProfitStatus({
      gross: dec(position.unrealizedPnl),
      net: netIfCloseNow ?? dec(position.unrealizedPnl),
      tolerance,
      incomplete: !snapshot.historyCoverage.isCompleteForRequestedPeriod,
      stale: snapshot.stale,
      feeTokenUnknown: hasUnknownFeeToken(feeTokens),
      fundingIncomplete: !(cycle?.fundingAttributionComplete ?? false),
      reconciled: reconciliationDifference?.abs().lte(new Decimal(0.01)) ?? false,
      ambiguousAccounting: accountingAmbiguous
    });
    const warnings: string[] = [];

    if (!semanticsVerified) {
      warnings.push("La relación entre closedPnl y fee no está verificada con certeza para esta contabilidad.");
    }
    if (feeTokens.length > 0) {
      warnings.push("Hay comisiones en token distinto de USDC; se muestran separadas y no se convierten.");
    }
    if (snapshot.stale) {
      warnings.push("Los datos están desactualizados.");
    }
    if (!snapshot.historyCoverage.isCompleteForRequestedPeriod) {
      warnings.push("La cobertura histórica es incompleta para el periodo solicitado.");
    }
    if (unknownLedger) {
      warnings.push("Existen movimientos de ledger sin clasificar; la reconciliación permanece gris.");
    }

    return {
      key: `${position.coin}-${position.size}`,
      coin: position.coin,
      direction: exactSize.greaterThanOrEqualTo(0) ? "Long" : "Short",
      markPrice: mark ? money(mark) : undefined,
      entryPrice: money(position.entryPrice),
      liquidationPrice: position.liquidationPrice ? money(position.liquidationPrice) : undefined,
      nominalRemaining: money(nominal),
      grossUnrealized: money(position.unrealizedPnl),
      rawClosedPnlAttributed: money(rawClosedPnlAttributed),
      rawFeeNet: money(rawFeeNet),
      feePaid: money(feePaid),
      rebateReceived: money(rebateReceived),
      builderFeeIncluded: money(cycle?.totalBuilderFeeIncluded ?? dec(0)),
      fundingNet: money(funding),
      estimatedCloseFee: money(estimatedCloseFeeTaker, { estimated: true }),
      estimatedCloseFeeMaker: money(estimatedCloseFeeMaker, { estimated: true }),
      netIfCloseNow: netIfCloseNow ? money(netIfCloseNow, { estimated: true }) : undefined,
      conservativeNet: conservativeNet ? money(conservativeNet, { estimated: true }) : undefined,
      grossTradingPnl: semanticsVerified
        ? money(deriveGrossTradingPnl("includes_fee", rawClosedPnlAttributed, rawFeeNet) ?? rawClosedPnlAttributed)
        : undefined,
      movementToNetProfit:
        netIfCloseNow && netIfCloseNow.lt(0) && exactSize.abs().gt(0)
          ? money(netIfCloseNow.abs().div(exactSize.abs()), { estimated: true })
          : money("0", { estimated: true }),
      leverage: position.leverage,
      roe: position.returnOnEquity,
      marginMode: normalizeMarginMode(position.marginMode),
      marginUsed: money(position.marginUsed),
      feeRateUsed: closeRateTaker.toString(),
      stale: snapshot.stale,
      status,
      warnings,
      cycle: cycle ?? fallbackCycle(position.coin, exactSize),
      lastUpdated: snapshot.fetchedAt
    };
  });
}

function fallbackCycle(coin: string, quantity: Decimal) {
  return {
    id: `${coin}-fallback`,
    coin,
    side: quantity.greaterThanOrEqualTo(0) ? ("long" as const) : ("short" as const),
    fills: [],
    openQuantity: quantity,
    rawClosedPnl: dec(0),
    rawFeeNetUsdc: dec(0),
    feePaidUsdc: dec(0),
    rebateReceivedUsdc: dec(0),
    totalBuilderFeeIncluded: dec(0),
    feesOtherTokens: [],
    fundingAttributed: dec(0),
    fundingAttributionComplete: false
  };
}

function buildDailySummaries(snapshot: HyperliquidSnapshot, settings: UserSettings): DailySummaryPresentation[] {
  const tolerance = toleranceDecimal(settings.toleranceUsdc);
  const buckets = new Map<string, Fill[]>();
  const fundingBuckets = new Map<string, Decimal>();
  const semantics = snapshot.fills.length > 0 ? buildAccountingAudit(snapshot, dec(0), dec(0), dec(0), dec(0), dec(0), dec(0)).semantics : undefined;

  snapshot.fills.forEach((fill) => {
    const key = dayKey(fill.time);
    buckets.set(key, [...(buckets.get(key) ?? []), fill]);
  });

  snapshot.fundings.forEach((entry) => {
    const key = dayKey(entry.time);
    fundingBuckets.set(key, (fundingBuckets.get(key) ?? dec(0)).plus(dec(entry.rawFunding)));
  });

  return [...buckets.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, fills]) => {
      const apiClosedPnl = fills.reduce((sum, fill) => sum.plus(dec(fill.rawClosedPnl)), dec(0));
      const makerFeePaid = fills.filter((fill) => !fill.crossed && dec(fill.rawFee).gt(0)).reduce((sum, fill) => sum.plus(dec(fill.rawFee)), dec(0));
      const takerFeePaid = fills.filter((fill) => fill.crossed && dec(fill.rawFee).gt(0)).reduce((sum, fill) => sum.plus(dec(fill.rawFee)), dec(0));
      const makerRebateReceived = fills
        .filter((fill) => !fill.crossed && dec(fill.rawFee).lt(0))
        .reduce((sum, fill) => sum.plus(dec(fill.rawFee).abs()), dec(0));
      const takerRebateReceived = fills
        .filter((fill) => fill.crossed && dec(fill.rawFee).lt(0))
        .reduce((sum, fill) => sum.plus(dec(fill.rawFee).abs()), dec(0));
      const rawFeeNet = fills.reduce((sum, fill) => sum.plus(dec(fill.rawFee)), dec(0));
      const funding = fundingBuckets.get(day) ?? dec(0);
      const derivedNetPnl = semantics?.verified ? deriveNetPnl(semantics.mode, apiClosedPnl, rawFeeNet, funding, dec(0), dec(0)) : undefined;

      return {
        day,
        apiClosedPnl: money(apiClosedPnl),
        makerFeePaid: money(makerFeePaid),
        takerFeePaid: money(takerFeePaid),
        makerRebateReceived: money(makerRebateReceived),
        takerRebateReceived: money(takerRebateReceived),
        rawFeeNet: money(rawFeeNet),
        funding: money(funding),
        derivedNetPnl: derivedNetPnl ? money(derivedNetPnl) : undefined,
        volume: money(fills.reduce((sum, fill) => sum.plus(dec(fill.notional)), dec(0))),
        executions: fills.length,
        verified: Boolean(semantics?.verified),
        status: determineProfitStatus({
          gross: derivedNetPnl ?? apiClosedPnl,
          net: derivedNetPnl ?? apiClosedPnl,
          tolerance,
          incomplete: !snapshot.historyCoverage.isCompleteForRequestedPeriod,
          stale: snapshot.stale,
          feeTokenUnknown: fills.some((fill) => fill.feeToken.toUpperCase() !== "USDC"),
          fundingIncomplete: false,
          reconciled: semantics?.verified ?? false,
          ambiguousAccounting: !(semantics?.verified ?? false)
        })
      };
    });
}

function buildClosedCyclePresentation(
  snapshot: HyperliquidSnapshot,
  cycles: ReturnType<typeof buildPositionCycles>,
  settings: UserSettings
): ClosedCyclePresentation[] {
  const tolerance = toleranceDecimal(settings.toleranceUsdc);
  const semantics = buildAccountingAudit(snapshot, dec(0), dec(0), dec(0), dec(0), dec(0), dec(0)).semantics;

  return cycles
    .filter((cycle) => cycle.closedAt !== undefined)
    .map((cycle) => {
      const funding = cycle.fundingAttributed ?? dec(0);
      const derivedNet = semantics.verified
        ? deriveNetPnl(semantics.mode, cycle.rawClosedPnl, cycle.rawFeeNetUsdc, funding, dec(0), dec(0))
        : undefined;
      const { feePaid, rebateReceived } = splitRawFee(cycle.rawFeeNetUsdc);
      return {
        id: cycle.id,
        coin: cycle.coin,
        status: determineProfitStatus({
          gross: derivedNet ?? cycle.rawClosedPnl,
          net: derivedNet ?? cycle.rawClosedPnl,
          tolerance,
          incomplete: !snapshot.historyCoverage.isCompleteForRequestedPeriod,
          stale: snapshot.stale,
          feeTokenUnknown: cycle.feesOtherTokens.length > 0,
          fundingIncomplete: !cycle.fundingAttributionComplete,
          reconciled: semantics.verified,
          ambiguousAccounting: !semantics.verified
        }),
        apiClosedPnl: money(cycle.rawClosedPnl),
        rawFeeNet: money(cycle.rawFeeNetUsdc),
        feePaid: money(feePaid),
        rebateReceived: money(rebateReceived),
        builderFeeIncluded: money(cycle.totalBuilderFeeIncluded),
        funding: money(funding),
        derivedNetPnl: derivedNet ? money(derivedNet) : undefined,
        executions: cycle.fills.length,
        durationLabel: durationLabel(cycle.firstOpenAt, cycle.closedAt),
        averageEntryPrice: cycle.averageEntryPrice ? money(cycle.averageEntryPrice) : undefined,
        averageExitPrice: cycle.averageExitPrice ? money(cycle.averageExitPrice) : undefined,
        verified: semantics.verified
      };
    })
    .sort((left, right) => right.id.localeCompare(left.id));
}

function durationLabel(start?: number, end?: number): string {
  if (!start || !end) {
    return "No disponible";
  }
  const hours = Math.max(0, Math.round((end - start) / 3_600_000));
  return `${hours} h`;
}

function getPortfolioEstimate(snapshot: HyperliquidSnapshot, period: string): Decimal {
  const found = snapshot.portfolio.find((entry) => entry.period.toLowerCase() === period.toLowerCase());
  const history = found?.pnlHistory;
  const value = history && history.length > 0 ? history[history.length - 1]?.value ?? "0" : "0";
  return dec(value);
}

function groupMovements(rows: LedgerUpdate[]): Record<string, LedgerUpdate[]> {
  const result: Record<string, LedgerUpdate[]> = {
    "Depósitos externos": [],
    "Retiradas externas": [],
    "Transferencias internas": [],
    Liquidaciones: [],
    Recompensas: [],
    Créditos: [],
    Débitos: [],
    "Movimientos de vault": [],
    "Movimiento sin clasificar": []
  };

  for (const row of rows.slice().sort((a, b) => b.time - a.time)) {
    const label =
      row.movementGroup === "externalDeposits"
        ? "Depósitos externos"
        : row.movementGroup === "externalWithdrawals"
          ? "Retiradas externas"
          : row.movementGroup === "internalTransfers"
            ? "Transferencias internas"
            : row.movementGroup === "liquidations"
              ? "Liquidaciones"
              : row.movementGroup === "rewards"
                ? "Recompensas"
                : row.movementGroup === "credits"
                  ? "Créditos"
                  : row.movementGroup === "debits"
                    ? "Débitos"
                    : row.movementGroup === "vaultMovements"
                      ? "Movimientos de vault"
                      : "Movimiento sin clasificar";
    result[label].push(row);
  }

  return result;
}

function sumLedger(rows: LedgerUpdate[], group: LedgerUpdate["movementGroup"]): Decimal {
  return rows
    .filter((row) => row.movementGroup === group)
    .reduce((sum, row) => sum.plus(dec(row.displayAmount ?? "0")), dec(0));
}

function sumReconciliationAdjustments(rows: LedgerUpdate[]): Decimal {
  return rows
    .filter((row) => row.movementGroup === "rewards" || row.movementGroup === "credits" || row.movementGroup === "debits")
    .reduce((sum, row) => sum.plus(dec(row.displayAmount ?? "0")), dec(0));
}

function aggregateNonUsdcFees(fills: Fill[]) {
  const map = new Map<string, Decimal>();
  fills
    .filter((fill) => fill.feeToken.toUpperCase() !== "USDC")
    .forEach((fill) => {
      map.set(fill.feeToken, (map.get(fill.feeToken) ?? dec(0)).plus(dec(fill.rawFee)));
    });
  return [...map.entries()].map(([token, amount]) => ({ token, amount }));
}

function dayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function normalizeMarginMode(value: string): string {
  if (value.toLowerCase().includes("cross")) {
    return "Cruzado";
  }
  if (value.toLowerCase().includes("isol")) {
    return "Aislado";
  }
  return value;
}

function accountModeLabel(mode: AccountMode): string {
  if (mode === "unifiedAccount") {
    return "Unificada";
  }
  if (mode === "portfolioMargin") {
    return "Portfolio Margin";
  }
  if (mode === "standard") {
    return "Estandar";
  }
  return "Desconocida";
}

function shortAddress(address: string): string {
  return address.length >= 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function collectWarnings(
  snapshot: HyperliquidSnapshot,
  builderFeeDetected: boolean,
  unknownLedger: boolean,
  semanticsVerified: boolean
): string[] {
  const warnings: string[] = [];
  if (!semanticsVerified) {
    warnings.push("La semántica de closedPnl frente a fee no está verificada; no se promueve como P&L bruto exacto.");
  }
  if (!snapshot.historyCoverage.isCompleteForRequestedPeriod) {
    warnings.push("La cobertura histórica es incompleta para el periodo solicitado.");
  }
  if (snapshot.stale) {
    warnings.push("Los datos visibles proceden del último snapshot guardado y están marcados como desactualizados.");
  }
  if (builderFeeDetected) {
    warnings.push("Se detectó builderFee histórico; se muestra como subconjunto informativo de fee, sin restarlo dos veces.");
  }
  if (unknownLedger) {
    warnings.push("Hay movimientos del ledger sin clasificar; la reconciliación permanece gris hasta revisarlos.");
  }
  return warnings;
}
