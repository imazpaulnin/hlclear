import { describe, expect, it } from "vitest";
import {
  assessFillSemantics,
  deriveGrossTradingPnl,
  deriveNetPnl,
  hasUnknownLedgerRows,
  labelRawFee,
  splitRawFee
} from "../domain/accounting";
import { buildDashboard } from "../domain/dashboard";
import { buildPositionCycles } from "../domain/cycles";
import { dec } from "../domain/decimal";
import { determineProfitStatus } from "../domain/profitStatus";
import { getApiBaseUrl, getReadOnlyPayloads } from "../data/hyperliquidApi";
import type {
  AccountMode,
  ApiPosition,
  Fill,
  FundingEntry,
  HyperliquidSnapshot,
  LedgerUpdate,
  UserSettings
} from "../domain/types";

const settings: UserSettings = {
  address: "0x1111111111111111111111111111111111111111",
  network: "testnet",
  closeMode: "taker",
  slippageBps: "5",
  toleranceUsdc: "0.01"
};

describe("profit status", () => {
  it("1. P&L bruto negativo: rojo", () => {
    const status = determineProfitStatus({
      gross: dec("-1.50"),
      net: dec("2.00"),
      tolerance: dec("0.01"),
      incomplete: false,
      stale: false,
      feeTokenUnknown: false,
      fundingIncomplete: false,
      reconciled: true,
      ambiguousAccounting: false
    });
    expect(status.color).toBe("red");
  });

  it("2. bruto positivo pero neto negativo: naranja", () => {
    const status = determineProfitStatus({
      gross: dec("0.20"),
      net: dec("-0.02"),
      tolerance: dec("0.01"),
      incomplete: false,
      stale: false,
      feeTokenUnknown: false,
      fundingIncomplete: false,
      reconciled: true,
      ambiguousAccounting: false
    });
    expect(status.color).toBe("orange");
  });

  it("3. neto positivo: verde", () => {
    const status = determineProfitStatus({
      gross: dec("0.20"),
      net: dec("0.12"),
      tolerance: dec("0.01"),
      incomplete: false,
      stale: false,
      feeTokenUnknown: false,
      fundingIncomplete: false,
      reconciled: true,
      ambiguousAccounting: false
    });
    expect(status.color).toBe("green");
  });

  it("4. dentro de ±0,01 USDC: gris", () => {
    const status = determineProfitStatus({
      gross: dec("0.009"),
      net: dec("0.009"),
      tolerance: dec("0.01"),
      incomplete: false,
      stale: false,
      feeTokenUnknown: false,
      fundingIncomplete: false,
      reconciled: true,
      ambiguousAccounting: false
    });
    expect(status.color).toBe("gray");
  });

  it("5. semantica no verificada: gris", () => {
    const status = determineProfitStatus({
      gross: dec("5"),
      net: dec("4"),
      tolerance: dec("0.01"),
      incomplete: false,
      stale: false,
      feeTokenUnknown: false,
      fundingIncomplete: false,
      reconciled: true,
      ambiguousAccounting: true
    });
    expect(status.color).toBe("gray");
  });
});

describe("fee sign conventions", () => {
  it("6. taker fee positiva se interpreta como coste cobrado", () => {
    const split = splitRawFee(dec("0.20"));
    expect(split.feePaid.toString()).toBe("0.2");
    expect(split.rebateReceived.toString()).toBe("0");
  });

  it("7. maker fee positiva se interpreta como coste cobrado", () => {
    const split = splitRawFee(dec("0.02"));
    expect(split.feePaid.toString()).toBe("0.02");
    expect(split.rebateReceived.toString()).toBe("0");
  });

  it("8. maker rebate negativo se interpreta como rebate recibido", () => {
    const split = splitRawFee(dec("-0.02"));
    expect(split.feePaid.toString()).toBe("0");
    expect(split.rebateReceived.toString()).toBe("0.02");
  });

  it("9. comision cero permanece neutra", () => {
    const split = splitRawFee(dec("0"));
    expect(split.feePaid.toString()).toBe("0");
    expect(split.rebateReceived.toString()).toBe("0");
  });

  it("10. interfaz etiqueta correctamente coste, rebate y fee cero", () => {
    expect(labelRawFee(dec("0.2"))).toBe("Comision pagada");
    expect(labelRawFee(dec("-0.02"))).toBe("Rebate recibido");
    expect(labelRawFee(dec("0"))).toBe("Sin comision");
  });
});

