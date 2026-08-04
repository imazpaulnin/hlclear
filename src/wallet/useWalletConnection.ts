import { useEffect, useMemo, useRef, useState } from "react";
import { createConnector, resetLegacyWalletState, runLegacyWalletSchemaMigration, type WalletConnector } from "./connectors";
import { discoverInjectedWallets } from "./injectedWallets";
import type { ConnectedWalletSession, Eip1193Provider, WalletControllerState, WalletOption } from "./types";
import { isIosSafari } from "./walletEnvironment";
import { addressesMatch, formatWalletNetwork, pickPreferredWallet } from "./walletUtils";

type UseWalletConnectionResult = {
  state: WalletControllerState;
  availableWallets: WalletOption[];
  auditAddressMatches: boolean | undefined;
  mismatchWarning: string | undefined;
  connectedProvider: Eip1193Provider | null;
  debugLogs: string[];
  debugReport: unknown;
  connect: () => Promise<void>;
  connectWith: (walletId: WalletOption["id"]) => Promise<void>;
  disconnect: () => Promise<void>;
  resetWalletState: () => Promise<void>;
};

export function useWalletConnection(auditAddress: string): UseWalletConnectionResult {
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>([]);
  const [debugLogs, setDebugLogs] = useState<string[]>(() => buildInitialDebugLogs());
  const [state, setState] = useState<WalletControllerState>({
    status: "disconnected",
    networkLabel: "Sin red"
  });
  const connectorRef = useRef<WalletConnector | null>(null);
  const connectedProviderRef = useRef<Eip1193Provider | null>(null);
  const detachListenersRef = useRef<(() => void) | null>(null);

  function appendDebugLog(message: string) {
    setDebugLogs((current) => [...current.slice(-199), `${formatDebugTimestamp()} ${message}`]);
  }

  useEffect(() => {
    runLegacyWalletSchemaMigration();
    appendDebugLog("Migracion de almacenamiento legacy completada.");
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWallets() {
      const injectedWallets = await discoverInjectedWallets();
      const preferred = pickPreferredWallet(injectedWallets);
      const nextWallets = injectedWallets.map((wallet) => ({
        ...wallet,
        preferred: preferred?.id === wallet.id && preferred.source === wallet.source
      }));

      if (mounted) {
        setAvailableWallets(nextWallets);
        appendDebugLog(`Wallets detectadas: ${nextWallets.map((wallet) => wallet.name).join(", ") || "ninguna"}`);
      }
    }

    void loadWallets();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => () => {
    detachListenersRef.current?.();
  }, []);

  async function connectWith(walletId: WalletOption["id"]) {
    const wallet = availableWallets.find((option) => option.id === walletId && option.available);
    if (!wallet) {
      setState((current) => ({
        ...current,
        status: "error",
        error: "La wallet seleccionada no esta disponible en este navegador."
      }));
      return;
    }

    setState((current) => ({
      ...current,
      status: "connecting",
      error: undefined
    }));

    try {
      appendDebugLog(`Se inicia la conexion con ${wallet.name}.`);
      const connector = createConnector(wallet, (message) => appendDebugLog(message));
      const session = await connector.connect();
      connectorRef.current = connector;
      attachProviderListeners(session.provider, wallet, connector);
      applyConnectedSession(session);
    } catch (error) {
      appendDebugLog(`Fallo de conexion: ${formatErrorForDebug(error)}`);
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "No se pudo conectar la wallet."
      }));
    }
  }

  async function connect() {
    const preferred = pickPreferredWallet(availableWallets);
    if (preferred) {
      await connectWith(preferred.id);
      return;
    }

    const browserHint = isIosSafari()
      ? "En iPhone abre HLClear dentro del navegador de Rabby o MetaMask para que la wallet se inyecte."
      : "Abre la app en un navegador donde Rabby o MetaMask esten instaladas y expuestas.";

    appendDebugLog(`No se detecto ninguna wallet compatible. ${browserHint}`);
    setState((current) => ({
      ...current,
      status: "error",
      error: `No se detecto ninguna wallet compatible. ${browserHint}`
    }));
  }

  async function disconnect() {
    detachListenersRef.current?.();
    detachListenersRef.current = null;
    connectedProviderRef.current = null;

    try {
      await connectorRef.current?.disconnect();
      appendDebugLog("Wallet desconectada.");
    } finally {
      connectorRef.current = null;
      setState({
        status: "disconnected",
        networkLabel: "Sin red"
      });
    }
  }

  async function resetWalletState() {
    appendDebugLog("Se limpian sesiones legacy de wallet.");
    await resetLegacyWalletState();
    await disconnect();
  }

  function attachProviderListeners(provider: Eip1193Provider, wallet: WalletOption, connector: WalletConnector) {
    detachListenersRef.current?.();
    connectedProviderRef.current = provider;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      const nextAddress = accounts[0];

      if (!nextAddress) {
        void disconnect();
        return;
      }

      setState((current) => ({
        ...current,
        status: "connected",
        connectorId: wallet.id,
        connectorName: wallet.name,
        source: connector.source,
        address: nextAddress
      }));
    };

    const handleChainChanged = (...args: unknown[]) => {
      const nextChainId = typeof args[0] === "string" ? args[0] : undefined;
      if (!nextChainId) {
        return;
      }

      setState((current) => ({
        ...current,
        chainId: nextChainId,
        networkLabel: formatWalletNetwork(nextChainId)
      }));
    };

    const handleDisconnect = () => {
      void disconnect();
    };

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);
    provider.on?.("disconnect", handleDisconnect);

    detachListenersRef.current = () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }

  function applyConnectedSession(session: ConnectedWalletSession) {
    setState({
      status: "connected",
      connectorId: session.connectorId,
      connectorName: session.connectorName,
      source: session.source,
      address: session.address,
      chainId: session.chainId,
      networkLabel: formatWalletNetwork(session.chainId)
    });
    appendDebugLog(`Conexion completada con ${session.connectorName}.`);
  }

  const auditAddressMatches = useMemo(() => {
    if (state.status !== "connected") {
      return undefined;
    }

    return addressesMatch(state.address, auditAddress);
  }, [auditAddress, state.address, state.status]);

  const mismatchWarning = useMemo(() => {
    if (state.status !== "connected" || !auditAddress) {
      return undefined;
    }

    return auditAddressMatches
      ? undefined
      : "La wallet conectada no coincide con la direccion publica que estas auditando.";
  }, [auditAddress, auditAddressMatches, state.status]);

  return {
    state,
    availableWallets,
    auditAddressMatches,
    mismatchWarning,
    connectedProvider: connectedProviderRef.current,
    debugLogs,
    debugReport: {
      environment: {
        origin: window.location.origin,
        href: window.location.href,
        iosSafari: isIosSafari()
      },
      wallets: availableWallets,
      state,
      logs: debugLogs
    },
    connect,
    connectWith,
    disconnect,
    resetWalletState
  };
}

function formatDebugTimestamp(): string {
  return new Date().toLocaleTimeString("es-ES", { hour12: false });
}

function buildInitialDebugLogs(): string[] {
  return [
    `${formatDebugTimestamp()} Origen: ${window.location.origin}`,
    `${formatDebugTimestamp()} URL: ${window.location.href}`,
    `${formatDebugTimestamp()} iPhone Safari: ${isIosSafari() ? "si" : "no"}`,
    `${formatDebugTimestamp()} Modo de conexion: wallet inyectada`
  ];
}

function formatErrorForDebug(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify(
      {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause,
        code: (error as Error & { code?: unknown }).code
      },
      null,
      2
    );
  }

  return JSON.stringify(error, null, 2);
}
