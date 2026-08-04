import { useEffect, useMemo, useRef, useState } from "react";
import {
  createConnector,
  getWalletConnectDiagnosticsSnapshot,
  prepareWalletConnectConnector,
  resetWalletConnectConnector,
  resetWalletConnectStorageAndConnector,
  type WalletConnector
} from "./connectors";
import { shouldPreferWalletConnect } from "./walletEnvironment";
import { discoverInjectedWallets } from "./injectedWallets";
import type { ConnectedWalletSession, Eip1193Provider, WalletControllerState, WalletOption } from "./types";
import {
  REOWN_APPKIT_VERSION,
  WALLETCONNECT_CORE_VERSION,
  WALLETCONNECT_RELAY_URL,
  WALLETCONNECT_SESSION_CAIP,
  hasWalletConnectProjectId,
  getWalletConnectProjectId,
  maskWalletConnectProjectId
} from "./walletConfig";
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
  resetWalletConnectState: () => Promise<void>;
};

export function useWalletConnection(auditAddress: string): UseWalletConnectionResult {
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>(() => [buildWalletConnectOption()]);
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
    let mounted = true;

    async function loadWallets() {
      const injectedWallets = await discoverInjectedWallets();
      const wallets = mergeWalletOptions(injectedWallets);
      const preferred = pickPreferredWallet(wallets);
      const nextWallets = wallets.map((wallet) => ({
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

  useEffect(() => {
    if (!hasWalletConnectProjectId()) {
      return;
    }

    appendDebugLog("Se prepara WalletConnect en segundo plano para iPhone Safari.");
    void prepareWalletConnectConnector((message) => appendDebugLog(message)).catch((error) => {
      appendDebugLog(`Error al preparar WalletConnect: ${formatErrorForDebug(error)}`);
    });
  }, []);

  useEffect(() => () => {
    detachListenersRef.current?.();
  }, []);

  async function connectWith(walletId: WalletOption["id"]) {
    const wallet = mergeWalletOptions(availableWallets).find((option) => option.id === walletId && option.available);
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
      appendDebugLog(`Conexion completada con ${wallet.name}.`);
    } catch (error) {
      appendDebugLog(`Fallo de conexion: ${formatErrorForDebug(error)}`);
      if (wallet.id === "walletconnect") {
        await resetWalletConnectConnector("fallo visible en pantalla");
      }
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "No se pudo conectar la wallet."
      }));
    }
  }

  async function connect() {
    const wallets = mergeWalletOptions(availableWallets);
    const walletConnect = wallets.find((option) => option.id === "walletconnect" && option.available);

    if (shouldPreferWalletConnect() && walletConnect) {
      appendDebugLog("Safari iPhone detectado. Se prioriza WalletConnect.");
      await connectWith("walletconnect");
      return;
    }

    const preferred = pickPreferredWallet(wallets);
    if (preferred) {
      await connectWith(preferred.id);
      return;
    }

    if (walletConnect) {
      appendDebugLog("No hay wallet inyectada utilizable. Se abre WalletConnect igualmente.");
      await connectWith("walletconnect");
      return;
    }

    setState((current) => ({
      ...current,
      status: "error",
      error: hasWalletConnectProjectId()
        ? "No se pudo abrir ninguna wallet. Prueba con WalletConnect desde este boton."
        : "Falta configurar WalletConnect en produccion para poder abrir el selector oficial."
    }));
    appendDebugLog("No hay ninguna ruta de conexion disponible.");
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
      setState((current) => ({
        status: "disconnected",
        networkLabel: "Sin red"
      }));
    }
  }

  async function resetWalletConnectState() {
    appendDebugLog("Se restablece el estado local de WalletConnect.");
    await resetWalletConnectStorageAndConnector();
    connectorRef.current = null;
    connectedProviderRef.current = null;
    detachListenersRef.current?.();
    detachListenersRef.current = null;
    setState({
      status: "disconnected",
      networkLabel: "Sin red"
    });
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
  }

  const auditAddressMatches = useMemo(() => {
    if (state.status !== "connected") {
      return undefined;
    }

    return addressesMatch(state.address, auditAddress);
  }, [auditAddress, state.address, state.status]);

  const mismatchWarning = useMemo(() => {
    if (state.status !== "connected") {
      return undefined;
    }

    if (!auditAddress) {
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
      ...getWalletConnectDiagnosticsSnapshot(),
      logs: debugLogs
    },
    connect,
    connectWith,
    disconnect,
    resetWalletConnectState
  };
}

function buildWalletConnectOption(): WalletOption {
  return {
    id: "walletconnect",
    name: "WalletConnect",
    source: "walletconnect",
    available: hasWalletConnectProjectId(),
    preferred: false,
    reasonUnavailable: hasWalletConnectProjectId()
      ? undefined
      : "Falta configurar VITE_WALLETCONNECT_PROJECT_ID en el entorno publicado de GitHub Pages."
  };
}

function mergeWalletOptions(options: WalletOption[]): WalletOption[] {
  const byKey = new Map<string, WalletOption>();

  [...options, buildWalletConnectOption()].forEach((option) => {
    byKey.set(`${option.id}:${option.source}:${option.rdns ?? option.name}`, option);
  });

  return [...byKey.values()];
}

function formatDebugTimestamp(): string {
  return new Date().toLocaleTimeString("es-ES", { hour12: false });
}

function buildInitialDebugLogs(): string[] {
  const projectId = getWalletConnectProjectId();

  return [
    `${formatDebugTimestamp()} Version Reown AppKit: ${REOWN_APPKIT_VERSION}`,
    `${formatDebugTimestamp()} Version WalletConnect: ${WALLETCONNECT_CORE_VERSION}`,
    `${formatDebugTimestamp()} WalletConnect projectId: ${maskWalletConnectProjectId(projectId)}`,
    `${formatDebugTimestamp()} Relay: ${WALLETCONNECT_RELAY_URL}`,
    `${formatDebugTimestamp()} Chain solicitada: ${WALLETCONNECT_SESSION_CAIP}`,
    `${formatDebugTimestamp()} Estado inicial: ${hasWalletConnectProjectId() ? "projectId disponible" : "projectId ausente"}`
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