describe("semantics and accounting derivation", () => {
  it("11. closedPnl que ya incluye una comision positiva", () => {
    expect(deriveGrossTradingPnl("includes_fee", dec("9.8"), dec("0.2"))?.toString()).toBe("10");
    expect(deriveNetPnl("includes_fee", dec("9.8"), dec("0.2"), dec("0.5"), dec("0"), dec("0"))?.toString()).toBe("10.3");
  });

  it("12. closedPnl que ya incluye un rebate negativo", () => {
    expect(deriveGrossTradingPnl("includes_fee", dec("10.02"), dec("-0.02"))?.toString()).toBe("10");
    expect(deriveNetPnl("includes_fee", dec("10.02"), dec("-0.02"), dec("0.5"), dec("0"), dec("0"))?.toString()).toBe("10.52");
  });

  it("13. closedPnl que excluye fee", () => {
    expect(deriveGrossTradingPnl("excludes_fee", dec("10"), dec("0.2"))?.toString()).toBe("10");
    expect(deriveNetPnl("excludes_fee", dec("10"), dec("0.2"), dec("0.5"), dec("0"), dec("0"))?.toString()).toBe("10.3");
  });

  it("14. builderFee incluido dentro de fee", () => {
    const cycle = buildPositionCycles([fill("BTC", "Close Long", "110", "1", "10.02", "-0.02", "USDC", false, "-0.01", "1")], [])[0];
    expect(cycle.rawFeeNetUsdc.toString()).toBe("-0.02");
    expect(cycle.rebateReceivedUsdc.toString()).toBe("0.02");
    expect(cycle.totalBuilderFeeIncluded.toString()).toBe("-0.01");
  });

  it("15. prohibicion de restar builderFee dos veces", () => {
    const netWithoutDoubleCount = deriveNetPnl("includes_fee", dec("9.8"), dec("0.2"), dec("0.5"), dec("0"), dec("0"));
    expect(netWithoutDoubleCount?.toString()).toBe("10.3");
  });

  it("16. fill de apertura con closedPnl cero fuerza semantica no verificada", () => {
    const report = assessFillSemantics([fill("BTC", "Open Long", "100", "1", "0", "0.1")]);
    expect(report.verified).toBe(false);
    expect(report.mode).toBe("unverified");
  });
});

