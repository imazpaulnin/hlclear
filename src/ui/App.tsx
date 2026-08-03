import { useEffect, useMemo, useState } from "react";
import { fetchSnapshot, getApiBaseUrl, getReadOnlyPayloads, isAddressValid } from "../data/hyperliquidApi";
import { coverageWindowLabel, formatMaybeMoney, labelCoverage, labelRawFee } from "../domain/accounting";
import { dec } from "../domain/decimal";
import { buildDashboard } from "../domain/dashboard";
import { createEmptyState, loadStoredState, persistState } from "../domain/storage";
import type {
  DashboardPresentation,
  Fill,
  HyperliquidSnapshot,
  Network,
  PositionPresentation,
  StoredAppState,
  SyncState,
  UserSettings
} from "../domain/types";

type TabKey = "summary" | "positions" | "history" | "more";
type MorePanel = "menu" | "movements" | "settings" | "methodology" | "audit";

const primaryTabs: Array<{ key: TabKey; label: string; icon: "summary" | "positions" | "history" | "more" }> = [
  { key: "summary", label: "Resumen", icon: "summary" },
  { key: "positions", label: "Posiciones", icon: "positions" },
  { key: "history", label: "Historial", icon: "history" },
  { key: "more", label: "Mas", icon: "more" }
];

