import { Decimal, dec } from "./decimal";
import { money } from "./money";
import type {
  AccountingAudit,
  Fill,
  FillAccountingMode,
  FillSemanticsReport,
  HistoryCoverage,
  HyperliquidSnapshot,
  LedgerUpdate,
  MoneyValue
} from "./types";

const ZERO_TOLERANCE = dec("0.00000001");

export function assessFillSemantics(fills: Fill[]): FillSemanticsReport {
  const openingWithZeroClosedPnl = fills.find(
    (fill) => isOpeningFill(fill.direction) && dec(fill.rawClosedPnl).abs().lte(ZERO_TOLERANCE) && dec(fill.rawFee).abs().gt(ZERO_TOLERANCE)
  );

  if (openingWithZeroClosedPnl) {
    return {
      mode: "unverified",
      verified: false,
      reason:
        "No verificado: se observaron aperturas con closedPnl = 0 y fee != 0, lo que contradice la semántica documental simplificada.",
      exampleOpenFill: openingWithZeroClosedPnl,
      exampleCloseFill: fills.find((fill) => !isOpeningFill(fill.direction) && dec(fill.rawClosedPnl).abs().gt(ZERO_TOLERANCE))
    };
  }

  const openingMatchingFee = fills.find(
    (fill) => isOpeningFill(fill.direction) && dec(fill.rawClosedPnl).minus(dec(fill.rawFee)).abs().lte(ZERO_TOLERANCE)
  );

  if (openingMatchingFee) {
    return {
      mode: "includes_fee",
      verified: true,
      reason: "Verificado sobre la muestra: las aperturas observadas reflejan closedPnl igual a fee.",
      exampleOpenFill: openingMatchingFee,
      exampleCloseFill: fills.find((fill) => !isOpeningFill(fill.direction) && dec(fill.rawClosedPnl).abs().gt(ZERO_TOLERANCE))
    };
  }

  return {
    mode: "unverified",
    verified: false,
    reason: "No verificado: la muestra no permite demostrar con certeza si closedPnl incluye o excluye fee."
  };
}

export function deriveGrossTradingPnl(mode: FillAccountingMode, rawClosedPnl: Decimal, rawFee: Decimal): Decimal | undefined {
  if (mode === "includes_fee") {
    return rawClosedPnl.plus(rawFee);
  }
  if (mode === "excludes_fee") {
    return rawClosedPnl;
  }
  return undefined;
}

export function deriveNetPnl(
  mode: FillAccountingMode,
  rawClosedPnl: Decimal,
  rawFee: Decimal,
  rawFunding: Decimal,
  unrealizedPnl: Decimal,
  otherAdjustments: Decimal
): Decimal | undefined {
  if (mode === "includes_fee") {
    return rawClosedPnl.plus(rawFunding).plus(unrealizedPnl).plus(otherAdjustments);
  }
  if (mode === "excludes_fee") {
    return rawClosedPnl.minus(rawFee).plus(rawFunding).plus(unrealizedPnl).plus(otherAdjustments);
  }
  return undefined;
}

export function buildAccountingAudit(
  snapshot: HyperliquidSnapshot,
  accountValueAdjustedResult: Decimal,
  rawClosedPnl: Decimal,
  rawFee: Decimal,
  rawBuilderFeeIncluded: Decimal,
  rawFunding: Decimal,
  otherAdjustments: Decimal
): AccountingAudit {
  const semantics = assessFillSemantics(snapshot.fills);
  const { feePaid, rebateReceived } = splitRawFee(rawFee);
  const grossTradingPnl = deriveGrossTradingPnl(semantics.mode, rawClosedPnl, rawFee);
  const netPnlDerived = deriveNetPnl(
    semantics.mode,
    rawClosedPnl,
    rawFee,
    rawFunding,
    dec(snapshot.clearinghouseState.unrealizedPnl),
    otherAdjustments
  );

  return {
    rawClosedPnl: money(rawClosedPnl),
    rawFeeNet: money(rawFee),
    feePaid: money(feePaid),
    rebateReceived: money(rebateReceived),
    rawBuilderFeeIncluded: money(rawBuilderFeeIncluded),
    rawFunding: money(rawFunding),
    grossTradingPnl: grossTradingPnl ? money(grossTradingPnl) : undefined,
    netPnlDerived: netPnlDerived ? money(netPnlDerived) : undefined,
    accountValueAdjustedResult: money(accountValueAdjustedResult),
    semantics,
    formulas: [
      "rawClosedPnl = suma exacta de userFillsByTime[].closedPnl",
      "rawFee = suma exacta de userFillsByTime[].fee con su signo original",
      "rawFee > 0 = comision cobrada; rawFee < 0 = rebate recibido; rawFee = 0 = sin comision",
      "rawBuilderFeeIncluded = suma informativa de userFillsByTime[].builderFee; ya esta dentro de fee",
      "rawFunding = suma exacta de userFunding",
      "accountValueAdjustedResult = accountValue + retiradas externas - depositos externos",
      semantics.mode === "includes_fee"
        ? "grossTradingPnl = rawClosedPnl + rawFee; netPnlDerived = rawClosedPnl + funding + unrealizedPnl + otros ajustes identificados"
        : semantics.mode === "excludes_fee"
          ? "grossTradingPnl = rawClosedPnl; netPnlDerived = rawClosedPnl - rawFee + funding + unrealizedPnl + otros ajustes identificados"
          : "netPnlDerived no verificado: la semantica de closedPnl frente a fee no pudo demostrarse con certeza"
    ]
  };
}

export function splitRawFee(rawFee: Decimal): { feePaid: Decimal; rebateReceived: Decimal } {
  if (rawFee.gt(0)) {
    return { feePaid: rawFee, rebateReceived: dec(0) };
  }
  if (rawFee.lt(0)) {
    return { feePaid: dec(0), rebateReceived: rawFee.abs() };
  }
  return { feePaid: dec(0), rebateReceived: dec(0) };
}

export function labelRawFee(rawFee: Decimal): "Comision pagada" | "Rebate recibido" | "Sin comision" {
  if (rawFee.gt(0)) {
    return "Comision pagada";
  }
  if (rawFee.lt(0)) {
    return "Rebate recibido";
  }
  return "Sin comision";
}

export function labelCoverage(coverage: HistoryCoverage): string {
  if (coverage.isCompleteForRequestedPeriod) {
    return "Cobertura completa para el periodo solicitado";
  }
  return coverage.reasonIfIncomplete ?? "Cobertura incompleta";
}

export function coverageWindowLabel(coverage: HistoryCoverage): string {
  if (!coverage.actualEarliestTimestamp || !coverage.actualLatestTimestamp) {
    return "Sin datos descargados";
  }
  return `${new Date(coverage.actualEarliestTimestamp).toISOString()} -> ${new Date(coverage.actualLatestTimestamp).toISOString()}`;
}

export function hasUnknownLedgerRows(rows: LedgerUpdate[]): boolean {
  return rows.some((row) => row.movementGroup === "unknown");
}

export function formatMaybeMoney(value?: MoneyValue): string {
  return value?.rounded ?? "No verificado";
}

function isOpeningFill(direction: string): boolean {
  return direction.toLowerCase().includes("open");
}