describe("dashboard fee presentation", () => {
  it("17. resumen separa comision pagada y rebate recibido", () => {
    const snapshot = makeSnapshot({
      fills: [
        fill("BTC", "Open Long", "100", "1", "0", "0.10", "USDC", true),
        fill("BTC", "Close Long", "110", "1", "10.02", "-0.02", "USDC", false)
      ]
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.summary.rawFeeNet.exact.toString()).toBe("0.08");
    expect(dashboard.summary.feePaid.exact.toString()).toBe("0.1");
    expect(dashboard.summary.rebateReceived.exact.toString()).toBe("0.02");
  });

  it("18. maker rebate negativo no se muestra como perdida", () => {
    const snapshot = makeSnapshot({
      fills: [fill("BTC", "Close Long", "110", "1", "10.02", "-0.02", "USDC", false)]
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.positions[0].feePaid.exact.toString()).toBe("0");
    expect(dashboard.positions[0].rebateReceived.exact.toString()).toBe("0.02");
  });

  it("19. ningun estado verde con semantica sin verificar", () => {
    const snapshot = makeSnapshot({
      fills: [fill("BTC", "Open Long", "100", "1", "0", "0.1"), fill("BTC", "Close Long", "110", "1", "10", "0.2")]
    });
    expect(buildDashboard(snapshot, settings).summary.status.color).toBe("gray");
  });
});

describe("cycles and coverage", () => {
  it("20. fill de cierre parcial", () => {
    const cycles = buildPositionCycles(
      [
        fill("BTC", "Open Long", "100", "2"),
        fill("BTC", "Close Long", "101", "1", "5")
      ],
      []
    );
    expect(cycles[0].rawClosedPnl.toString()).toBe("5");
    expect(cycles[0].openQuantity.toString()).toBe("1");
  });

  it("21. periodo superior a 10.000 fills no es completo", () => {
    const snapshot = makeSnapshot({
      historyCoverage: {
        requestedStartTime: 1,
        actualEarliestTimestamp: 100,
        actualLatestTimestamp: 1000,
        fillsDownloaded: 10000,
        fundingEntriesDownloaded: 20,
        ledgerEntriesDownloaded: 10,
        reachedApiLimit: true,
        reachedInternalPageLimit: false,
        isCompleteForRequestedPeriod: false,
        reasonIfIncomplete: "Se alcanzó el límite oficial de fills recientes disponible por la API."
      }
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.historyCoverage.reachedApiLimit).toBe(true);
    expect(dashboard.summary.status.color).toBe("gray");
  });

  it("22. limite de 2.000 fills por respuesta se refleja en cobertura parcial", () => {
    const snapshot = makeSnapshot({
      historyCoverage: {
        requestedStartTime: 1,
        actualEarliestTimestamp: 50,
        actualLatestTimestamp: 1000,
        fillsDownloaded: 2000,
        fundingEntriesDownloaded: 2,
        ledgerEntriesDownloaded: 2,
        reachedApiLimit: false,
        reachedInternalPageLimit: true,
        isCompleteForRequestedPeriod: false,
        reasonIfIncomplete: "Se alcanzó el límite interno de paginación defensiva."
      }
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.historyCoverage.reachedInternalPageLimit).toBe(true);
  });

  it("23. historial incompleto oculta exactitud derivada", () => {
    const snapshot = makeSnapshot({
      historyCoverage: {
        requestedStartTime: 1,
        actualEarliestTimestamp: 100,
        actualLatestTimestamp: 1000,
        fillsDownloaded: 10,
        fundingEntriesDownloaded: 2,
        ledgerEntriesDownloaded: 2,
        reachedApiLimit: false,
        reachedInternalPageLimit: false,
        isCompleteForRequestedPeriod: false,
        reasonIfIncomplete: "Periodo incompleto"
      }
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.summary.status.color).toBe("gray");
  });

  it("24. primer timestamp posterior al periodo solicitado", () => {
    const snapshot = makeSnapshot({
      historyCoverage: {
        requestedStartTime: 1,
        actualEarliestTimestamp: 999,
        actualLatestTimestamp: 1000,
        fillsDownloaded: 10,
        fundingEntriesDownloaded: 2,
        ledgerEntriesDownloaded: 2,
        reachedApiLimit: false,
        reachedInternalPageLimit: false,
        isCompleteForRequestedPeriod: false,
        reasonIfIncomplete: "La primera marca temporal descargada es posterior al periodo solicitado."
      }
    });
    expect(buildDashboard(snapshot, settings).historyCoverage.reasonIfIncomplete).toContain("posterior");
  });

  it("25. datos con mas de ocho paginas siguen marcados como incompletos, no silenciosos", () => {
    const snapshot = makeSnapshot({
      historyCoverage: {
        requestedStartTime: 1,
        actualEarliestTimestamp: 500,
        actualLatestTimestamp: 2000,
        fillsDownloaded: 16000,
        fundingEntriesDownloaded: 2,
        ledgerEntriesDownloaded: 2,
        reachedApiLimit: false,
        reachedInternalPageLimit: true,
        isCompleteForRequestedPeriod: false,
        reasonIfIncomplete: "Se alcanzó el límite interno de paginación defensiva."
      }
    });
    expect(buildDashboard(snapshot, settings).summary.status.color).toBe("gray");
  });
});

describe("ledger and reconciliation", () => {
  it("26. movimiento de ledger desconocido", () => {
    const snapshot = makeSnapshot({
      ledger: [ledgerUnknown()]
    });
    const dashboard = buildDashboard(snapshot, settings);
    expect(hasUnknownLedgerRows(snapshot.ledgerUpdates)).toBe(true);
    expect(dashboard.summary.status.color).toBe("gray");
  });

  it("27. portfolio pnlHistory etiquetado como estimacion", () => {
    const dashboard = buildDashboard(makeSnapshot({}), settings);
    expect(dashboard.summary.officialEstimates[0].label).toContain("Estimación oficial");
  });

  it("28. reconciliacion exacta unicamente con cobertura completa", () => {
    const snapshot = makeSnapshot({});
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.reconciliation.verified).toBe(false);
  });

  it("29. fee token distinto de USDC fuerza gris", () => {
    const snapshot = makeSnapshot({
      fills: [fill("BTC", "Close Long", "110", "1", "10", "2", "HYPE", true)]
    });
    expect(buildDashboard(snapshot, settings).positions[0].status.color).toBe("gray");
  });
});

describe("api configuration", () => {
  it("30. CORS Mainnet: existen payloads de solo lectura para navegador real", () => {
    const payloads = getReadOnlyPayloads("0x0000000000000000000000000000000000000000", Date.now());
    expect(getApiBaseUrl("mainnet")).toBe("https://api.hyperliquid.xyz");
    expect(payloads).toHaveLength(12);
  });
});

describe("account mode and balance reading", () => {
  it("31. testnet vacio y mainnet con 244,04 USDC no se mezclan", () => {
    const testnetDashboard = buildDashboard(
      makeSnapshot({
        network: "testnet",
        accountMode: "unifiedAccount",
        accountValue: "0",
        marginUsed: "0",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "0", hold: "0", token: 0 }]
      }),
      settings
    );
    const mainnetDashboard = buildDashboard(
      makeSnapshot({
        network: "mainnet",
        accountMode: "unifiedAccount",
        accountValue: "0",
        marginUsed: "0",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "244.04", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(testnetDashboard.summary.totalEquity.exact.toString()).toBe("0");
    expect(mainnetDashboard.summary.totalEquity.exact.toString()).toBe("244.04");
  });

  it("32. unified account usa spot aunque clearinghouseState sea 0", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "unifiedAccount",
        accountValue: "0",
        marginUsed: "0",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "244.04", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.accountModeLabel).toBe("Unificada");
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("244.04");
    expect(dashboard.summary.tradingEquity.exact.toString()).toBe("244.04");
    expect(dashboard.summary.totalEquityVerified).toBe(true);
  });

  it("33. standard account con fondos solo en perpetuos", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "standard",
        accountValue: "150.5",
        marginUsed: "12.5",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "0", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("150.5");
    expect(dashboard.summary.tradingEquity.exact.toString()).toBe("150.5");
    expect(dashboard.summary.totalEquityVerified).toBe(true);
  });

  it("34. standard account con fondos solo en spot", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "standard",
        accountValue: "0",
        marginUsed: "0",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "88.25", hold: "1.25", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("88.25");
    expect(dashboard.summary.usdcAvailable.exact.toString()).toBe("87");
    expect(dashboard.summary.totalEquityVerified).toBe(true);
  });

  it("35. portfolio margin usa spot como fuente principal", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "portfolioMargin",
        accountValue: "0",
        marginUsed: "4",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "321.11", hold: "21.11", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.accountModeLabel).toBe("Portfolio Margin");
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("321.11");
    expect(dashboard.summary.usdcHeld.exact.toString()).toBe("21.11");
  });

  it("36. cuenta con posiciones abiertas mantiene margen y posiciones separadas", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "unifiedAccount",
        accountValue: "0",
        marginUsed: "55.5",
        positions: [position({ coin: "ETH", size: "2", positionValue: "400", marginUsed: "55.5", unrealizedPnl: "12" })],
        spotBalances: [{ coin: "USDC", total: "244.04", hold: "55.5", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.openPositionsCount).toBe(1);
    expect(dashboard.summary.marginUsed.exact.toString()).toBe("55.5");
    expect(dashboard.positions).toHaveLength(1);
  });

  it("37. subcuenta no consulta ni trata la direccion como cuenta principal", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "unifiedAccount",
        userRoleRaw: { role: "subAccount" },
        positions: [],
        spotBalances: [{ coin: "USDC", total: "44", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.diagnostics.userRoleRaw).toEqual({ role: "subAccount" });
  });

  it("38. prevencion de doble contabilizacion en modo standard ambiguo", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "standard",
        accountValue: "100",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "100", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.totalEquityVerified).toBe(false);
    expect(dashboard.summary.totalEquityWarning).toContain("doble contabilización");
  });

  it("39. userAbstraction desconocido no promueve un total de 0 como verificado", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "unknown",
        userAbstractionRaw: "mysteryMode",
        accountValue: "0",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "244.04", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.accountModeLabel).toBe("Desconocida");
    expect(dashboard.summary.totalEquityVerified).toBe(false);
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("0");
  });

  it("40. fallo de clearinghouseState con spot valido mantiene el total unificado", () => {
    const snapshot = makeSnapshot({
      accountMode: "unifiedAccount",
      accountValue: "0",
      marginUsed: "0",
      positions: [],
      spotBalances: [{ coin: "USDC", total: "244.04", hold: "0", token: 0 }]
    });
    snapshot.raw.clearinghouseState = { error: "HTTP 500 al consultar clearinghouseState" };
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("244.04");
    expect(dashboard.summary.tradingEquity.exact.toString()).toBe("244.04");
  });

  it("41. fallo de spotClearinghouseState con clearinghouseState valido conserva trading equity", () => {
    const snapshot = makeSnapshot({
      accountMode: "standard",
      accountValue: "99.01",
      positions: [],
      spotBalances: [{ coin: "USDC", total: "0", hold: "0", token: 0 }]
    });
    snapshot.raw.spotClearinghouseState = { error: "HTTP 500 al consultar spotClearinghouseState" };
    const dashboard = buildDashboard(snapshot, settings);
    expect(dashboard.summary.tradingEquity.exact.toString()).toBe("99.01");
    expect(dashboard.summary.totalEquity.exact.toString()).toBe("99.01");
  });

  it("42. no hay total verificado cuando ambas fuentes son ambiguas", () => {
    const dashboard = buildDashboard(
      makeSnapshot({
        accountMode: "unknown",
        accountValue: "120",
        positions: [],
        spotBalances: [{ coin: "USDC", total: "80", hold: "0", token: 0 }]
      }),
      settings
    );
    expect(dashboard.summary.totalEquityVerified).toBe(false);
    expect(dashboard.summary.totalEquityWarning).toContain("Modo de cuenta desconocido");
  });
});

