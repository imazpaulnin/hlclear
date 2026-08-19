import { useEffect, useMemo, useState } from "react";
import { dec, formatNumber } from "../domain/decimal";
import { buildTradeAssetQuotes, clampTradeLeverage, getAdverseMoveLabel, prepareTrade, resolveMaxMarginUsdc, tradeSimulationOptions } from "../domain/trade/prepareTrade";
import { resolveTradeFeeRate } from "../domain/trade/fees";
import type { TradeAssetQuote, TradeExecutionMode, TradeSide } from "../domain/tradeTypes";
import type { HyperliquidSnapshot, UserFees, UserSettings } from "../domain/types";
import type { Eip1193Provider } from "../wallet/types";
import { buildConfirmationSummary } from "../trading/testnetTradingService";
import type { MarginMode } from "../trading/types";
import { useTestnetTrading } from "../trading/useTestnetTrading";

const QUICK_MARGINS = ["25", "50", "100", "250", "500"];
const FAVORITE_COINS = ["BTC", "ETH", "SOL", "HYPE", "XRP"];

export function TradeTab({
  snapshot,
  settings,
  onSettingsChange,
  walletAddress,
  walletNetworkLabel,
  auditAddress,
  auditAddressMatches,
  walletProvider
}: {
  snapshot?: HyperliquidSnapshot;
  settings: UserSettings;
  onSettingsChange: (patch: Partial<UserSettings>) => void;
  walletAddress?: string;
  walletNetworkLabel: string;
  auditAddress: string;
  auditAddressMatches: boolean | undefined;
  walletProvider: Eip1193Provider | null;
}) {
  const quotes = useMemo(
    () =>
      buildTradeAssetQuotes({
        favorites: FAVORITE_COINS,
        marketContexts: snapshot?.marketContexts ?? [],
        universe: snapshot?.universe ?? []
      }),
    [snapshot]
  );
  const [query, setQuery] = useState("");
  const [selectedCoin, setSelectedCoin] = useState<string>(quotes[0]?.coin ?? "BTC");
  const [side, setSide] = useState<TradeSide>("long");
  const [executionMode, setExecutionMode] = useState<TradeExecutionMode>("taker");
  const [marginMode, setMarginMode] = useState<MarginMode>("cross");
  const [marginUsdc, setMarginUsdc] = useState("50");
  const [leverage, setLeverage] = useState("5");
  const [simulationIndex, setSimulationIndex] = useState(3);
  const [showValidation, setShowValidation] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const trading = useTestnetTrading({
    provider: walletProvider,
    walletAddress,
    auditAddress,
    auditAddressMatches,
    snapshot
  });

  useEffect(() => {
    if (!quotes.some((quote) => quote.coin === selectedCoin) && quotes[0]) {
      setSelectedCoin(quotes[0].coin);
    }
  }, [quotes, selectedCoin]);

  const selectedAsset = useMemo(
    () => quotes.find((quote) => quote.coin === selectedCoin) ?? quotes[0],
    [quotes, selectedCoin]
  );

  useEffect(() => {
    if (!selectedAsset) {
      return;
    }
    setLeverage((current) => clampTradeLeverage(current, selectedAsset));
  }, [selectedAsset]);

  const filteredQuotes = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery) {
      return quotes;
    }

    return quotes.filter((quote) => quote.coin.includes(normalizedQuery));
  }, [query, quotes]);

  const feeRate = resolveTradeFeeRate(snapshot?.userFees as UserFees | undefined, executionMode);
  const simulationMovePct = tradeSimulationOptions[simulationIndex] ?? "0";
  const trade = selectedAsset
    ? prepareTrade({
        asset: selectedAsset,
        draft: {
          coin: selectedAsset.coin,
          side,
          executionMode,
          marginUsdc,
          leverage: clampTradeLeverage(leverage, selectedAsset),
          slippageBps: settings.slippageBps
        },
        feeRate,
        simulationMovePct
      })
    : undefined;

  const availableUsdc = resolveAvailableUsdc(snapshot);
  const maxMarginUsdc = resolveMaxMarginUsdc({
    riskLimitUsdc: settings.maxOrderMarginUsdc,
    availableUsdc
  });
  const assetIndex = snapshot?.universe.findIndex((asset) => asset.name === selectedAsset?.coin) ?? -1;
  const confirmation = trade ? buildConfirmationSummary({ prepared: trade, marginMode }) : undefined;

  async function handleContinue() {
    setShowValidation(true);
    if (!trade || trade.validationErrors.length > 0) {
      return;
    }
    setShowConfirmation(true);
  }

  async function handleConfirmInWallet() {
    if (!trade || assetIndex < 0) {
      trading.setActionError("No se pudo resolver el activo en Hyperliquid Testnet.");
      return;
    }

    const result = await trading.submit({
      prepared: trade,
      assetIndex,
      marginMode,
      slippageBps: settings.slippageBps,
      leverage: trade.leverage
    });

    if (result) {
      setShowConfirmation(false);
    }
  }

  return (
    <section className="stack">
      <div className="card compact-card stack trade-shell">
        <div className="section-title section-title-wrap">
          <div>
            <h2>Operar</h2>
            <div className="caption">Ejecucion manual en navegador. Solo Testnet en esta fase.</div>
          </div>
          <div className={`pill ${trading.tradingEnvironment === "testnet" ? "" : "warning"}`}>
            {trading.tradingEnvironment === "testnet" ? "TESTNET habilitado" : "MAINNET bloqueado"}
          </div>
        </div>

        <div className="trade-env-switch">
          <button
            className={`quick-chip ${trading.tradingEnvironment === "testnet" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setShowConfirmation(false);
              trading.setTradingEnvironment("testnet");
            }}
          >
            TESTNET
          </button>
          <button
            className={`quick-chip ${trading.tradingEnvironment === "mainnet" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setShowConfirmation(false);
              trading.setTradingEnvironment("mainnet");
            }}
          >
            MAINNET
          </button>
        </div>

        {trading.tradingEnvironment === "mainnet" && (
          <div className="card danger" role="alert">
            <strong>La operativa real todavia no esta habilitada.</strong>
            <div>Mainnet permanece bloqueado durante la Fase 2.3.</div>
          </div>
        )}

        <div className="card compact-card stack dense-stack">
          <h2>Wallet conectada</h2>
          <Line label="Direccion" value={walletAddress ? shortAddress(walletAddress) : "Sin conectar"} />
          <Line label="Red" value={walletNetworkLabel} />
          <Line label="Estado" value={walletAddress ? "Conectada" : "No conectada"} />
          <Line label="Direccion auditada" value={auditAddress ? shortAddress(auditAddress) : "Sin configurar"} />
          <Line label="Coincidencia" value={auditAddressMatches === undefined ? "Pendiente" : auditAddressMatches ? "Coincide" : "No coincide"} />
          <div className="caption">Cada operacion Testnet solicita firma local en la wallet conectada. No se usa un agente intermedio en la ruta activa de operativa.</div>
        </div>

        {!trading.eligibility.allowed && (
          <div className="card danger" role="alert">
            <strong>Envio bloqueado</strong>
            <div>{trading.eligibility.reason}</div>
          </div>
        )}

        {trading.actionError && (
          <div className="card danger" role="alert">
            <strong>Error de operativa</strong>
            <div>{trading.actionError}</div>
          </div>
        )}

        {trading.liveSnapshot.connection !== "idle" && (
          <div className="card compact-card stack dense-stack">
            <div className="section-title section-title-wrap">
              <h2>Estado Testnet</h2>
              <OutcomeBadge
                label={
                  trading.liveSnapshot.connection === "ready"
                    ? "Conectado"
                    : trading.liveSnapshot.connection === "connecting"
                      ? "Conectando"
                      : "Error"
                }
                color={trading.liveSnapshot.connection === "ready" ? "green" : trading.liveSnapshot.connection === "connecting" ? "orange" : "red"}
              />
            </div>
            <div className="caption">{trading.liveSnapshot.connectionMessage ?? "Suscripciones de posicion, fills, funding y ordenes activas."}</div>
          </div>
        )}

        {!snapshot ? (
          <div className="card">
            Sin snapshot local todavia. Sincroniza primero para ver precios, funding y limites reales del activo.
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="trade-search">Buscar activo</label>
              <input
                id="trade-search"
                type="search"
                placeholder="BTC, ETH, SOL..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <div className="stack dense-stack">
              <div className="caption">Favoritos</div>
              <div className="quick-chip-row">
                {FAVORITE_COINS.map((coin) => (
                  <button
                    key={coin}
                    className={`quick-chip ${selectedCoin === coin ? "active" : ""}`}
                    type="button"
                    onClick={() => setSelectedCoin(coin)}
                  >
                    {coin}
                  </button>
                ))}
              </div>
            </div>

            <div className="trade-asset-list">
              {filteredQuotes.slice(0, 8).map((quote) => (
                <button
                  key={quote.coin}
                  className={`trade-asset-card ${selectedAsset?.coin === quote.coin ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedCoin(quote.coin)}
                >
                  <div className="row-top">
                    <strong>{quote.coin}</strong>
                    <span className={classNameForChange(quote.priceChange24hPct)}>{formatPct(quote.priceChange24hPct)}</span>
                  </div>
                  <div className="trade-asset-meta">
                    <span>{formatPrice(quote.currentPrice)}</span>
                    <span>Funding {formatRate(quote.fundingRate)}</span>
                    <span>Max {quote.maxLeverage}x</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="trade-action-grid">
              <button className={`trade-side-button ${side === "long" ? "long active" : "long"}`} type="button" onClick={() => setSide("long")}>
                LONG
              </button>
              <button className={`trade-side-button ${side === "short" ? "short active" : "short"}`} type="button" onClick={() => setSide("short")}>
                SHORT
              </button>
            </div>

            <div className="trade-action-grid compact">
              <button
                className={`trade-side-button neutral ${marginMode === "cross" ? "active" : ""}`}
                type="button"
                onClick={() => setMarginMode("cross")}
              >
                CRUZADO
              </button>
              <button
                className={`trade-side-button neutral ${marginMode === "isolated" ? "active" : ""}`}
                type="button"
                onClick={() => setMarginMode("isolated")}
              >
                AISLADO
              </button>
            </div>

            <div className="card compact-card stack dense-stack trade-control-card">
              <div className="section-title">
                <h2>Margen</h2>
                <strong className="mono">{formatMoneyCompact(marginUsdc)} USDC</strong>
              </div>
              <div className="field">
                <label htmlFor="trade-margin">Margen editable</label>
                <input
                  id="trade-margin"
                  type="number"
                  min="0"
                  step="0.01"
                  value={marginUsdc}
                  onChange={(event) => setMarginUsdc(event.target.value)}
                />
              </div>
              <div className="quick-chip-row">
                {QUICK_MARGINS.map((value) => (
                  <button key={value} className="quick-chip" type="button" onClick={() => setMarginUsdc(value)}>
                    {value}
                  </button>
                ))}
                <button className="quick-chip quick-chip-accent" type="button" onClick={() => setMarginUsdc(maxMarginUsdc)}>
                  MAX
                </button>
              </div>
              <div className="caption">
                MAX respeta el limite local de riesgo configurado: {formatMoneyCompact(settings.maxOrderMarginUsdc)} USDC
                {availableUsdc ? ` y la disponibilidad estimada de ${formatMoneyCompact(availableUsdc)} USDC.` : "."}
              </div>
            </div>

            <div className="card compact-card stack dense-stack trade-control-card">
              <div className="section-title">
                <h2>Apalancamiento</h2>
                <strong className="mono">{clampTradeLeverage(leverage, selectedAsset)}x</strong>
              </div>
              <input
                className="trade-slider"
                type="range"
                min="1"
                max={String(Math.max(1, selectedAsset?.maxLeverage ?? 1))}
                step="1"
                value={Number(clampTradeLeverage(leverage, selectedAsset))}
                onChange={(event) => setLeverage(event.target.value)}
              />
              <div className="quick-chip-row">
                {buildLeverageQuickOptions(selectedAsset).map((value) => (
                  <button key={value} className="quick-chip" type="button" onClick={() => setLeverage(value)}>
                    {value}x
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="trade-leverage">Escribir apalancamiento</label>
                <input
                  id="trade-leverage"
                  type="number"
                  min="1"
                  max={selectedAsset?.maxLeverage ?? 1}
                  step="1"
                  value={leverage}
                  onChange={(event) => setLeverage(event.target.value)}
                />
              </div>
            </div>

            <div className="card compact-card stack dense-stack trade-control-card">
              <div className="section-title">
                <h2>Tipo de ejecucion</h2>
                <div className="caption">Afecta a comisiones y break-even.</div>
              </div>
              <div className="trade-action-grid compact">
                <button
                  className={`trade-side-button neutral ${executionMode === "maker" ? "active" : ""}`}
                  type="button"
                  onClick={() => setExecutionMode("maker")}
                >
                  MAKER
                </button>
                <button
                  className={`trade-side-button neutral ${executionMode === "taker" ? "active" : ""}`}
                  type="button"
                  onClick={() => setExecutionMode("taker")}
                >
                  TAKER
                </button>
              </div>
            </div>

            {trade && (
              <>
                <div className="grid-2">
                  <TradeMetric label="Precio actual" value={formatPrice(trade.currentPrice)} />
                  <TradeMetric label="Entrada estimada" value={formatPrice(trade.estimatedEntryPrice)} />
                  <TradeMetric label="Margen" value={`${formatMoneyCompact(trade.marginUsdc)} USDC`} />
                  <TradeMetric label="Valor nocional" value={`${formatMoneyCompact(trade.notionalUsdc)} USDC`} />
                  <TradeMetric label="Apalancamiento" value={`${formatMoneyCompact(trade.leverage)}x`} />
                  <TradeMetric label="Funding actual" value={formatRate(trade.fundingRate)} />
                  <TradeMetric label="Comision entrada" value={`${formatMoneyCompact(trade.entryFeeUsdc)} USDC`} />
                  <TradeMetric label="Comision salida" value={`${formatMoneyCompact(trade.exitFeeUsdc)} USDC`} />
                  <TradeMetric label="Coste ida y vuelta" value={`${formatMoneyCompact(trade.totalRoundTripFeesUsdc)} USDC`} />
                  <TradeMetric label="Slippage estimado" value={`${formatMoneyCompact(settings.slippageBps)} bps`} />
                  <TradeMetric label="Coste slippage" value={`${formatMoneyCompact(trade.slippageCostUsdc)} USDC`} />
                  <TradeMetric label="Funding estimado" value={`${formatSignedMoney(trade.fundingEstimateUsdc)} USDC`} />
                </div>

                <div className="card compact-card stack trade-break-even-card">
                  <div className="caption">Break-even</div>
                  <div className="trade-break-even-copy">Necesitas</div>
                  <div className="trade-break-even-value">{side === "long" ? "+" : "-"}{formatPctAbs(trade.breakEvenMovePct)}</div>
                  <div className="trade-break-even-copy">para empezar a ganar dinero.</div>
                  <div className="caption">Precio break-even: {formatPrice(trade.breakEvenPrice)}</div>
                </div>

                <div className="card compact-card stack dense-stack">
                  <div className="section-title section-title-wrap">
                    <h2>Resumen en tiempo real</h2>
                    <OutcomeBadge label={trade.simulated.status.label} color={trade.simulated.status.color} />
                  </div>
                  <Line label="Movimiento minimo para cubrir costes" value={formatPctAbs(trade.breakEvenMovePct)} />
                  <Line label="Coste total all-in" value={`${formatMoneyCompact(trade.totalCostsUsdc)} USDC`} />
                  <Line
                    label="Liquidacion"
                    value={trade.liquidationReliable && trade.liquidationPrice ? formatPrice(trade.liquidationPrice) : "No disponible sin datos fiables"}
                  />
                  <div className="caption">{trade.simulated.status.reason}</div>
                </div>

                <div className="card compact-card stack dense-stack">
                  <div className="section-title section-title-wrap">
                    <h2>Simulador</h2>
                    <strong className="mono">Si el precio se mueve {signedMoveLabel(simulationMovePct)}</strong>
                  </div>
                  <input
                    className="trade-slider"
                    type="range"
                    min="0"
                    max={String(tradeSimulationOptions.length - 1)}
                    step="1"
                    value={simulationIndex}
                    onChange={(event) => setSimulationIndex(Number(event.target.value))}
                  />
                  <div className="quick-chip-row">
                    {tradeSimulationOptions.map((option, index) => (
                      <button
                        key={option}
                        className={`quick-chip ${index === simulationIndex ? "active" : ""}`}
                        type="button"
                        onClick={() => setSimulationIndex(index)}
                      >
                        {signedMoveLabel(option)}
                      </button>
                    ))}
                  </div>
                  <div className="grid-2">
                    <TradeMetric label="Beneficio bruto" value={`${formatSignedMoney(trade.simulated.grossPnl)} USDC`} />
                    <TradeMetric label="Comisiones" value={`${formatMoneyCompact(trade.simulated.fees)} USDC`} />
                    <TradeMetric label="Funding" value={`${formatSignedMoney(trade.simulated.funding)} USDC`} />
                    <TradeMetric label="Beneficio neto" value={`${formatSignedMoney(trade.simulated.netPnl)} USDC`} />
                  </div>
                </div>

                <div className="card compact-card stack dense-stack">
                  <div className="section-title section-title-wrap">
                    <h2>Riesgo</h2>
                    <div className="caption">{getAdverseMoveLabel(side)}</div>
                  </div>
                  <div className="trade-risk-list">
                    {trade.riskRows.map((row) => (
                      <div key={row.movePct} className="trade-risk-row">
                        <span>{row.movePct} %</span>
                        <strong className="mono">{formatMoneyCompact(row.projectedLossUsdc)} USDC</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card compact-card stack dense-stack">
                  <h2>Resumen final</h2>
                  <Line label={`${side.toUpperCase()} ${trade.asset.coin}`} value={`${executionMode.toUpperCase()} · ${marginMode.toUpperCase()}`} />
                  <Line label="Margen" value={`${formatMoneyCompact(trade.marginUsdc)} USDC`} />
                  <Line label="Apalancamiento" value={`${formatMoneyCompact(trade.leverage)}x`} />
                  <Line label="Valor nocional" value={`${formatMoneyCompact(trade.notionalUsdc)} USDC`} />
                  <Line label="Comision entrada" value={`${formatMoneyCompact(trade.entryFeeUsdc)} USDC`} />
                  <Line label="Comision salida" value={`${formatMoneyCompact(trade.exitFeeUsdc)} USDC`} />
                  <Line label="Funding" value={`${formatSignedMoney(trade.fundingEstimateUsdc)} USDC`} />
                  <Line label="Slippage" value={`${formatMoneyCompact(trade.slippageCostUsdc)} USDC`} />
                  <Line label="Break-even" value={formatPctAbs(trade.breakEvenMovePct)} />
                  <Line
                    label="Liquidacion"
                    value={trade.liquidationReliable && trade.liquidationPrice ? "Estimada" : "No disponible"}
                  />
                  {trade.finalScenarios.map((scenario) => (
                    <Line
                      key={scenario.movePct}
                      label={`Beneficio estimado ${signedMoveLabel(scenario.movePct)}`}
                      value={`${formatSignedMoney(scenario.netPnl)} USDC`}
                    />
                  ))}
                </div>

                {showValidation && trade.validationErrors.length > 0 && (
                  <div className="card danger" role="alert">
                    <strong>No se puede continuar todavia</strong>
                    <div>{trade.validationErrors.join(" ")}</div>
                  </div>
                )}

                <button className="button full-width trade-continue-button" type="button" onClick={() => void handleContinue()}>
                  CONTINUAR
                </button>
              </>
            )}

            <div className="card compact-card stack dense-stack">
              <div className="section-title">
                <h2>Limite de riesgo local</h2>
                <strong className="mono">{formatMoneyCompact(settings.maxOrderMarginUsdc)} USDC</strong>
              </div>
              <div className="field">
                <label htmlFor="trade-risk-limit">MAX por operacion</label>
                <input
                  id="trade-risk-limit"
                  type="number"
                  min="0"
                  step="1"
                  value={settings.maxOrderMarginUsdc}
                  onChange={(event) => onSettingsChange({ maxOrderMarginUsdc: event.target.value })}
                />
              </div>
            </div>

            {trading.liveSnapshot.latestOrderStatus && (
              <div className="card compact-card stack dense-stack">
                <div className="section-title section-title-wrap">
                  <h2>Ultima respuesta</h2>
                  <OutcomeBadge label={trading.liveSnapshot.latestOrderStatus.phase} color={statusColor(trading.liveSnapshot.latestOrderStatus.phase)} />
                </div>
                <Line label="Estado" value={trading.liveSnapshot.latestOrderStatus.summary} />
                {trading.liveSnapshot.latestOrderStatus.averagePrice && (
                  <Line label="Precio real" value={formatPrice(trading.liveSnapshot.latestOrderStatus.averagePrice)} />
                )}
                {trading.liveSnapshot.latestOrderStatus.filledSize && (
                  <Line label="Cantidad ejecutada" value={trading.liveSnapshot.latestOrderStatus.filledSize} />
                )}
              </div>
            )}

            <div className="card compact-card stack dense-stack">
              <div className="section-title section-title-wrap">
                <h2>Posiciones Testnet</h2>
                <button className="button secondary compact-button" type="button" onClick={() => void trading.cancelAll()} disabled={trading.submitting}>
                  Cancelar todas
                </button>
              </div>
              {trading.liveSnapshot.positions.length === 0 ? (
                <div className="caption">No hay posiciones abiertas en Testnet.</div>
              ) : (
                trading.liveSnapshot.positions.map((position) => (
                  <div className="card compact-card stack dense-stack" key={`${position.coin}-${position.side}`}>
                    <div className="section-title section-title-wrap">
                      <h2>{position.coin} · {position.side === "long" ? "LONG" : "SHORT"}</h2>
                      <OutcomeBadge label={position.trafficLight.label} color={position.trafficLight.color} />
                    </div>
                    <div className="grid-2">
                      <TradeMetric label="Beneficio bruto" value={`${formatSignedMoney(position.unrealizedPnl)} USDC`} />
                      <TradeMetric label="Beneficio neto" value={`${formatSignedMoney(position.netPnl)} USDC`} />
                      <TradeMetric label="Funding" value={`${formatSignedMoney(position.fundingSinceOpen)} USDC`} />
                      <TradeMetric label="Comisiones" value={`${formatMoneyCompact(position.feeSinceOpen)} USDC`} />
                      <TradeMetric label="Break-even" value={position.breakEvenPrice ? formatPrice(position.breakEvenPrice) : "N/D"} />
                      <TradeMetric label="Liquidacion" value={position.liquidationPrice ? formatPrice(position.liquidationPrice) : "N/D"} />
                    </div>
                    <div className="quick-chip-row">
                      {[25, 50, 75, 100].map((percentage) => (
                        <button
                          key={percentage}
                          className="quick-chip"
                          type="button"
                          disabled={trading.submitting}
                          onClick={() =>
                            void trading.closeOpenPosition(position, {
                              coin: position.coin,
                              assetIndex: snapshot.universe.findIndex((asset) => asset.name === position.coin),
                              percentage: percentage as 25 | 50 | 75 | 100,
                              currentPrice: selectedAsset?.currentPrice ?? position.markPrice ?? position.entryPrice,
                              slippageBps: settings.slippageBps
                            })
                          }
                        >
                          Cerrar {percentage}%
                        </button>
                      ))}
                    </div>
                    <div className="caption">Reduce Only activo en todos los cierres parciales de Testnet.</div>
                  </div>
                ))
              )}
            </div>

            <div className="card compact-card stack dense-stack">
              <h2>Ordenes abiertas Testnet</h2>
              {trading.liveSnapshot.openOrders.length === 0 ? (
                <div className="caption">No hay ordenes abiertas en Testnet.</div>
              ) : (
                trading.liveSnapshot.openOrders.map((order) => (
                  <div className="row-card compact-row" key={`${order.coin}-${order.orderId}`}>
                    <div className="row-top">
                      <strong>{order.coin} · {order.side === "long" ? "LONG" : "SHORT"}</strong>
                      <button
                        className="button secondary compact-button"
                        type="button"
                        disabled={trading.submitting}
                        onClick={() => void trading.cancelOrder(snapshot.universe.findIndex((asset) => asset.name === order.coin), order.orderId)}
                      >
                        Cancelar
                      </button>
                    </div>
                    <div className="trade-asset-meta">
                      <span>Precio {formatPrice(order.limitPrice)}</span>
                      <span>Size {order.size}</span>
                      <span>{order.reduceOnly ? "Reduce Only" : "Apertura"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {showConfirmation && trade && confirmation && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="trade-confirmation-title">
            <div className="modal stack trade-confirmation-modal">
            <div className="section-title section-title-wrap">
              <h2 id="trade-confirmation-title">Confirmar operacion</h2>
              <button className="button secondary compact-button" type="button" onClick={() => setShowConfirmation(false)}>
                Cerrar
              </button>
            </div>
            <div className="card compact-card stack dense-stack">
              <div className="section-title section-title-wrap">
                <h2>{confirmation.title}</h2>
                <OutcomeBadge label={trade.simulated.status.label} color={trade.simulated.status.color} />
              </div>
              <Line label="Precio" value={formatPrice(confirmation.estimatedEntryPrice)} />
              <Line label="Margen" value={`${formatMoneyCompact(confirmation.marginUsdc)} USDC`} />
              <Line label="Apalancamiento" value={`${formatMoneyCompact(confirmation.leverage)}x · ${confirmation.marginMode.toUpperCase()}`} />
              <Line label="Valor nocional" value={`${formatMoneyCompact(confirmation.notionalUsdc)} USDC`} />
              <Line label="Fee entrada" value={`${formatMoneyCompact(confirmation.entryFeeUsdc)} USDC`} />
              <Line label="Fee salida" value={`${formatMoneyCompact(confirmation.exitFeeUsdc)} USDC`} />
              <Line label="Funding" value={`${formatSignedMoney(confirmation.fundingEstimateUsdc)} USDC`} />
              <Line label="Slippage" value={`${formatMoneyCompact(confirmation.slippageCostUsdc)} USDC`} />
              <Line label="Break-even" value={`${formatPrice(confirmation.breakEvenPrice)} · ${formatPctAbs(confirmation.breakEvenMovePct)}`} />
              <Line label="Liquidacion" value={confirmation.liquidationPrice ? formatPrice(confirmation.liquidationPrice) : "No disponible"} />
              {confirmation.scenarios.map((scenario) => (
                <Line key={scenario.movePct} label={`Beneficio estimado ${signedMoveLabel(scenario.movePct)}`} value={`${formatSignedMoney(scenario.netPnl)} USDC`} />
              ))}
            </div>

            {!trading.eligibility.allowed && (
              <div className="card danger" role="alert">
                <strong>Envio bloqueado</strong>
                <div>{trading.eligibility.reason}</div>
              </div>
            )}

            <button
              className="button full-width trade-continue-button"
              type="button"
              disabled={!trading.eligibility.allowed || trading.submitting}
              onClick={() => void handleConfirmInWallet()}
            >
              {trading.submitting ? "Enviando..." : "CONFIRMAR OPERACION"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function buildLeverageQuickOptions(asset?: TradeAssetQuote): string[] {
  const defaults = [1, 2, 5, 10, 20, 25];
  const max = asset?.maxLeverage ?? 1;
  return defaults.filter((value) => value <= max).map(String);
}

function resolveAvailableUsdc(snapshot?: HyperliquidSnapshot): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  if (snapshot.accountIdentity.mode === "unifiedAccount" || snapshot.accountIdentity.mode === "portfolioMargin") {
    const usdcBalance = snapshot.spotClearinghouseState.balances.find((balance) => balance.coin === "USDC");
    return usdcBalance?.total;
  }

  return snapshot.clearinghouseState.withdrawable;
}

function formatPrice(value: string | undefined): string {
  if (!value) {
    return "N/D";
  }
  return `${formatMoneyCompact(value, dec(value).gte(1000) ? 2 : 4)} US$`;
}

function formatMoneyCompact(value: string, digits = 2): string {
  const decimal = dec(value);
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(Number(decimal.toFixed(digits)));
}

function formatSignedMoney(value: string): string {
  const decimal = dec(value);
  const prefix = decimal.gt(0) ? "+" : "";
  return `${prefix}${formatMoneyCompact(decimal.toString(), 2)}`;
}

function formatPct(value: string | undefined): string {
  if (!value) {
    return "24h N/D";
  }
  const decimal = dec(value);
  const prefix = decimal.gt(0) ? "+" : "";
  return `${prefix}${formatNumber(decimal, 2)} %`;
}

function formatPctAbs(value: string): string {
  return `${formatNumber(dec(value).abs(), 3)} %`;
}

function formatRate(value: string | undefined): string {
  if (!value) {
    return "N/D";
  }
  const decimal = dec(value).mul(100);
  const prefix = decimal.gt(0) ? "+" : "";
  return `${prefix}${formatNumber(decimal, 4)} %`;
}

function signedMoveLabel(value: string): string {
  const decimal = dec(value);
  const prefix = decimal.gt(0) ? "+" : "";
  return `${prefix}${formatNumber(decimal, 2)}%`;
}

function classNameForChange(value: string | undefined): string {
  if (!value) {
    return "subtle";
  }
  return dec(value).gt(0) ? "success" : dec(value).lt(0) ? "danger" : "subtle";
}

function statusColor(status: string): "red" | "orange" | "green" | "gray" {
  if (status === "ejecutada" || status === "aceptada") {
    return "green";
  }
  if (status === "pendiente" || status === "parcial") {
    return "orange";
  }
  if (status === "cancelada") {
    return "gray";
  }
  return "red";
}

function shortAddress(address: string): string {
  return address.length >= 10 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function TradeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="trade-metric-card">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OutcomeBadge({ label, color }: { label: string; color: "red" | "orange" | "green" | "gray" }) {
  return <span className={`profit-state profit-${color}`}>{label}</span>;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="line">
      <span>{label}</span>
      <strong className="mono">{value}</strong>
    </div>
  );
}
