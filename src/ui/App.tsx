import { useEffect, useMemo, useState } from "react";
import { fetchSnapshot, getApiBaseUrl, getReadOnlyPayloads, isAddressValid } from "../data/hyperliquidApi";
import { buildDashboard } from "../domain/dashboard";
import { coverageWindowLabel, formatMaybeMoney, labelCoverage, labelRawFee } from "../domain/accounting";
import { dec } from "../domain/decimal";
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

type TabKey = "summary" | "positions" | "history" | "movements" | "settings";

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "summary", label: "Resumen", icon: "RS" },
  { key: "positions", label: "Posiciones", icon: "PS" },
  { key: "history", label: "Historial", icon: "HS" },
  { key: "movements", label: "Movimientos", icon: "MV" },
  { key: "settings", label: "Ajustes", icon: "AJ" }
];

export function App() {
  const [tab, setTab] = useState<TabKey>(() => resolveInitialTab());
  const [state, setState] = useState<StoredAppState>(() => loadStoredState());
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [selectedPosition, setSelectedPosition] = useState<PositionPresentation | null>(null);
  const [corsStatus, setCorsStatus] = useState<string>("Pendiente");
  const [auditMode, setAuditMode] = useState<boolean>(() => new URLSearchParams(window.location.search).get("audit") === "1");

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
    const targetNetwork = networkOverride ?? state.settings.network;
    if (!isAddressValid(state.settings.address)) {
      setError("Introduce una direccion 0x valida.");
      return;
    }
    if (!navigator.onLine && !force) {
      setError("Sin conexion. Solo se puede mostrar el ultimo snapshot guardado.");
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

  function clearCache() {
    setState(createEmptyState());
  }

  const shellStatus = activeSnapshot?.stale || !online ? "offline" : "online";

  return (
    <>
      <main className="app-shell">
        <header className="hero">
          <span className="eyebrow">
            <span className={`status-dot ${shellStatus}`} />
            {online ? "Conectado" : "Sin conexion"} · {state.settings.network.toUpperCase()}
          </span>
          <h1>HLClear</h1>
          <p>PWA instalable de solo lectura para Hyperliquid con auditoria contable conservadora y cobertura temporal visible.</p>
        </header>

        <div className="stack">
          {(activeSnapshot?.stale || !online) && (
            <div className="banner">
              <strong>Datos desactualizados</strong>
              <span>La interfaz sigue abriendo offline y muestra el ultimo snapshot guardado, nunca como tiempo real.</span>
              <span>Ultima sincronizacion: {activeSnapshot ? formatDateTime(activeSnapshot.fetchedAt) : "Nunca"}</span>
            </div>
          )}

          {error && (
            <div className="card danger">
              <strong>Error</strong>
              <div>{error}</div>
            </div>
          )}

          {tab === "summary" && <SummaryTab dashboard={dashboard} state={state} syncState={syncState} onSync={() => void sync()} />}
          {tab === "positions" && <PositionsTab dashboard={dashboard} onOpenPosition={setSelectedPosition} />}
          {tab === "history" && <HistoryTab dashboard={dashboard} />}
          {tab === "movements" && <MovementsTab dashboard={dashboard} />}
          {tab === "settings" && (
            <SettingsTab
              settings={state.settings}
              snapshot={activeSnapshot}
              dashboard={dashboard}
              auditMode={auditMode}
              corsStatus={corsStatus}
              onToggleAudit={() => setAuditMode((current) => !current)}
              onSettingsChange={updateSettings}
              onSync={() => void sync()}
              onClearCache={clearCache}
            />
          )}
        </div>
      </main>

      <nav className="tabs" aria-label="Pestanas principales">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`tab-button ${tab === item.key ? "active" : ""}`}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {selectedPosition && <PositionDetailModal position={selectedPosition} onClose={() => setSelectedPosition(null)} />}
    </>
  );
}