function makeSnapshot(overrides: {
  fills?: Fill[];
  fundings?: FundingEntry[];
  ledger?: LedgerUpdate[];
  network?: HyperliquidSnapshot["network"];
  accountMode?: AccountMode;
  userAbstractionRaw?: unknown;
  userRoleRaw?: unknown;
  spotBalances?: Array<{ coin: string; total: string; hold?: string; entryNtl?: string; token?: number }>;
  subAccountsRaw?: unknown;
  positionSize?: string;
  positions?: ApiPosition[];
  accountValue?: string;
  withdrawable?: string;
  marginUsed?: string;
  userCrossRate?: string;
  userAddRate?: string;
  historyCoverage?: HyperliquidSnapshot["historyCoverage"];
}): HyperliquidSnapshot {
  const fills =
    overrides.fills ??
    [
      fill("BTC", "Open Long", "100", "1", "0.105", "0.105", "USDC", false, "0.02"),
      fill("BTC", "Close Long", "105", "0.5", "8", "1.2", "USDC", true, "0.1")
    ];
  const positionSize = overrides.positionSize ?? "0.5";
  return {
    fetchedAt: new Date("2026-08-03T10:00:00Z").toISOString(),
    address: settings.address,
    network: overrides.network ?? "testnet",
    stale: false,
    apiHealth: "healthy",
    raw: {
      userAbstraction: overrides.userAbstractionRaw ?? overrides.accountMode ?? "disabled",
      userRole: overrides.userRoleRaw ?? { role: "user" },
      clearinghouseState: {},
      spotClearinghouseState: {},
      subAccounts: overrides.subAccountsRaw ?? [],
      portfolio: {},
      userFees: {},
      metaAndAssetCtxs: {},
      openOrders: {},
      fills: {},
      funding: {},
      ledger: {}
    },
    infoRequests: {
      clearinghouseState: [],
      spotClearinghouseState: [],
      userFillsByTime: [],
      userFunding: [],
      userNonFundingLedgerUpdates: []
    },
    accountIdentity: {
      userAbstractionRaw: overrides.userAbstractionRaw ?? overrides.accountMode ?? "disabled",
      userAbstraction: normalizeModeToAbstraction(overrides.accountMode),
      userRoleRaw: overrides.userRoleRaw ?? { role: "user" },
      userRole: normalizeRole(overrides.userRoleRaw),
      mode: overrides.accountMode ?? "standard",
      isMainAccount: normalizeRole(overrides.userRoleRaw) === "user",
      subAccounts: []
    },
    clearinghouseState: {
      accountValue: overrides.accountValue ?? "1200",
      withdrawable: overrides.withdrawable ?? "900",
      marginUsed: overrides.marginUsed ?? "100",
      unrealizedPnl: "0.18",
      positions:
        overrides.positions ??
        [
          position({
            size: positionSize,
            unrealizedPnl: "0.18",
            positionValue: "400",
            entryPrice: "100",
            leverage: "5"
          })
        ]
    },
    spotClearinghouseState: {
      balances: (overrides.spotBalances ?? [{ coin: "USDC", total: "0", hold: "0", token: 0 }]).map((balance) => ({
        coin: balance.coin,
        total: balance.total,
        hold: balance.hold ?? "0",
        token: balance.token,
        entryNtl: balance.entryNtl
      }))
    },
    portfolio: [period("day", "12"), period("week", "30"), period("month", "80")],
    userFees: {
      userCrossRate: overrides.userCrossRate ?? "0.000315",
      userAddRate: overrides.userAddRate ?? "0.000105",
      activeReferralDiscount: "0",
      activeStakingDiscount: "0.3",
      feeSchedule: {
        cross: "0.00045",
        add: "0.00015",
        referralDiscount: "0.04"
      }
    },
    universe: [{ name: "BTC", szDecimals: 3, maxLeverage: 20, marginTableId: 1 }],
    marginTables: [{ id: 1, description: "Base", marginTiers: [{ lowerBound: "0", maxLeverage: 20 }] }],
    marketContexts: [{ coin: "BTC", markPrice: "100.18" }],
    openOrders: [],
    fills,
    fundings: overrides.fundings ?? [funding("BTC", "-0.01")],
    ledgerUpdates: overrides.ledger ?? [ledgerDeposit("1000"), ledgerWithdraw("50"), ledgerReward("3")],
    historyCoverage:
      overrides.historyCoverage ??
      {
        requestedStartTime: Date.parse("2026-01-01T00:00:00Z"),
        actualEarliestTimestamp: Date.parse("2026-01-01T00:00:00Z"),
        actualLatestTimestamp: Date.parse("2026-08-03T10:10:00Z"),
        fillsDownloaded: fills.length,
        fundingEntriesDownloaded: (overrides.fundings ?? [funding("BTC", "-0.01")]).length,
        ledgerEntriesDownloaded: (overrides.ledger ?? [ledgerDeposit("1000"), ledgerWithdraw("50"), ledgerReward("3")]).length,
        reachedApiLimit: false,
        reachedInternalPageLimit: false,
        isCompleteForRequestedPeriod: true
      }
  };
}

