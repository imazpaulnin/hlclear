import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildWalletConnectOption,
  createConnector,
  resetLegacyWalletState,
  runLegacyWalletSchemaMigration,
  type WalletConnector
} from "./connectors";
import { discoverInjectedWallets } from "./injectedWallets";
import type { ConnectedWalletSession, Eip1193Provider, WalletControllerState, WalletOption } from "./types";
import { isIosSafari, isIosStandaloneWebApp } from "./walletEnvironment";
import {
  buildMetaMaskWalletConnectUrl,
  buildRabbyWalletConnectUrl,
  getWalletConnectCanonicalUrl,
  getWalletConnectOrigin,
  getWalletConnectProjectId,
  getWalletConnectRpcMap,
  getWalletMetadata,
  maskWalletConnectProjectId,
  validateWalletConnectProjectId
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
  resetWalletState: () => Promise<void>;
  openWalletConnectInRabby: () => void;
  openWalletConnectInMetaMask: () => void;
  copyWalletConnectUri: () => Promise<void>;
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
    runLegacyWalletSchemaMigration();
    appendDebugLog("Migracion de almacenamiento legacy completada.");
  }, []);

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

  useEffect(() => () => {
    detachListenersRef.current?.();
  }, []);

  async function connectWith(walletId: WalletOption["id"]) {
    if (walletId === "walletconnect" && isIosStandaloneWebApp()) {
      const message = buildIosStandaloneWalletMessage();
      appendDebugLog(`Conexion bloqueada en web app iPhone: ${message}`);
      setState((current) => ({
      ...current,
      status: "error",
      error: message,
      walletConnectUri: undefined
    }));
      return;
    }

    const wallet = availableWallets.find((option) => option.id === walletId && option.available);
    if (!wallet) {
      setState((current) => ({
      ...current,
      status: "error",
      error: "La wallet seleccionada no esta disponible en este navegador.",
      walletConnectUri: undefined
    }));
      return;
    }

    setState((current) => ({
      ...current,
      status: "connecting",
      error: undefined,
      walletConnectUri: undefined
    }));

    try {
      appendDebugLog(`Se inicia la conexion con ${wallet.name}.`);
      const connector = createConnector(
        wallet,
        (message) => appendDebugLog(message),
        (uri) => {
          appendDebugLog("Se recibio una URI de WalletConnect.");
          setState((current) => ({
            ...current,
            walletConnectUri: uri
          }));
        }
      );
      const session = await connector.connect();
      connectorRef.current = connector;
      attachProviderListeners(session.provider, wallet, connector);
      applyConnectedSession(session);
    } catch (error) {
      appendDebugLog(`Fallo de conexion: ${formatErrorForDebug(error)}`);
      setState((current) => ({
        ...current,
        status: "error",
        error: describeConnectionError(error),
        walletConnectUri: undefined
      }));
    }
  }

  async function connect() {
    const wallets = mergeWalletOptions(availableWallets);
    const walletConnect = wallets.find((wallet) => wallet.id === "walletconnect" && wallet.available);
    const preferred = pickPreferredWallet(wallets);
    const hasInjectedWallet = wallets.some((wallet) => wallet.available && wallet.id !== "walletconnect");

    if (isIosStandaloneWebApp() && !hasInjectedWallet) {
      const message = buildIosStandaloneWalletMessage();
      appendDebugLog(`La web app instalada de iPhone no expone una wallet inyectada. ${message}`);
      setState((current) => ({
        ...current,
        status: "error",
        error: message,
        walletConnectUri: undefined
      }));
      return;
    }

    if (isIosSafari() && walletConnect) {
      appendDebugLog("Safari iPhone detectado. Se prioriza WalletConnect para Safari/PWA.");
      await connectWith("walletconnect");
      return;
    }

    if (preferred) {
      await connectWith(preferred.id);
      return;
    }

    if (walletConnect) {
      appendDebugLog("No hay wallet inyectada utilizable. Se abre WalletConnect.");
      await connectWith("walletconnect");
      return;
    }

    const browserHint = isIosSafari()
      ? "No hay wallet inyectada y WalletConnect no esta disponible. Abre HLClear dentro de Rabby o MetaMask."
      : "Abre la app en un navegador donde Rabby o MetaMask esten instaladas o configura WalletConnect.";

    appendDebugLog(`No se detecto ninguna wallet compatible. ${browserHint}`);
    setState((current) => ({
      ...current,
      status: "error",
      error: `No se detecto ninguna wallet compatible. ${browserHint}`,
      walletConnectUri: undefined
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
      networkLabel: formatWalletNetwork(session.chainId),
      walletConnectUri: undefined
    });
    appendDebugLog(`Conexion completada con ${session.connectorName}.`);
  }

  function openWalletConnectInRabby() {
    const uri = state.walletConnectUri;
    if (!uri) {
      return;
    }

    appendDebugLog("Se abre Rabby con la URI de WalletConnect.");
    window.location.assign(buildRabbyWalletConnectUrl(uri));
  }

  function openWalletConnectInMetaMask() {
    const uri = state.walletConnectUri;
    if (!uri) {
      return;
    }

    appendDebugLog("Se abre MetaMask con la URI de WalletConnect.");
    window.location.assign(buildMetaMaskWalletConnectUrl(uri));
  }

  async function copyWalletConnectUri() {
    const uri = state.walletConnectUri;
    if (!uri) {
      return;
    }

    await navigator.clipboard.writeText(uri);
    appendDebugLog("Se copio la URI de WalletConnect al portapapeles.");
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
        iosSafari: isIosSafari(),
        iosStandaloneWebApp: isIosStandaloneWebApp()
      },
      wallets: availableWallets,
      walletConnect: {
        configured: Boolean(getWalletConnectProjectId()),
        projectId: maskWalletConnectProjectId(getWalletConnectProjectId()),
        validation: validateWalletConnectProjectId(getWalletConnectProjectId()),
        origin: getWalletConnectOrigin(),
        canonicalUrl: getWalletConnectCanonicalUrl(),
        metadata: getWalletMetadata(),
        rpcMap: getWalletConnectRpcMap(),
        diagnosis: buildWalletConnectDiagnosis()
      },
      state,
      logs: debugLogs
    },
    connect,
    connectWith,
    disconnect,
    resetWalletState,
    openWalletConnectInRabby,
    openWalletConnectInMetaMask,
    copyWalletConnectUri
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
    `${formatDebugTimestamp()} Web app instalada: ${isIosStandaloneWebApp() ? "si" : "no"}`,
    `${formatDebugTimestamp()} WalletConnect projectId: ${maskWalletConnectProjectId(getWalletConnectProjectId())}`,
    `${formatDebugTimestamp()} WalletConnect canonicalUrl: ${getWalletConnectCanonicalUrl()}`,
    `${formatDebugTimestamp()} Modo de conexion: wallet inyectada + WalletConnect`
  ];
}

