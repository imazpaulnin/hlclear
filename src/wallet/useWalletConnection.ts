import { useEffect, useMemo, useRef, useState } from "react";
import { createConnector, type WalletConnector } from "./connectors";
import { discoverInjectedWallets } from "./injectedWallets";
import type { ConnectedWalletSession, Eip1193Provider, WalletControllerState, WalletOption } from "./types";
import { hasWalletConnectProjectId } from "./walletConfig";
import { addressesMatch, formatWalletNetwork, pickPreferredWallet } from "./walletUtils";

type UseWalletConnectionResult = {
  state: WalletControllerState;
  availableWallets: WalletOption[];
  auditAddressMatches: boolean | undefined;
  mismatchWarning: string | undefined;
  connect: () => Promise<void>;
  connectWith: (walletId: WalletOption["id"]) => Promise<void>;
  disconnect: () => Promise<void>;
};

export function useWalletConnection(auditAddress: string): UseWalletConnectionResult {
  const [availableWallets, setAvailableWallets] = useState<WalletOption[]>([]);
  const [state, setState] = useState<WalletControllerState>({
    status: "disconnected",
    networkLabel: "Sin red"
  });
  const connectorRef = useRef<WalletConnector | null>(null);
  const connectedProviderRef = useRef<Eip1193Provider | null>(null);
  const detachListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadWallets() {
      const injectedWallets = await discoverInjectedWallets();
      const wallets = [...injectedWallets];

      wallets.push({
        id: "walletconnect",
        name: "WalletConnect",
        source: "walletconnect",
        available: hasWalletConnectProjectId(),
        preferred: false,
        reasonUnavailable: hasWalletConnectProjectId() ? undefined : "Falta configurar VITE_WALLETCONNECT_PROJECT_ID para despliegue."
      });

      const preferred = pickPreferredWallet(wallets);
      const nextWallets = wallets.map((wallet) => ({
        ...wallet,
        preferred: preferred?.id === wallet.id && preferred.source === wallet.source
      }));

      if (mounted) {
        setAvailableWallets(nextWallets);
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
      const connector = createConnector(wallet);
      const session = await connector.connect();
      connectorRef.current = connector;
      attachProviderListeners(session.provider, wallet, connector);
      applyConnectedSession(session);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "No se pudo conectar la wallet."
      }));
    }
  }

  async function connect() {
    const preferred = pickPreferredWallet(availableWallets);
    if (!preferred) {
      setState((current) => ({
        ...current,
        status: "error",
        error: "No se detecto ninguna wallet compatible."
      }));
      return;
    }

    await connectWith(preferred.id);
  }

  async function disconnect() {
    detachListenersRef.current?.();
    detachListenersRef.current = null;
    connectedProviderRef.current = null;

    try {
      await connectorRef.current?.disconnect();
    } finally {
      connectorRef.current = null;
      setState({
        status: "disconnected",
        networkLabel: "Sin red"
      });
    }
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
    connect,
    connectWith,
    disconnect
  };
}