function normalizeModeToAbstraction(mode?: AccountMode): string {
  if (mode === "unifiedAccount" || mode === "portfolioMargin") {
    return mode;
  }
  if (mode === "unknown") {
    return "mystery";
  }
  return "disabled";
}

function normalizeRole(raw?: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object" && "role" in raw) {
    return String((raw as { role?: unknown }).role ?? "user");
  }
  return "user";
}

function position(input: Partial<ApiPosition>): ApiPosition {
  return {
    coin: "BTC",
    size: "0.5",
    entryPrice: "100",
    positionValue: "400",
    unrealizedPnl: "0.18",
    leverage: "5",
    marginUsed: "100",
    marginMode: "cross",
    ...input
  };
}

function period(periodName: string, pnl: string) {
  return {
    period: periodName,
    accountValueHistory: [{ timestamp: 1, value: "0" }],
    pnlHistory: [{ timestamp: 1, value: pnl }],
    volume: "1000"
  };
}

function fill(
  coin: string,
  direction: string,
  price: string,
  size: string,
  rawClosedPnl = "0",
  rawFee = "0.11",
  feeToken = "USDC",
  crossed = false,
  rawBuilderFee?: string,
  orderId = "1"
): Fill {
  return {
    stableId: `${coin}-${direction}-${price}-${size}-${rawClosedPnl}-${rawFee}-${rawBuilderFee ?? "0"}`,
    time: Date.parse("2026-08-03T10:00:00Z"),
    coin,
    direction,
    price,
    size,
    notional: dec(price).mul(dec(size).abs()).toString(),
    rawClosedPnl,
    rawFee,
    rawBuilderFee,
    feeToken,
    crossed,
    orderId: Number(orderId),
    hash: "0xhash",
    startPosition: "0"
  };
}