function mergeWalletOptions(options: WalletOption[]): WalletOption[] {
  const byKey = new Map<string, WalletOption>();

  [...options, buildWalletConnectOption()].forEach((option) => {
    byKey.set(`${option.id}:${option.source}:${option.rdns ?? option.name}`, option);
  });

  return [...byKey.values()];
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

function describeConnectionError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "No se pudo conectar la wallet.";
  }

  const message = error.message || "No se pudo conectar la wallet.";

  if (/Failed to publish custom payload/i.test(message)) {
    return [
      "WalletConnect no pudo publicar la solicitud al relay.",
      `Origen publicado: ${getWalletConnectOrigin() || "desconocido"}.`,
      "Esto suele indicar un problema de dominio permitido en Reown Cloud, de acceso al relay desde la red del iPhone, o de una sesion WalletConnect corrupta.",
      "No es un problema de allowlist por IP: Reown valida origen/aplicacion, no IP cliente."
    ].join(" ");
  }

  return message;
}

function buildWalletConnectDiagnosis() {
  return {
    likelyCauses: [
      "El hostname publicado no esta incluido exactamente en Project Domains de Reown Cloud.",
      "El relay de WalletConnect esta bloqueado por la red, VPN, iCloud Private Relay o un filtro del dispositivo.",
      "Existe una sesion WalletConnect antigua o corrupta en almacenamiento local."
    ],
    notLikelyCause: "Reown no requiere allowlist de IP para AppKit/Ethereum Provider cliente.",
    nextChecks: [
      "Verificar Project Domains en Reown Cloud con el hostname exacto imazpaulnin.github.io.",
      "Esperar hasta 15 minutos despues de cambiar la allowlist de dominios.",
      "Probar la PWA desde otra red o con iCloud Private Relay/VPN desactivados.",
      "Usar el boton Limpiar estado de conexion y reintentar."
    ]
  };
}

function buildIosStandaloneWalletMessage(): string {
  return [
    "La web app instalada de iPhone no esta exponiendo Rabby dentro de este contenedor.",
    "Abre HLClear en Safari para conectar la wallet o vuelve a anadir el icono al inicio con 'Abrir como app web' desactivado."
  ].join(" ");
}
