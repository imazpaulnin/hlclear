import { useEffect, useMemo, useRef, useState } from "react";
import type { HyperliquidSnapshot } from "../domain/types";
import type { Eip1193Provider } from "../wallet/types";
import {
  cancelAllOrders,
  cancelSingleOrder,
  createTestnetTradingClients,
  fetchInitialTradingSnapshot,
  getExecutionEligibility,
  normalizeTradingError,
  submitPreparedTrade,
  subscribeToTradingState,
  closePosition
} from "./testnetTradingService";
import type {
  ExecutionEligibility,
  LivePosition,
  MarginMode,
  PositionCloseInput,
  SubmitPreparedTradeInput,
  SubmittedOrderStatus,
  TradingEnvironment,
  TradingSnapshot
} from "./types";

const EMPTY_SNAPSHOT: TradingSnapshot = {
  positions: [],
  openOrders: [],
  fills: [],
  fundingSinceSession: "0",
  connection: "idle"
};

export function useTestnetTrading(args: {
  provider: Eip1193Provider | null;
  walletAddress?: string;
  auditAddress: string;
  auditAddressMatches: boolean | undefined;
  snapshot?: HyperliquidSnapshot;
}) {
  const [tradingEnvironment, setTradingEnvironment] = useState<TradingEnvironment>("testnet");
  const [liveSnapshot, setLiveSnapshot] = useState<TradingSnapshot>(EMPTY_SNAPSHOT);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const bundleRef = useRef<ReturnType<typeof createTestnetTradingClients> | null>(null);
  const subscriptionRef = useRef<{ close: () => void } | null>(null);

  const eligibility = useMemo<ExecutionEligibility>(
    () =>
      getExecutionEligibility({
        tradingEnvironment,
        walletAddress: args.walletAddress,
        auditAddress: args.auditAddress,
        auditAddressMatches: args.auditAddressMatches
      }),
    [args.auditAddress, args.auditAddressMatches, args.walletAddress, tradingEnvironment]
  );

  useEffect(() => {
    if (!args.provider || !args.walletAddress || !eligibility.allowed || tradingEnvironment !== "testnet") {
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      bundleRef.current?.wsTransport.close();
      bundleRef.current = null;
      setLiveSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    let cancelled = false;

    async function connect() {
      try {
        setLiveSnapshot((current) => ({
          ...current,
          connection: "connecting",
          connectionMessage: undefined
        }));

        const bundle = createTestnetTradingClients(args.provider!);
        bundleRef.current = bundle;

        const initialState = await fetchInitialTradingSnapshot(bundle, args.walletAddress!);
        if (cancelled) {
          bundle.wsTransport.close();
          return;
        }
        setLiveSnapshot(initialState);

        const subscription = await subscribeToTradingState(bundle, args.walletAddress!, (patch) => {
          if (typeof patch === "function") {
            setLiveSnapshot((current) => patch(current));
            return;
          }
          setLiveSnapshot((current) => ({
            ...current,
            ...patch
          }));
        });
        subscriptionRef.current = subscription;
      } catch (error) {
        setLiveSnapshot({
          ...EMPTY_SNAPSHOT,
          connection: "error",
          connectionMessage: normalizeTradingError(error)
        });
      }
    }

    void connect();

    return () => {
      cancelled = true;
      subscriptionRef.current?.close();
      subscriptionRef.current = null;
      bundleRef.current?.wsTransport.close();
      bundleRef.current = null;
    };
  }, [args.provider, args.walletAddress, eligibility.allowed, tradingEnvironment]);

  async function submit(input: SubmitPreparedTradeInput) {
    if (!bundleRef.current) {
      setActionError("La conexion Testnet de trading no esta lista todavia.");
      return undefined;
    }

    try {
      setSubmitting(true);
      setActionError(undefined);
      const result = await submitPreparedTrade(bundleRef.current, input);
      setLiveSnapshot((current) => ({
        ...current,
        latestOrderStatus: result
      }));
      return result;
    } catch (error) {
      const message = normalizeTradingError(error);
      setActionError(message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelOrder(assetIndex: number, orderId: number) {
    if (!bundleRef.current) {
      setActionError("La conexion Testnet de trading no esta lista todavia.");
      return undefined;
    }

    try {
      setSubmitting(true);
      setActionError(undefined);
      const result = await cancelSingleOrder(bundleRef.current, assetIndex, orderId);
      setLiveSnapshot((current) => ({
        ...current,
        latestOrderStatus: result
      }));
      return result;
    } catch (error) {
      const message = normalizeTradingError(error);
      setActionError(message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelAll() {
    if (!bundleRef.current || !args.snapshot) {
      setActionError("La conexion Testnet de trading no esta lista todavia.");
      return undefined;
    }

    try {
      setSubmitting(true);
      setActionError(undefined);
      const result = await cancelAllOrders(bundleRef.current, liveSnapshot, args.snapshot.universe);
      setLiveSnapshot((current) => ({
        ...current,
        latestOrderStatus: result
      }));
      return result;
    } catch (error) {
      const message = normalizeTradingError(error);
      setActionError(message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  async function closeOpenPosition(position: LivePosition, input: PositionCloseInput) {
    if (!bundleRef.current) {
      setActionError("La conexion Testnet de trading no esta lista todavia.");
      return undefined;
    }

    try {
      setSubmitting(true);
      setActionError(undefined);
      const assetMeta = args.snapshot?.universe.find((asset) => asset.name === position.coin);
      const result = await closePosition(bundleRef.current, position, input, assetMeta?.szDecimals ?? 3);
      setLiveSnapshot((current) => ({
        ...current,
        latestOrderStatus: result
      }));
      return result;
    } catch (error) {
      const message = normalizeTradingError(error);
      setActionError(message);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }

  function consumeLatestOrderStatus(): SubmittedOrderStatus | undefined {
    const status = liveSnapshot.latestOrderStatus;
    setLiveSnapshot((current) => ({
      ...current,
      latestOrderStatus: undefined
    }));
    return status;
  }

  return {
    tradingEnvironment,
    setTradingEnvironment,
    eligibility,
    liveSnapshot,
    submitting,
    actionError,
    setActionError,
    submit,
    cancelOrder,
    cancelAll,
    closeOpenPosition,
    consumeLatestOrderStatus
  };
}