function funding(coin: string, rawFunding: string): FundingEntry {
  return {
    id: `${coin}-${rawFunding}`,
    time: Date.parse("2026-08-03T10:10:00Z"),
    coin,
    rawFunding
  };
}

function ledgerDeposit(usdc: string): LedgerUpdate {
  return {
    id: `deposit-${usdc}`,
    time: Date.parse("2026-08-03T09:00:00Z"),
    hash: "0xdep",
    delta: { type: "deposit", usdc },
    movementGroup: "externalDeposits",
    displayAmount: usdc,
    asset: "USDC",
    raw: {},
    affectsReconciliation: true
  };
}

function ledgerWithdraw(usdc: string): LedgerUpdate {
  return {
    id: `withdraw-${usdc}`,
    time: Date.parse("2026-08-03T09:05:00Z"),
    hash: "0xwd",
    delta: { type: "withdraw", usdc },
    movementGroup: "externalWithdrawals",
    displayAmount: usdc,
    asset: "USDC",
    raw: {},
    affectsReconciliation: true
  };
}

function ledgerReward(usdc: string): LedgerUpdate {
  return {
    id: `reward-${usdc}`,
    time: Date.parse("2026-08-03T09:10:00Z"),
    hash: "0xrw",
    delta: { type: "rewardsClaim", usdc },
    movementGroup: "rewards",
    displayAmount: usdc,
    asset: "USDC",
    raw: {},
    affectsReconciliation: true
  };
}

function ledgerUnknown(): LedgerUpdate {
  return {
    id: "unknown-1",
    time: Date.parse("2026-08-03T09:15:00Z"),
    hash: "0xuk",
    delta: { type: "unknown", originalType: "mysteryDelta" },
    movementGroup: "unknown",
    asset: "USDC",
    raw: { delta: { type: "mysteryDelta", foo: "bar" } },
    affectsReconciliation: false
  };
}