export function App() {
  const initialNavigation = useMemo(resolveInitialNavigation, []);
  const [tab, setTab] = useState<TabKey>(initialNavigation.tab);
  const [morePanel, setMorePanel] = useState<MorePanel>(initialNavigation.morePanel);
  const [state, setState] = useState<StoredAppState>(() => loadStoredState());
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [selectedPosition, setSelectedPosition] = useState<PositionPresentation | null>(null);
  const [corsStatus, setCorsStatus] = useState<string>("Pendiente");
  const [auditMode, setAuditMode] = useState<boolean>(() => new URLSearchParams(window.location.search).get("audit") === "1");
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => new URLSearchParams(window.location.search).get("advanced") === "1");

  const activeSnapshot = state.snapshots?.[state.settings.network];

  const dashboard = useMemo<DashboardPresentation | undefined>(() => {
    if (!activeSnapshot) {
      return undefined;
    }
    return buildDashboard(activeSnapshot, state.settings);
  }, [activeSnapshot, state.settings]);

  useEffect(() => {
    persistState(state);
  }, [state]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    void verifyCors(state.settings.network, state.settings.address).then(setCorsStatus).catch(() => setCorsStatus("No verificado"));
  }, [state.settings.network, state.settings.address]);

  async function sync(force = false, networkOverride?: Network) {
    if (syncState === "loading") {
      return;
    }

    const targetNetwork = networkOverride ?? state.settings.network;
    if (!isAddressValid(state.settings.address)) {
      setError("Introduce una direccion 0x valida.");
      setSyncState("error");
      return;
    }
    if (!navigator.onLine && !force) {
      setError("Sin conexion. Solo se puede mostrar el ultimo snapshot guardado.");
      setSyncState("error");
      return;
    }

    try {
      setSyncState("loading");
      setError(null);
      const snapshot = await fetchSnapshot(state.settings.address, targetNetwork);
      setState((current) => ({
        ...current,
        settings: { ...current.settings, network: targetNetwork },
        snapshots: {
          ...current.snapshots,
          [targetNetwork]: snapshot
        }
      }));
      setSyncState("ready");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error desconocido";
      setError(message);
      setSyncState("error");
      setState((current) =>
        current.snapshots?.[targetNetwork]
          ? {
              ...current,
              snapshots: {
                ...current.snapshots,
                [targetNetwork]: {
                  ...current.snapshots[targetNetwork]!,
                  stale: true,
                  apiHealth: "error"
                }
              }
            }
          : current
      );
    }
  }

  function updateSettings(patch: Partial<UserSettings>) {
    setState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch
      }
    }));
  }

  function clearLocalData() {
    setState(createEmptyState());
    setSyncState("idle");
    setError(null);
    setCorsStatus("Pendiente");
  }

  const shellStatus = activeSnapshot?.stale || !online ? "offline" : "online";
  const lastUpdated = activeSnapshot ? formatDateTime(activeSnapshot.fetchedAt) : "Nunca";

  return (
    <>
      <main className="app-shell">
        <Header
          online={online}
          shellStatus={shellStatus}
          network={state.settings.network}
          lastUpdated={lastUpdated}
        />

        <div className="stack page-stack">
          {(activeSnapshot?.stale || !online) && (
            <div className="banner" role="status">
              <strong>Datos desactualizados</strong>
              <span>La app puede abrirse offline y mostrar el ultimo snapshot guardado, pero nunca como tiempo real.</span>
              <span>Ultima sincronizacion: {lastUpdated}</span>
            </div>
          )}

          {error && (
            <div className="card danger" role="alert">
              <strong>Error</strong>
              <div>{error}</div>
            </div>
          )}

          {tab === "summary" && <SummaryTab dashboard={dashboard} state={state} syncState={syncState} onSync={() => void sync()} />}
          {tab === "positions" && <PositionsTab dashboard={dashboard} onOpenPosition={setSelectedPosition} />}
          {tab === "history" && <HistoryTab dashboard={dashboard} />}
          {tab === "more" && (
            <MoreTab
              panel={morePanel}
              onSelectPanel={setMorePanel}
              dashboard={dashboard}
              settings={state.settings}
              snapshot={activeSnapshot}
              auditMode={auditMode}
              advancedOpen={advancedOpen}
              syncState={syncState}
              online={online}
              corsStatus={corsStatus}
              onToggleAudit={() => setAuditMode((current) => !current)}
              onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
              onSettingsChange={updateSettings}
              onSync={() => void sync()}
              onClearCache={clearLocalData}
            />
          )}
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Navegacion principal">
        {primaryTabs.map((item) => {
          const selected = tab === item.key;
          return (
            <button
              key={item.key}
              className={`nav-button ${selected ? "active" : ""}`}
              type="button"
              onClick={() => {
                setTab(item.key);
                if (item.key !== "more") {
                  setMorePanel("menu");
                }
              }}
              aria-pressed={selected}
              aria-current={selected ? "page" : undefined}
            >
              <NavIcon icon={item.icon} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {selectedPosition && <PositionDetailModal position={selectedPosition} onClose={() => setSelectedPosition(null)} />}
    </>
  );
}

function resolveInitialNavigation(): { tab: TabKey; morePanel: MorePanel } {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get("tab");
  const requestedMore = params.get("more");

  if (requestedTab === "settings") {
    return { tab: "more", morePanel: "settings" };
  }
  if (requestedTab === "movements") {
    return { tab: "more", morePanel: "movements" };
  }
  if (requestedTab === "methodology") {
    return { tab: "more", morePanel: "methodology" };
  }
  if (requestedTab === "audit") {
    return { tab: "more", morePanel: "audit" };
  }
  if (requestedTab === "summary" || requestedTab === "positions" || requestedTab === "history" || requestedTab === "more") {
    return {
      tab: requestedTab,
      morePanel: requestedTab === "more" && isMorePanel(requestedMore) ? requestedMore : "menu"
    };
  }

  return {
    tab: "summary",
    morePanel: isMorePanel(requestedMore) ? requestedMore : "menu"
  };
}

function isMorePanel(value: string | null): value is MorePanel {
  return value === "menu" || value === "movements" || value === "settings" || value === "methodology" || value === "audit";
}

function Header({
  online,
  shellStatus,
  network,
  lastUpdated
}: {
  online: boolean;
  shellStatus: "online" | "offline";
  network: Network;
  lastUpdated: string;
}) {
  return (
    <header className="app-header">
      <div className="app-header-top">
        <div>
          <h1>HLClear</h1>
          <p>Solo lectura</p>
        </div>
        <span className={`network-pill ${network}`}>
          {network === "testnet" ? "TESTNET · Entorno de prueba" : "MAINNET · Lectura real"}
        </span>
      </div>
      <div className="header-meta" role="status">
        <span className="eyebrow">
          <span className={`status-dot ${shellStatus}`} />
          {online ? "Conectado" : "Sin conexion"}
        </span>
        <span className="eyebrow">Actualizado: {lastUpdated}</span>
      </div>
    </header>
  );
}

function SummaryTab({
  dashboard,
  state,
  syncState,
  onSync
}: {
  dashboard?: DashboardPresentation;
  state: StoredAppState;
  syncState: SyncState;
  onSync: () => void;
}) {
  return (
    <section className="stack">
      <div className="card compact-card stack">
        <div className="section-title">
          <h2>Resumen</h2>
          <button className="button secondary" type="button" onClick={onSync} disabled={!isAddressValid(state.settings.address) || syncState === "loading"}>
            {syncState === "loading" ? "Sincronizando…" : "Actualizar"}
          </button>
        </div>
        <div className="caption">Endpoint: {getApiBaseUrl(state.settings.network)}/info · Solo lectura</div>
      </div>

      {!dashboard ? (
        <div className="card">Introduce una direccion publica valida en Ajustes para ver tu cuenta.</div>
      ) : (
        <>
          <div className="card compact-card stack dense-stack">
            <div className="section-title section-title-wrap">
              <h2>Semaforo contable</h2>
              <ProfitBadge status={dashboard.summary.status} />
            </div>
            <Line label="Estado" value={dashboard.summary.semantics.verified ? "Verificado" : "No verificado"} />
            <div className="caption">{dashboard.summary.semantics.reason}</div>
          </div>

          <div className="grid-2">
            <MetricCard label="Valor total" value={dashboard.summary.accountValue.rounded} />
            <MetricCard label="Saldo retirable" value={dashboard.summary.withdrawable.rounded} />
            <MetricCard label="Margen usado" value={dashboard.summary.marginUsed.rounded} />
            <MetricCard label="Depositos netos" value={dashboard.summary.netExternalDeposits.rounded} />
            <MetricCard label="Resultado patrimonial" value={dashboard.summary.accountValueAdjustedResult.rounded} emphasis={dashboard.summary.status.color} />
            <MetricCard label="closedPnl API" value={dashboard.summary.apiClosedPnl.rounded} />
            <MetricCard label="rawFee neta" value={dashboard.summary.rawFeeNet.rounded} />
            <MetricCard label="Comision pagada" value={dashboard.summary.feePaid.rounded} />
            <MetricCard label="Rebate recibido" value={dashboard.summary.rebateReceived.rounded} />
            <MetricCard label="Builder fee" value={dashboard.summary.builderFeeIncluded.rounded} />
            <MetricCard label="Funding" value={dashboard.summary.funding.rounded} />
            <MetricCard label="No realizado" value={dashboard.summary.unrealizedPnl.rounded} />
            <MetricCard label="P&L bruto verificado" value={formatMaybeMoney(dashboard.summary.grossTradingPnl)} />
            <MetricCard label="Resultado derivado" value={formatMaybeMoney(dashboard.summary.netPnlDerived)} emphasis={dashboard.summary.status.color} />
          </div>

          <div className="card compact-card stack dense-stack">
            <h2>Cobertura</h2>
            <Line label="Estado" value={labelCoverage(dashboard.historyCoverage)} />
            <Line label="Ventana descargada" value={coverageWindowLabel(dashboard.historyCoverage)} />
            <Line label="Fills" value={String(dashboard.historyCoverage.fillsDownloaded)} />
            <Line label="Funding" value={String(dashboard.historyCoverage.fundingEntriesDownloaded)} />
            <Line label="Ledger" value={String(dashboard.historyCoverage.ledgerEntriesDownloaded)} />
          </div>

          <div className="card compact-card stack dense-stack">
            <div className="section-title section-title-wrap">
              <h2>Reconciliacion</h2>
              {!dashboard.reconciliation.verified && <span className="warning">Estado gris</span>}
            </div>
            <Line label="Patrimonial ajustado" value={dashboard.reconciliation.accountValueAdjustedResult.rounded} />
            <Line label="Resultado derivado" value={formatMaybeMoney(dashboard.reconciliation.netPnlDerived)} />
            <Line label="Diferencia" value={formatMaybeMoney(dashboard.reconciliation.difference)} highlight={dashboard.reconciliation.warning ? "warning" : undefined} />
            {dashboard.methodologyWarnings.map((warning) => (
              <div className="pill" key={warning}>{warning}</div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PositionsTab({
  dashboard,
  onOpenPosition
}: {
  dashboard?: DashboardPresentation;
  onOpenPosition: (position: PositionPresentation) => void;
}) {
  if (!dashboard) {
    return <div className="card">Todavia no hay posiciones abiertas que mostrar.</div>;
  }

  return (
    <section className="stack">
      <div className="card compact-card">
        <div className="section-title section-title-wrap">
          <h2>Posiciones</h2>
          <span className="caption">Estado conservador en gris si falta verificacion.</span>
        </div>
      </div>
      <div className="list">
        {dashboard.positions.length === 0 ? (
          <div className="card">No hay posiciones abiertas.</div>
        ) : (
          dashboard.positions.map((position) => (
            <button className="row-card touch-card" type="button" key={position.key} onClick={() => onOpenPosition(position)}>
              <div className="row-top">
                <strong>{position.coin} · {position.direction}</strong>
                <ProfitBadge status={position.status} />
              </div>
              <div className="position-grid">
                <Line label="P&L no realizado" value={position.grossUnrealized.rounded} />
                <Line label="Comision pagada" value={position.feePaid.rounded} />
                <Line label="Rebate recibido" value={position.rebateReceived.rounded} />
                <Line label="Funding" value={position.fundingNet.rounded} />
                <Line label="Neto si cerrases ahora" value={formatMaybeMoney(position.netIfCloseNow)} />
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function HistoryTab({ dashboard }: { dashboard?: DashboardPresentation }) {
  const [mode, setMode] = useState<"raw" | "daily" | "closed">("raw");

  if (!dashboard) {
    return <div className="card">Sin historial descargado todavia.</div>;
  }

  return (
    <section className="stack">
      <div className="card compact-card stack">
        <div className="mode-switch" role="tablist" aria-label="Vista del historial">
          <button className={`segmented-button ${mode === "raw" ? "active" : ""}`} type="button" onClick={() => setMode("raw")} aria-pressed={mode === "raw"}>Crudo</button>
          <button className={`segmented-button ${mode === "daily" ? "active" : ""}`} type="button" onClick={() => setMode("daily")} aria-pressed={mode === "daily"}>Diario</button>
          <button className={`segmented-button ${mode === "closed" ? "active" : ""}`} type="button" onClick={() => setMode("closed")} aria-pressed={mode === "closed"}>Ciclos</button>
        </div>
        <div className="caption">{labelCoverage(dashboard.historyCoverage)}</div>
      </div>

      {mode === "raw" && <RawFillsList rows={dashboard.rawFills} />}
      {mode === "daily" && <DailySummaryList rows={dashboard.dailySummaries} />}
      {mode === "closed" && <ClosedCycleList rows={dashboard.closedCycles} />}
    </section>
  );
}

function RawFillsList({ rows }: { rows: Fill[] }) {
  return (
    <div className="list">
      {rows.map((fill) => (
        <div className="card compact-card" key={fill.stableId}>
          <div className="row-top">
            <strong>{fill.coin}</strong>
            <span className="caption">{formatDateTime(fill.time)}</span>
          </div>
          <div className="stack dense-stack">
            <Line label="Direccion" value={fill.direction} />
            <Line label="Precio" value={fill.price} />
            <Line label="Tamano" value={fill.size} />
            <Line label="Nominal" value={fill.notional} />
            <Line label="rawClosedPnl" value={fill.rawClosedPnl} />
            <Line label="rawFee" value={fill.rawFee} />
            <Line label="Fee" value={labelRawFee(dec(fill.rawFee))} />
            <Line label="Builder fee" value={fill.rawBuilderFee ?? "0"} />
            <Line label="feeToken" value={fill.feeToken} />
            <Line label="Maker/Taker" value={fill.crossed ? "taker" : "maker"} />
            <Line label="order ID" value={String(fill.orderId ?? "N/D")} />
            <Line label="Hash" value={fill.hash ?? "N/D"} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DailySummaryList({ rows }: { rows: DashboardPresentation["dailySummaries"] }) {
  return (
    <div className="list">
      {rows.map((row) => (
        <div className="card compact-card stack" key={row.day}>
          <div className="row-top">
            <strong>{row.day}</strong>
            <ProfitBadge status={row.status} />
          </div>
          <Line label="closedPnl API" value={row.apiClosedPnl.rounded} />
          <Line label="Comision maker" value={row.makerFeePaid.rounded} />
          <Line label="Comision taker" value={row.takerFeePaid.rounded} />
          <Line label="Rebate maker" value={row.makerRebateReceived.rounded} />
          <Line label="Rebate taker" value={row.takerRebateReceived.rounded} />
          <Line label="rawFee neta" value={row.rawFeeNet.rounded} />
          <Line label="Funding" value={row.funding.rounded} />
          <Line label="Resultado derivado" value={formatMaybeMoney(row.derivedNetPnl)} />
          <Line label="Volumen" value={row.volume.rounded} />
          <Line label="Ejecuciones" value={String(row.executions)} />
        </div>
      ))}
    </div>
  );
}

function ClosedCycleList({ rows }: { rows: DashboardPresentation["closedCycles"] }) {
  return (
    <div className="list">
      {rows.map((row) => (
        <div className="card compact-card stack" key={row.id}>
          <div className="row-top">
            <strong>{row.coin}</strong>
            <ProfitBadge status={row.status} />
          </div>
          <Line label="closedPnl API" value={row.apiClosedPnl.rounded} />
          <Line label="rawFee neta" value={row.rawFeeNet.rounded} />
          <Line label="Comision pagada" value={row.feePaid.rounded} />
          <Line label="Rebate recibido" value={row.rebateReceived.rounded} />
          <Line label="Builder fee" value={row.builderFeeIncluded.rounded} />
          <Line label="Funding" value={row.funding.rounded} />
          <Line label="Resultado derivado" value={formatMaybeMoney(row.derivedNetPnl)} />
          <Line label="Duracion" value={row.durationLabel} />
        </div>
      ))}
    </div>
  );
}

function MoreTab({
  panel,
  onSelectPanel,
  dashboard,
  settings,
  snapshot,
  auditMode,
  advancedOpen,
  syncState,
  online,
  corsStatus,
  onToggleAudit,
  onToggleAdvanced,
  onSettingsChange,
  onSync,
  onClearCache
}: {
  panel: MorePanel;
  onSelectPanel: (panel: MorePanel) => void;
  dashboard?: DashboardPresentation;
  settings: UserSettings;
  snapshot?: HyperliquidSnapshot;
  auditMode: boolean;
  advancedOpen: boolean;
  syncState: SyncState;
  online: boolean;
  corsStatus: string;
  onToggleAudit: () => void;
  onToggleAdvanced: () => void;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
  onSync: () => void;
  onClearCache: () => void;
}) {
  const canExport = Boolean(snapshot);
  const addressValid = isAddressValid(settings.address);
  const savedAddress = snapshot?.address ?? (addressValid ? settings.address : "");
  const syncButtonLabel =
    syncState === "loading"
      ? "Sincronizando…"
      : syncState === "ready"
        ? "Sincronizado"
        : syncState === "error"
          ? "Error al sincronizar"
          : "Guardar y sincronizar";

  const sections = [
    { key: "movements" as const, label: "Movimientos", description: "Depositos, retiradas y ledger." },
    { key: "settings" as const, label: "Ajustes", description: "Direccion, entorno y sincronizacion." },
    ...(auditMode ? [{ key: "audit" as const, label: "Auditoria", description: "JSON raw y formulas locales." }] : []),
    { key: "methodology" as const, label: "Metodologia", description: "Formulas y criterios de lectura." }
  ];

  return (
    <section className="stack">
      {panel === "menu" && (
        <>
          <div className="card compact-card stack">
            <h2>Mas</h2>
            <div className="list">
              {sections.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className="row-card menu-card"
                  onClick={() => onSelectPanel(section.key)}
                >
                  <div className="row-top">
                    <strong>{section.label}</strong>
                    <span aria-hidden="true">›</span>
                  </div>
                  <div className="caption">{section.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card compact-card stack">
            <h2>Acciones locales</h2>
            <button className="button secondary full-width" type="button" onClick={onClearCache}>
              Borrar datos locales
            </button>
            <div className="caption">Elimina direccion, ajustes y snapshots guardados en este dispositivo.</div>
          </div>
        </>
      )}

      {panel === "movements" && (
        <>
          <SubpageHeader title="Movimientos" onBack={() => onSelectPanel("menu")} />
          <MovementsTab dashboard={dashboard} />
        </>
      )}

      {panel === "settings" && (
        <>
          <div className="card compact-card stack dense-stack">
            <div className="section-title section-title-wrap">
              <div className="action-row">
                <button className="button secondary compact-button" type="button" onClick={() => onSelectPanel("menu")}>
                  Volver
                </button>
                <h2>Ajustes basicos</h2>
              </div>
              <span className={`network-pill ${settings.network}`}>
                {settings.network === "testnet" ? "TESTNET · Prueba" : "MAINNET · Lectura"}
              </span>
            </div>

            <div className="field">
              <label htmlFor="address">Direccion publica</label>
              <input
                id="address"
                type="text"
                inputMode="text"
                placeholder="0x..."
                value={settings.address}
                onChange={(event) => onSettingsChange({ address: event.target.value.trim() })}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={settings.address.length > 0 && !addressValid}
              />
              <div className="input-actions">
                <button className="button secondary compact-button" type="button" onClick={() => void pasteAddress(onSettingsChange)}>
                  Pegar
                </button>
                <button className="button secondary compact-button" type="button" onClick={() => onSettingsChange({ address: "" })}>
                  Borrar
                </button>
                <button
                  className="button secondary compact-button"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(settings.address)}
                  disabled={!addressValid}
                >
                  Copiar
                </button>
              </div>
              <div className="caption">
                {settings.address.length === 0
                  ? "Introduce una direccion 0x para consultar la cuenta."
                  : addressValid
                    ? `Direccion valida${savedAddress ? ` · Guardada: ${shortAddress(savedAddress)}` : ""}`
                    : "Formato invalido. Debe empezar por 0x y tener 42 caracteres."}
              </div>
            </div>

            <div className="field">
              <label htmlFor="network">Entorno</label>
              <select id="network" value={settings.network} onChange={(event) => onSettingsChange({ network: event.target.value as Network })}>
                <option value="testnet">TESTNET · Entorno de prueba</option>
                <option value="mainnet">MAINNET · Solo lectura real</option>
              </select>
            </div>

            <button className="button full-width" type="button" onClick={onSync} disabled={!addressValid || syncState === "loading"}>
              {syncButtonLabel}
            </button>

            <div className="status-grid compact-status-grid">
              <InfoTile label="Conexion" value={online ? "Conectado" : "Sin conexion"} />
              <InfoTile label="Ultima sincronizacion" value={snapshot ? formatDateTime(snapshot.fetchedAt) : "Nunca"} />
            </div>
          </div>

          <div className="card compact-card stack">
            <button className="accordion-trigger" type="button" onClick={onToggleAdvanced} aria-expanded={advancedOpen}>
              <span>Opciones avanzadas</span>
              <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
            </button>

            {advancedOpen && (
              <div className="stack">
                <div className="field">
                  <label htmlFor="closeMode">Estimacion de cierre</label>
                  <select id="closeMode" value={settings.closeMode} onChange={(event) => onSettingsChange({ closeMode: event.target.value as UserSettings["closeMode"] })}>
                    <option value="taker">Taker conservador</option>
                    <option value="maker">Maker informativo</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="slippage">Slippage estimado (bps)</label>
                  <input id="slippage" type="number" value={settings.slippageBps} onChange={(event) => onSettingsChange({ slippageBps: event.target.value })} />
                </div>

                <div className="field">
                  <label htmlFor="tolerance">Tolerancia (USDC)</label>
                  <input id="tolerance" type="number" step="0.01" value={settings.toleranceUsdc} onChange={(event) => onSettingsChange({ toleranceUsdc: event.target.value })} />
                </div>

                <div className="status-grid compact-status-grid">
                  <InfoTile label="API" value={snapshot?.apiHealth ?? "Sin consultar"} />
                  <InfoTile label="CORS" value={corsStatus} />
                </div>

                <button className="button secondary full-width" type="button" onClick={onToggleAudit}>
                  {auditMode ? "Ocultar auditoria local" : "Activar auditoria local"}
                </button>

                <button className="button secondary full-width" type="button" onClick={onClearCache}>
                  Borrar datos locales
                </button>

                <div className="caption">La auditoria local no carga datos por defecto y cualquier exportacion se genera solo en este dispositivo.</div>
              </div>
            )}
          </div>
        </>
      )}

      {panel === "methodology" && (
        <>
          <SubpageHeader title="Metodologia" onBack={() => onSelectPanel("menu")} />
          <MethodologyPanel />
        </>
      )}

      {panel === "audit" && (
        <>
          <SubpageHeader title="Auditoria" onBack={() => onSelectPanel("menu")} />
          {!auditMode ? (
            <div className="card">Activa antes el modo de auditoria local desde Ajustes avanzados.</div>
          ) : dashboard && snapshot ? (
            <AuditPanel dashboard={dashboard} snapshot={snapshot} canExport={canExport} />
          ) : (
            <div className="card">Sin snapshot local todavia.</div>
          )}
        </>
      )}
    </section>
  );
}

function MethodologyPanel() {
  return (
    <div className="card compact-card stack">
      <Line label="Patrimonial ajustado" value="accountValue + retiradas externas - depositos externos" />
      <Line label="closedPnl API" value="Suma exacta de rawClosedPnl" />
      <Line label="rawFee" value="Positivo = comision cobrada · Negativo = rebate recibido" />
      <Line label="Comision pagada" value="Suma de rawFee positivos" />
      <Line label="Rebate recibido" value="Suma del valor absoluto de rawFee negativos" />
      <Line label="Funding" value="Suma algebraica de rawFunding" />
      <Line label="Estimacion oficial" value="portfolio.pnlHistory se etiqueta solo como estimacion" />
    </div>
  );
}

function AuditPanel({
  dashboard,
  snapshot,
  canExport
}: {
  dashboard: DashboardPresentation;
  snapshot: HyperliquidSnapshot;
  canExport: boolean;
}) {
  return (
    <div className="stack">
      <div className="card compact-card stack">
        <Line label="Suma raw closedPnl" value={dashboard.audit.rawClosedPnl.rounded} />
        <Line label="Suma raw fee neta" value={dashboard.audit.rawFeeNet.rounded} />
        <Line label="Suma comision pagada" value={dashboard.audit.feePaid.rounded} />
        <Line label="Suma rebate recibido" value={dashboard.audit.rebateReceived.rounded} />
        <Line label="Suma raw builderFee" value={dashboard.audit.rawBuilderFeeIncluded.rounded} />
        <Line label="Suma funding" value={dashboard.audit.rawFunding.rounded} />
        <Line label="Resultado patrimonial" value={dashboard.audit.accountValueAdjustedResult.rounded} />
        <Line label="P&L bruto verificado" value={formatMaybeMoney(dashboard.audit.grossTradingPnl)} />
        <Line label="Resultado derivado" value={formatMaybeMoney(dashboard.audit.netPnlDerived)} />
        <Line label="Cobertura temporal" value={coverageWindowLabel(dashboard.historyCoverage)} />
        {dashboard.audit.formulas.map((formula) => (
          <div className="pill" key={formula}>{formula}</div>
        ))}
        <button className="button secondary full-width" type="button" onClick={() => canExport && exportAuditJson(snapshot, dashboard)} disabled={!canExport}>
          Exportar informe JSON local
        </button>
      </div>

      <details className="card compact-card">
        <summary>JSON original de endpoints</summary>
        <pre className="technical-block">{JSON.stringify(snapshot.raw, null, 2)}</pre>
      </details>

      <details className="card compact-card">
        <summary>Payloads de lectura</summary>
        <pre className="technical-block">{JSON.stringify(getReadOnlyPayloads(snapshot.address, Date.now()), null, 2)}</pre>
      </details>
    </div>
  );
}

function MovementsTab({ dashboard }: { dashboard?: DashboardPresentation }) {
  if (!dashboard) {
    return <div className="card">Sin movimientos descargados todavia.</div>;
  }

  return (
    <section className="stack">
      {Object.entries(dashboard.movements).map(([title, rows]) =>
        rows.length === 0 ? null : (
          <div className="card compact-card stack" key={title}>
            <h2>{title}</h2>
            {rows.map((row) => (
              <div className="row-card compact-row" key={row.id}>
                <div className="row-top">
                  <strong>{row.delta.type}</strong>
                  <span className="mono">{row.displayAmount ?? "N/D"}</span>
                </div>
                <div className="caption">{formatDateTime(row.time)} · {row.asset} · {row.hash ?? "sin hash"}</div>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}

function SubpageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="subpage-header">
      <button className="button secondary compact-button" type="button" onClick={onBack}>
        Volver
      </button>
      <h2>{title}</h2>
    </div>
  );
}

function MetricCard({ label, value, emphasis }: { label: string; value: string; emphasis?: "red" | "orange" | "green" | "gray" }) {
  return (
    <div className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value mono ${classNameForStatus(emphasis)}`}>{value}</div>
    </div>
  );
}

function ProfitBadge({ status }: { status: DashboardPresentation["summary"]["status"] | PositionPresentation["status"] }) {
  return (
    <span className={`profit-state profit-${status.color}`}>
      <span aria-hidden="true">{status.icon}</span>
      <span>{status.label}</span>
    </span>
  );
}

function BreakdownLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <Line label={label} value={value} />
      {hint && <div className="caption">{hint}</div>}
    </div>
  );
}

function Line({ label, value, highlight }: { label: string; value: string; highlight?: "warning" }) {
  return (
    <div className="line">
      <span>{label}</span>
      <strong className={`mono ${highlight ?? ""}`}>{value}</strong>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-tile">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NavIcon({ icon }: { icon: "summary" | "positions" | "history" | "more" }) {
  if (icon === "summary") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16M4 12h16M4 19h10" />
      </svg>
    );
  }
  if (icon === "positions") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18V9m7 9V5m7 13v-6" />
      </svg>
    );
  }
  if (icon === "history") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 1 0 3-6.24M4 4v5h5m3-1v5l3 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

function PositionDetailModal({
  position,
  onClose
}: {
  position: PositionPresentation;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="position-title">
      <div className="modal stack">
        <div className="section-title section-title-wrap">
          <h2 id="position-title">{position.coin} · {position.direction}</h2>
          <button className="button secondary compact-button" type="button" onClick={onClose}>Cerrar</button>
        </div>
        <ProfitBadge status={position.status} />
        <div className="breakdown-grid">
          <BreakdownLine label="P&L no realizado" value={position.grossUnrealized.rounded} />
          <BreakdownLine label="closedPnl atribuido" value={position.rawClosedPnlAttributed.rounded} />
          <BreakdownLine label="rawFee neta" value={position.rawFeeNet.rounded} />
          <BreakdownLine label="Comision pagada" value={position.feePaid.rounded} />
          <BreakdownLine label="Rebate recibido" value={position.rebateReceived.rounded} />
          <BreakdownLine label="Builder fee" value={position.builderFeeIncluded.rounded} />
          <BreakdownLine label="Funding neto" value={position.fundingNet.rounded} />
          <BreakdownLine label="Cierre estimado taker" value={position.estimatedCloseFee.rounded} hint={`Tarifa exacta usada: ${position.feeRateUsed}`} />
          <BreakdownLine label="Neto si cerrases ahora" value={formatMaybeMoney(position.netIfCloseNow)} />
          <BreakdownLine label="Resultado conservador" value={formatMaybeMoney(position.conservativeNet)} />
          <BreakdownLine label="Liquidacion oficial" value={position.liquidationPrice?.rounded ?? "N/D"} />
          <BreakdownLine label="Nominal restante" value={position.nominalRemaining.rounded} />
          <BreakdownLine label="Ultima actualizacion" value={formatDateTime(position.lastUpdated)} />
        </div>
        <div className="caption">{position.status.reason}</div>
        {position.warnings.map((warning) => (
          <div className="pill" key={warning}>{warning}</div>
        ))}
      </div>
    </div>
  );
}

function classNameForStatus(status?: "red" | "orange" | "green" | "gray"): string {
  if (!status) {
    return "";
  }
  return status === "green" ? "success" : status === "red" ? "danger" : status === "orange" ? "warning" : "subtle";
}

function formatDateTime(value: string | number): string {
  const date = typeof value === "string" ? new Date(value) : new Date(value);
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

async function verifyCors(network: Network, address: string): Promise<string> {
  const endpoint = `${getApiBaseUrl(network)}/info`;
  const payloads = getReadOnlyPayloads(isAddressValid(address) ? address : "0x0000000000000000000000000000000000000000", Date.now());

  try {
    for (const payload of payloads) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        return `HTTP ${response.status} en ${String(payload.type)}`;
      }
      await response.clone().json();
    }
    return "Correcto desde navegador";
  } catch (error) {
    return error instanceof Error ? error.message : "Fallo de CORS o red";
  }
}

async function pasteAddress(onSettingsChange: (patch: Partial<UserSettings>) => void) {
  try {
    const text = await navigator.clipboard.readText();
    onSettingsChange({ address: text.trim() });
  } catch {
    // Silence clipboard permission errors in Safari/PWA contexts.
  }
}

function shortAddress(address: string): string {
  return address.length >= 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function exportCsv(fills: Fill[], complete: boolean) {
  const header = "fecha,activo,direccion,precio,tamano,nominal,rawClosedPnl,rawFee,rawBuilderFee,feeToken,makerTaker,orderId,hash,coverage";
  const rows = fills.map((fill) =>
    [
      formatDateTime(fill.time),
      fill.coin,
      fill.direction,
      fill.price,
      fill.size,
      fill.notional,
      fill.rawClosedPnl,
      fill.rawFee,
      fill.rawBuilderFee ?? "",
      fill.feeToken,
      fill.crossed ? "taker" : "maker",
      fill.orderId ?? "",
      fill.hash ?? "",
      complete ? "complete" : "partial"
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = complete ? "hlclear-fills-crudos.csv" : "hlclear-fills-crudos-parcial.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportAuditJson(snapshot: HyperliquidSnapshot, dashboard: DashboardPresentation) {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          network: snapshot.network,
          address: snapshot.address,
          audit: dashboard.audit,
          historyCoverage: dashboard.historyCoverage,
          raw: snapshot.raw
        },
        null,
        2
      )
    ],
    { type: "application/json;charset=utf-8" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hlclear-auditoria-local.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function createInitialState(): StoredAppState {
  return createEmptyState();
}