function resolveInitialTab(): TabKey {
  const candidate = new URLSearchParams(window.location.search).get("tab");
  return tabs.some((item) => item.key === candidate) ? (candidate as TabKey) : "summary";
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
      <div className="card stack">
        <div className="section-title">
          <h2>Estado de cartera</h2>
          <button className="button" type="button" onClick={onSync} disabled={!isAddressValid(state.settings.address)}>
            {syncState === "loading" ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
        <div className="caption">Endpoint directo: {getApiBaseUrl(state.settings.network)}/info · Sin proxy · Solo lectura.</div>
      </div>

      {!dashboard ? (
        <div className="card">Introduce tu direccion publica en Ajustes y sincroniza para llenar el resumen.</div>
      ) : (
        <>
          <div className="card stack">
            <div className="section-title">
              <h2>Semantica contable</h2>
              <ProfitBadge status={dashboard.summary.status} />
            </div>
            <Line label="Estado" value={dashboard.summary.semantics.verified ? "Verificado" : "No verificado"} />
            <div className="caption">{dashboard.summary.semantics.reason}</div>
          </div>

          <div className="grid-2">
            <MetricCard label="Valor total" value={dashboard.summary.accountValue.rounded} />
            <MetricCard label="Saldo retirable" value={dashboard.summary.withdrawable.rounded} />
            <MetricCard label="Margen usado" value={dashboard.summary.marginUsed.rounded} />
            <MetricCard label="Depositos netos externos" value={dashboard.summary.netExternalDeposits.rounded} />
            <MetricCard label="Resultado patrimonial ajustado" value={dashboard.summary.accountValueAdjustedResult.rounded} emphasis={dashboard.summary.status.color} />
            <MetricCard label="closedPnl API acumulado" value={dashboard.summary.apiClosedPnl.rounded} />
            <MetricCard label="rawFee neta" value={dashboard.summary.rawFeeNet.rounded} />
            <MetricCard label="Comision pagada" value={dashboard.summary.feePaid.rounded} />
            <MetricCard label="Rebate recibido" value={dashboard.summary.rebateReceived.rounded} />
            <MetricCard label="De ella, builder fee" value={dashboard.summary.builderFeeIncluded.rounded} />
            <MetricCard label="Funding" value={dashboard.summary.funding.rounded} />
            <MetricCard label="P&L no realizado" value={dashboard.summary.unrealizedPnl.rounded} />
            <MetricCard label="P&L bruto verificado" value={formatMaybeMoney(dashboard.summary.grossTradingPnl)} />
            <MetricCard label="Resultado derivado" value={formatMaybeMoney(dashboard.summary.netPnlDerived)} emphasis={dashboard.summary.status.color} />
          </div>

          <div className="card stack">
            <h2>Cobertura del historial</h2>
            <Line label="Estado" value={labelCoverage(dashboard.historyCoverage)} />
            <Line label="Ventana real descargada" value={coverageWindowLabel(dashboard.historyCoverage)} />
            <Line label="Fills descargados" value={String(dashboard.historyCoverage.fillsDownloaded)} />
            <Line label="Funding descargado" value={String(dashboard.historyCoverage.fundingEntriesDownloaded)} />
            <Line label="Ledger descargado" value={String(dashboard.historyCoverage.ledgerEntriesDownloaded)} />
            <Line label="API limit oficial" value={dashboard.historyCoverage.reachedApiLimit ? "Alcanzado" : "No"} />
            <Line label="Limite interno" value={dashboard.historyCoverage.reachedInternalPageLimit ? "Alcanzado" : "No"} />
          </div>

          <div className="card stack">
            <h2>Estimaciones oficiales</h2>
            {dashboard.summary.officialEstimates.map((estimate) => (
              <Line key={estimate.label} label={estimate.label} value={estimate.value.rounded} />
            ))}
            <div className="caption">portfolio.pnlHistory se muestra solo como estimacion oficial; no como contabilidad exacta.</div>
          </div>

          <div className="card stack">
            <div className="section-title">
              <h2>Reconciliacion</h2>
              {!dashboard.reconciliation.verified && <span className="warning">Gris hasta verificacion completa</span>}
            </div>
            <Line label="Resultado patrimonial ajustado" value={dashboard.reconciliation.accountValueAdjustedResult.rounded} />
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
      <div className="card">
        <div className="section-title">
          <h2>Posiciones abiertas</h2>
          <span className="caption">Los resultados derivados quedan en gris si la contabilidad no esta verificada.</span>
        </div>
      </div>
      <div className="list">
        {dashboard.positions.length === 0 ? (
          <div className="card">No hay posiciones abiertas.</div>
        ) : (
          dashboard.positions.map((position) => (
            <button className="row-card" type="button" key={position.key} onClick={() => onOpenPosition(position)}>
              <div className="row-top">
                <strong>{position.coin} · {position.direction}</strong>
                <ProfitBadge status={position.status} />
              </div>
              <div className="position-grid">
                <Line label="P&L no realizado" value={position.grossUnrealized.rounded} />
                <Line label="closedPnl atribuido" value={position.rawClosedPnlAttributed.rounded} />
                <Line label="rawFee neta" value={position.rawFeeNet.rounded} />
                <Line label="Comision pagada" value={position.feePaid.rounded} />
                <Line label="Rebate recibido" value={position.rebateReceived.rounded} />
                <Line label="Builder fee incluido" value={position.builderFeeIncluded.rounded} />
                <Line label="Funding" value={position.fundingNet.rounded} />
                <Line label="Cierre estimado taker" value={position.estimatedCloseFee.rounded} />
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
      <div className="card stack">
        <div className="pill-row">
          <button className="button secondary" type="button" onClick={() => setMode("raw")}>Ejecuciones crudas</button>
          <button className="button secondary" type="button" onClick={() => setMode("daily")}>Resumen diario</button>
          <button className="button secondary" type="button" onClick={() => setMode("closed")}>Ciclos cerrados</button>
        </div>
        <div className="caption">{labelCoverage(dashboard.historyCoverage)}</div>
      </div>

      {mode === "raw" && <RawFillsTable rows={dashboard.rawFills} />}
      {mode === "daily" && <DailySummaryTable rows={dashboard.dailySummaries} />}
      {mode === "closed" && <ClosedCycleTable rows={dashboard.closedCycles} />}
    </section>
  );
}

function RawFillsTable({ rows }: { rows: Fill[] }) {
  return (
    <div className="card data-table">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Activo</th>
            <th>Direccion</th>
            <th>Precio</th>
            <th>Tamano</th>
            <th>Nominal</th>
            <th>rawClosedPnl</th>
            <th>rawFee</th>
            <th>Etiqueta fee</th>
            <th>builderFee</th>
            <th>feeToken</th>
            <th>Maker/Taker</th>
            <th>order ID</th>
            <th>Hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fill) => (
            <tr key={fill.stableId}>
              <td>{formatDateTime(fill.time)}</td>
              <td>{fill.coin}</td>
              <td>{fill.direction}</td>
              <td>{fill.price}</td>
              <td>{fill.size}</td>
              <td>{fill.notional}</td>
              <td>{fill.rawClosedPnl}</td>
              <td>{fill.rawFee}</td>
              <td>{labelRawFee(dec(fill.rawFee))}</td>
              <td>{fill.rawBuilderFee ?? "0"}</td>
              <td>{fill.feeToken}</td>
              <td>{fill.crossed ? "taker" : "maker"}</td>
              <td>{fill.orderId ?? "N/D"}</td>
              <td>{fill.hash ?? "N/D"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailySummaryTable({ rows }: { rows: DashboardPresentation["dailySummaries"] }) {
  return (
    <div className="list">
      {rows.map((row) => (
        <div className="card stack" key={row.day}>
          <div className="row-top">
            <strong>{row.day}</strong>
            <ProfitBadge status={row.status} />
          </div>
          <Line label="closedPnl API" value={row.apiClosedPnl.rounded} />
          <Line label="Comision maker pagada" value={row.makerFeePaid.rounded} />
          <Line label="Comision taker pagada" value={row.takerFeePaid.rounded} />
          <Line label="Rebate maker recibido" value={row.makerRebateReceived.rounded} />
          <Line label="Rebate taker recibido" value={row.takerRebateReceived.rounded} />
          <Line label="rawFee neta" value={row.rawFeeNet.rounded} />
          <Line label="Funding" value={row.funding.rounded} />
          <Line label="Resultado derivado" value={formatMaybeMoney(row.derivedNetPnl)} />
          <Line label="Volumen" value={row.volume.rounded} />
          <Line label="Ejecuciones" value={String(row.executions)} />
          <div className="caption">{row.verified ? "Semantica verificada para este resumen." : "Resumen derivado no verificado."}</div>
        </div>
      ))}
    </div>
  );
}

function ClosedCycleTable({ rows }: { rows: DashboardPresentation["closedCycles"] }) {
  return (
    <div className="list">
      {rows.map((row) => (
        <div className="card stack" key={row.id}>
          <div className="row-top">
            <strong>{row.coin}</strong>
            <ProfitBadge status={row.status} />
          </div>
          <Line label="closedPnl API" value={row.apiClosedPnl.rounded} />
          <Line label="rawFee neta" value={row.rawFeeNet.rounded} />
          <Line label="Comision pagada" value={row.feePaid.rounded} />
          <Line label="Rebate recibido" value={row.rebateReceived.rounded} />
          <Line label="De ella, builder fee" value={row.builderFeeIncluded.rounded} />
          <Line label="Funding" value={row.funding.rounded} />
          <Line label="Resultado derivado" value={formatMaybeMoney(row.derivedNetPnl)} />
          <Line label="Ejecuciones" value={String(row.executions)} />
          <Line label="Duracion" value={row.durationLabel} />
        </div>
      ))}
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
          <div className="card stack" key={title}>
            <h2>{title}</h2>
            {rows.map((row) => (
              <div className="row-card" key={row.id}>
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

function SettingsTab({
  settings,
  snapshot,
  dashboard,
  auditMode,
  corsStatus,
  onToggleAudit,
  onSettingsChange,
  onSync,
  onClearCache
}: {
  settings: UserSettings;
  snapshot?: HyperliquidSnapshot;
  dashboard?: DashboardPresentation;
  auditMode: boolean;
  corsStatus: string;
  onToggleAudit: () => void;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
  onSync: () => void;
  onClearCache: () => void;
}) {
  return (
    <section className="stack">
      <div className="card form-grid">
        <div className="field">
          <label htmlFor="address">Direccion publica</label>
          <input
            id="address"
            type="text"
            placeholder="0x..."
            value={settings.address}
            onChange={(event) => onSettingsChange({ address: event.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        <div className="field">
          <label htmlFor="network">Entorno</label>
          <select id="network" value={settings.network} onChange={(event) => onSettingsChange({ network: event.target.value as Network })}>
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
        </div>

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

        <div className="action-row">
          <button className="button" type="button" onClick={onSync}>Guardar y sincronizar</button>
          <button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(settings.address)}>Copiar direccion</button>
          <button className="button secondary" type="button" onClick={onClearCache}>Borrar todos mis datos locales</button>
        </div>
      </div>

      <div className="card stack">
        <h2>Estado y exportacion</h2>
        <Line label="Ultima sincronizacion" value={snapshot ? formatDateTime(snapshot.fetchedAt) : "Nunca"} />
        <Line label="Estado de la API" value={snapshot?.apiHealth ?? "Sin consultar"} />
        <Line label="Verificacion CORS" value={corsStatus} />
        <Line label="Cobertura" value={dashboard ? labelCoverage(dashboard.historyCoverage) : "Sin datos"} />
        <Line label="Moneda visual" value="USD" />
        <button
          className="button secondary"
          type="button"
          disabled={!snapshot}
          onClick={() => exportCsv(snapshot?.fills ?? [], dashboard?.historyCoverage.isCompleteForRequestedPeriod ?? false)}
        >
          Exportar fills crudos CSV
        </button>
        {dashboard && !dashboard.historyCoverage.isCompleteForRequestedPeriod && (
          <div className="caption">La exportacion es cruda y puede ser parcial; no se presenta como contabilidad completa.</div>
        )}
      </div>

      <div className="card stack">
        <h2>Metodologia</h2>
        <Line label="Resultado patrimonial ajustado" value="accountValue + retiradas externas - depositos externos" />
        <Line label="closedPnl API" value="suma exacta del campo rawClosedPnl recibido de Hyperliquid" />
        <Line label="rawFee" value="rawFee conserva exactamente el signo de la API: positivo = comision cobrada, negativo = rebate recibido" />
        <Line label="Comision pagada" value="suma de rawFee positivos" />
        <Line label="Rebate recibido" value="suma del valor absoluto de rawFee negativos" />
        <Line label="Funding" value="suma algebraica de rawFunding" />
        <Line label="Resultado derivado" value="solo se muestra como verificado si la semantica de closedPnl frente a fee queda demostrada" />
        <Line label="Estimaciones oficiales" value="portfolio.pnlHistory solo se muestra como estimacion oficial 24 h / 7 dias / 30 dias" />
      </div>

      <div className="card stack">
        <div className="section-title">
          <h2>Ajustes avanzados</h2>
          <button className="button secondary" type="button" onClick={onToggleAudit}>
            {auditMode ? "Ocultar auditoria" : "Modo auditoria local"}
          </button>
        </div>
        <div className="caption">El modo auditoria muestra JSON original y formulas locales. No envia nada y no se exporta automaticamente.</div>
      </div>

      {auditMode && dashboard && snapshot && (
        <div className="card stack">
          <h2>Auditoria local</h2>
          <Line label="Suma raw closedPnl" value={dashboard.audit.rawClosedPnl.rounded} />
          <Line label="Suma raw fee neta" value={dashboard.audit.rawFeeNet.rounded} />
          <Line label="Suma comision pagada" value={dashboard.audit.feePaid.rounded} />
          <Line label="Suma rebate recibido" value={dashboard.audit.rebateReceived.rounded} />
          <Line label="Suma raw builderFee" value={dashboard.audit.rawBuilderFeeIncluded.rounded} />
          <Line label="Suma funding" value={dashboard.audit.rawFunding.rounded} />
          <Line label="Resultado patrimonial ajustado" value={dashboard.audit.accountValueAdjustedResult.rounded} />
          <Line label="P&L bruto verificado" value={formatMaybeMoney(dashboard.audit.grossTradingPnl)} />
          <Line label="Resultado derivado" value={formatMaybeMoney(dashboard.audit.netPnlDerived)} />
          <Line label="Cobertura temporal" value={coverageWindowLabel(dashboard.historyCoverage)} />
          {dashboard.audit.formulas.map((formula) => (
            <div className="pill" key={formula}>{formula}</div>
          ))}
          <button className="button secondary" type="button" onClick={() => exportAuditJson(snapshot, dashboard)}>
            Exportar informe JSON local
          </button>
          <details>
            <summary>JSON original de endpoints</summary>
            <pre className="technical-block">{JSON.stringify(snapshot.raw, null, 2)}</pre>
          </details>
        </div>
      )}

      <div className="card stack">
        <h2>Payloads de lectura</h2>
        <pre className="technical-block">{JSON.stringify(getReadOnlyPayloads(settings.address || "0x0000000000000000000000000000000000000000", Date.now()), null, 2)}</pre>
      </div>
    </section>
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
        <div className="section-title">
          <h2 id="position-title">{position.coin} · {position.direction}</h2>
          <button className="button secondary" type="button" onClick={onClose}>Cerrar</button>
        </div>
        <ProfitBadge status={position.status} />
        <div className="breakdown-grid">
          <BreakdownLine label="P&L no realizado" value={position.grossUnrealized.rounded} />
          <BreakdownLine label="closedPnl atribuido" value={position.rawClosedPnlAttributed.rounded} />
          <BreakdownLine label="rawFee neta" value={position.rawFeeNet.rounded} />
          <BreakdownLine label="Comision pagada" value={position.feePaid.rounded} />
          <BreakdownLine label="Rebate recibido" value={position.rebateReceived.rounded} />
          <BreakdownLine label="De ella, builder fee" value={position.builderFeeIncluded.rounded} />
          <BreakdownLine label="Funding neto" value={position.fundingNet.rounded} />
          <BreakdownLine label="Cierre estimado taker" value={position.estimatedCloseFee.rounded} hint={`Tarifa exacta usada: ${position.feeRateUsed}`} />
          <BreakdownLine label="Neto si cerrases ahora" value={formatMaybeMoney(position.netIfCloseNow)} />
          <BreakdownLine label="Resultado conservador con slippage" value={formatMaybeMoney(position.conservativeNet)} />
          <BreakdownLine label="Precio de liquidacion oficial" value={position.liquidationPrice?.rounded ?? "N/D"} />
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

function MetricCard({ label, value, emphasis }: { label: string; value: string; emphasis?: "red" | "orange" | "green" | "gray" }) {
  return (
    <div className="card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value mono ${classNameForStatus(emphasis)}`}>{value}</div>
    </div>
  );
}

function ProfitBadge({ status }: { status: DashboardPresentation["summary"]["status"] | PositionPresentation["status"] }) {
  return <span className={`profit-state profit-${status.color}`}>{status.icon} {status.label}</span>;
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
