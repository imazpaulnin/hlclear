import type { ConnectedWalletSession, Eip1193Provider, WalletConnectorId, WalletOption } from "./types";
import { UniversalConnector, type UniversalConnectorConfig } from "@reown/appkit-universal-connector";
import type { CustomCaipNetwork } from "@reown/appkit-common";
import {
  HYPERLIQUID_TESTNET_CAIP,
  HYPERLIQUID_TESTNET_CHAIN_HEX,
  HYPERLIQUID_TESTNET_CHAIN_ID,
  REOWN_APPKIT_VERSION,
  WALLETCONNECT_CORE_VERSION,
  WALLETCONNECT_RELAY_URL,
  getWalletConnectProjectId,
  getWalletConnectRedirectConfig,
  getWalletConnectLocation,
  getWalletMetadata,
  maskWalletConnectProjectId,
  validateWalletConnectProjectId
} from "./walletConfig";
import { parseWalletConnectAccount } from "./walletUtils";

type WalletDebugLogger = (message: string) => void;

type WalletConnectSessionEnvelope = Awaited<ReturnType<UniversalConnector["connect"]>>;
type WalletConnectSession = WalletConnectSessionEnvelope["session"];
type WalletConnectEventEntry = {
  at: string;
  event: string;
  payload: unknown;
};

type WalletConnectDiagnosticsSnapshot = {
  sdkVersions: {
    walletConnect: string;
    reown: string;
  };
  projectId: {
    masked: string;
    validation: ReturnType<typeof validateWalletConnectProjectId>;
  };
  relayUrl: string;
  metadata: ReturnType<typeof getWalletMetadata>;
  redirect: ReturnType<typeof getWalletConnectRedirectConfig>;
  location: ReturnType<typeof getWalletConnectLocation>;
  chainId: {
    caip: string;
    hex: string;
    numeric: number;
  };
  requiredNamespaces: ReturnType<typeof buildWalletConnectNamespaces>;
  optionalNamespaces: Record<string, unknown> | null;
  connectPayload: {
    requiredNamespaces: ReturnType<typeof buildWalletConnectNamespaces>;
    optionalNamespaces: Record<string, unknown> | null;
  };
  initializationState: {
    initialized: boolean;
    lastKnownProviderState: unknown;
  };
  lastResponse: unknown;
  lastError: unknown;
  lastHttpResponse: unknown;
  lastRelayJson: unknown;
  events: WalletConnectEventEntry[];
};

export interface WalletConnector {
  readonly id: WalletConnectorId;
  readonly name: string;
  readonly source: WalletOption["source"];
  connect(): Promise<ConnectedWalletSession>;
  disconnect(): Promise<void>;
}

class InjectedWalletConnector implements WalletConnector {
  readonly id: WalletConnectorId;
  readonly name: string;
  readonly source: WalletOption["source"];
  private readonly provider: Eip1193Provider;

  constructor(option: WalletOption) {
    if (!option.provider) {
      throw new Error("Wallet inyectada no disponible.");
    }

    this.id = option.id;
    this.name = option.name;
    this.source = option.source;
    this.provider = option.provider;
  }

  async connect(): Promise<ConnectedWalletSession> {
    const accounts = (await this.provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    const chainId = (await this.provider.request({ method: "eth_chainId" })) as string;

    if (!address) {
      throw new Error("La wallet no devolvio ninguna direccion.");
    }

    return {
      connectorId: this.id,
      connectorName: this.name,
      source: this.source,
      address,
      chainId,
      provider: this.provider
    };
  }

  async disconnect(): Promise<void> {
    try {
      await this.provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }]
      });
    } catch {
      // Algunas wallets inyectadas no permiten revocar permisos desde la dapp.
    }
  }
}

class WalletConnectConnector implements WalletConnector {
  readonly id = "walletconnect" as const;
  readonly name = "WalletConnect";
  readonly source = "walletconnect" as const;
  private connector?: UniversalConnector;
  private readonly debug?: WalletDebugLogger;

  constructor(debug?: WalletDebugLogger) {
    this.debug = debug;
  }

  async connect(): Promise<ConnectedWalletSession> {
    try {
      const connector = await prepareWalletConnectConnector(this.debug);
      this.connector = connector;
      this.debug?.("WalletConnect inicializado. Se intentara abrir el modal oficial.");

      const existingSession = getExistingWalletConnectSession(connector);
      this.debug?.(`Estado antes de connect(): ${describeWalletConnectState(connector)}`);

      const session = existingSession && getPrimaryWalletConnectAccount(existingSession)
        ? existingSession
        : (await connectWalletConnectSession(connector)).session;

      if (existingSession && getPrimaryWalletConnectAccount(existingSession)) {
        this.debug?.("Se reutiliza una sesion WalletConnect ya restaurada.");
      }

      return await buildWalletConnectSession(connector, session);
    } catch (error) {
      this.debug?.(`WalletConnect devolvio una excepcion completa: ${formatWalletConnectError(error)}`);
      await resetWalletConnectConnector("error de connect()");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connector) {
      await this.connector.disconnect();
    }
    await resetWalletConnectConnector("disconnect()");
  }
}

export function createConnector(option: WalletOption, debug?: WalletDebugLogger): WalletConnector {
  if (option.id === "walletconnect") {
    return new WalletConnectConnector(debug);
  }

  return new InjectedWalletConnector(option);
}

let walletConnectConnectorPromise: Promise<UniversalConnector> | undefined;
let walletConnectConnectorInstance: UniversalConnector | undefined;
const walletConnectDebugLoggers = new Set<WalletDebugLogger>();
const walletConnectDiagnosticsState: {
  lastResponse: unknown;
  lastError: unknown;
  lastHttpResponse: unknown;
  lastRelayJson: unknown;
  events: WalletConnectEventEntry[];
  initialized: boolean;
  lastKnownProviderState: unknown;
} = {
  lastResponse: null,
  lastError: null,
  lastHttpResponse: null,
  lastRelayJson: null,
  events: [],
  initialized: false,
  lastKnownProviderState: null
};

export function prepareWalletConnectConnector(debug?: WalletDebugLogger): Promise<UniversalConnector> {
  registerWalletConnectDebugLogger(debug);

  if (!walletConnectConnectorPromise) {
    walletConnectConnectorPromise = initializeWalletConnectConnector(debug);
  } else {
    emitWalletConnectDebug("WalletConnect reutiliza la instancia ya preparada.");
  }

  return walletConnectConnectorPromise;
}

export async function resetWalletConnectConnector(reason: string): Promise<void> {
  emitWalletConnectDebug(`Se reinicia la instancia WalletConnect: ${reason}.`);

  const connector = walletConnectConnectorInstance;
  walletConnectConnectorPromise = undefined;
  walletConnectConnectorInstance = undefined;

  if (!connector) {
    return;
  }

  try {
    await connector.disconnect();
  } catch (error) {
    emitWalletConnectDebug(`Error al limpiar la sesion WalletConnect: ${formatWalletConnectError(error)}`);
  }
}

async function initializeWalletConnectConnector(debug?: WalletDebugLogger): Promise<UniversalConnector> {
  registerWalletConnectDebugLogger(debug);
  const projectId = getWalletConnectProjectId();
  const metadata = getWalletMetadata();
  const redirect = getWalletConnectRedirectConfig();
  const location = getWalletConnectLocation();
  const requiredNamespaces = buildWalletConnectNamespaces();
  const projectValidation = validateWalletConnectProjectId(projectId);

  emitWalletConnectDebug(`WalletConnect projectId cargado: ${projectId ? maskWalletConnectProjectId(projectId) : "no"}`);
  emitWalletConnectDebug(`Validacion Project ID: ${safeJsonStringify(projectValidation)}`);

  if (!projectId) {
    throw new Error("WalletConnect requiere VITE_WALLETCONNECT_PROJECT_ID en despliegue.");
  }

  if (!projectValidation.valid) {
    throw new Error(`WalletConnect Project ID invalido: ${projectValidation.reasons.join(" ")}`);
  }

  emitWalletConnectDebug(`Version Reown AppKit: ${REOWN_APPKIT_VERSION}`);
  emitWalletConnectDebug(`Version WalletConnect: ${WALLETCONNECT_CORE_VERSION}`);
  emitWalletConnectDebug(`Relay configurado: ${WALLETCONNECT_RELAY_URL}`);
  emitWalletConnectDebug(`Metadata completa: ${safeJsonStringify(metadata)}`);
  emitWalletConnectDebug(`Redirect configurado: ${safeJsonStringify(redirect)}`);
  emitWalletConnectDebug(`window.location: ${safeJsonStringify(location)}`);
  emitWalletConnectDebug(`Chain solicitada: ${HYPERLIQUID_TESTNET_CAIP} (${HYPERLIQUID_TESTNET_CHAIN_HEX})`);
  emitWalletConnectDebug(`requiredNamespaces: ${safeJsonStringify(requiredNamespaces)}`);
  emitWalletConnectDebug(`optionalNamespaces: ${safeJsonStringify(null)}`);
  emitWalletConnectDebug(`Payload exacto de connect(): ${safeJsonStringify({ requiredNamespaces, optionalNamespaces: null })}`);
  emitWalletConnectDebug("Inicializando WalletConnect...");

  const connector = await UniversalConnector.init({
    projectId,
    metadata,
    networks: [evmWalletConnectNamespace],
    providerConfig: {
      logger: import.meta.env.DEV ? "info" : "error",
      relayUrl: WALLETCONNECT_RELAY_URL
    }
  } satisfies UniversalConnectorConfig);

  walletConnectConnectorInstance = connector;
  attachWalletConnectDebugEvents(connector);
  walletConnectDiagnosticsState.initialized = true;
  walletConnectDiagnosticsState.lastKnownProviderState = describeWalletConnectState(connector);
  emitWalletConnectDebug(`Estado de inicializacion: ${safeJsonStringify(walletConnectDiagnosticsState.lastKnownProviderState)}`);

  const restoredSession = getExistingWalletConnectSession(connector);
  if (restoredSession) {
    emitWalletConnectDebug(`Sesion restaurada al iniciar: ${safeJsonStringify(restoredSession)}`);
  }

  return connector;
}

const hyperliquidTestnetNetwork: CustomCaipNetwork<"eip155"> = {
  id: HYPERLIQUID_TESTNET_CHAIN_ID,
  name: "Hyperliquid Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "Ether",
    symbol: "ETH"
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.hyperliquid-testnet.xyz/evm"]
    }
  },
  blockExplorers: {
    default: {
      name: "HyperEVM Testnet Explorer",
      url: "https://app.hyperliquid-testnet.xyz/explorer"
    }
  },
  chainNamespace: "eip155",
  caipNetworkId: HYPERLIQUID_TESTNET_CAIP
};

const evmWalletConnectNamespace: UniversalConnectorConfig["networks"][number] = {
  namespace: "eip155",
  methods: ["eth_sendTransaction", "eth_signTransaction", "eth_sign", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4"],
  events: ["accountsChanged", "chainChanged", "disconnect"],
  chains: [hyperliquidTestnetNetwork]
};

function registerWalletConnectDebugLogger(debug?: WalletDebugLogger) {
  if (debug) {
    walletConnectDebugLoggers.add(debug);
  }
}

function emitWalletConnectDebug(message: string) {
  walletConnectDebugLoggers.forEach((logger) => logger(message));
}

function buildWalletConnectNamespaces() {
  return {
    eip155: {
      methods: [...evmWalletConnectNamespace.methods],
      events: [...evmWalletConnectNamespace.events],
      chains: evmWalletConnectNamespace.chains.map((chain) => chain.caipNetworkId)
    }
  };
}

async function connectWalletConnectSession(connector: UniversalConnector): Promise<WalletConnectSessionEnvelope> {
  const requiredNamespaces = buildWalletConnectNamespaces();
  const appKit = getWalletConnectAppKit(connector);
  const provider = connector.provider as WalletConnectProviderInternals;
  const signClient = provider.client;

  if (!signClient) {
    throw new Error("WalletConnect SignClient no esta disponible.");
  }

  emitWalletConnectDebug("Se intenta abrir el modal oficial de WalletConnect.");
  await appKit?.open();

  try {
    const pendingConnection = await signClient.connect({
      requiredNamespaces
    });

    walletConnectDiagnosticsState.lastResponse = serializeUnknownError({
      uri: pendingConnection.uri,
      approval: pendingConnection.approval
    });

    emitWalletConnectDebug(`connect() devolvio uri: ${pendingConnection.uri ?? "sin uri"}`);
    emitWalletConnectDebug(`connect() devolvio approval(): ${safeJsonStringify({ available: typeof pendingConnection.approval === "function" })}`);

    if (pendingConnection.uri) {
      await appKit?.open({
        uri: pendingConnection.uri
      });
    }

    const session = await pendingConnection.approval();
    const response = { session };
    emitWalletConnectDebug(`Estado despues de connect(): ${describeWalletConnectState(connector)}`);
    emitWalletConnectDebug(`Respuesta completa de WalletConnect: ${safeJsonStringify(response)}`);
    await appKit?.close();

    return response;
  } catch (error) {
    await appKit?.close();
    throw error;
  }
}

async function buildWalletConnectSession(
  connector: UniversalConnector,
  session: WalletConnectSession
): Promise<ConnectedWalletSession> {
  const account = getPrimaryWalletConnectAccount(session);
  const parsed = account ? parseWalletConnectAccount(account) : undefined;

  if (!parsed) {
    throw new Error("WalletConnect no devolvio una cuenta EVM compatible.");
  }

  const currentCaipChain = `eip155:${Number.parseInt(parsed.chainId, 16)}`;
  const bridgeProvider: Eip1193Provider = {
    request: (args) => connector.request(args, currentCaipChain),
    on: (event, listener) => connector.provider.on?.(event, listener),
    removeListener: (event, listener) => connector.provider.removeListener?.(event, listener)
  };

  const chainId = (await bridgeProvider.request({ method: "eth_chainId" })) as string;
  emitWalletConnectDebug(`Cadena activa devuelta por la wallet: ${chainId}`);

  return {
    connectorId: "walletconnect",
    connectorName: "WalletConnect",
    source: "walletconnect",
    address: parsed.address,
    chainId,
    provider: bridgeProvider
  };
}

function getExistingWalletConnectSession(connector: UniversalConnector): WalletConnectSession | undefined {
  const provider = connector.provider as WalletConnectProviderInternals;

  return provider.session ?? provider.client?.session?.getAll?.()[0];
}

function getPrimaryWalletConnectAccount(session?: WalletConnectSession): string | undefined {
  return session?.namespaces?.eip155?.accounts?.[0];
}

function attachWalletConnectDebugEvents(connector: UniversalConnector) {
  const provider = connector.provider as {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  if (!provider.on) {
    return;
  }

  (["display_uri", "session_proposal", "session_request", "session_delete", "session_update", "session_expire"] as const).forEach((eventName) => {
    provider.on?.(eventName, (...args: unknown[]) => {
      const payload = args.length <= 1 ? args[0] : args;
      walletConnectDiagnosticsState.events = [
        ...walletConnectDiagnosticsState.events.slice(-49),
        {
          at: new Date().toISOString(),
          event: eventName,
          payload: serializeUnknownError(payload)
        }
      ];
      emitWalletConnectDebug(`Evento ${eventName}: ${safeJsonStringify(payload)}`);
    });
  });
}

function describeWalletConnectState(connector: UniversalConnector): string {
  const provider = connector.provider as WalletConnectProviderInternals;
  const pairing = provider.client?.pairing?.getPairings?.()?.[0];

  return safeJsonStringify({
    initialized: true,
    relayUrl: provider.client?.core?.relayUrl ?? WALLETCONNECT_RELAY_URL,
    relayProtocol: provider.client?.core?.relayer?.protocol ?? pairing?.relay?.protocol ?? null,
    pairingTopic: pairing?.topic ?? null,
    pairingRelay: pairing?.relay ?? null,
    transportType: extractTransportType(walletConnectDiagnosticsState.events),
    hasSession: Boolean(provider.session),
    sessionCount: provider.client?.session?.getAll?.().length ?? 0,
    requestedChain: HYPERLIQUID_TESTNET_CAIP
  });
}

function formatWalletConnectError(error: unknown): string {
  const serialized = {
    error: serializeUnknownError(error),
    walletConnectContext: collectWalletConnectFailureContext()
  };
  walletConnectDiagnosticsState.lastError = serialized;
  walletConnectDiagnosticsState.lastHttpResponse = extractCandidateField(serialized, ["response", "httpResponse"]);
  walletConnectDiagnosticsState.lastRelayJson = extractCandidateField(serialized, ["data", "json", "body", "result"]);
  return safeJsonStringify(serialized);
}

function getErrorCode(error: Error): unknown {
  return (error as Error & { code?: unknown }).code;
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (currentValue && typeof currentValue === "object") {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      return currentValue;
    },
    2
  );
}

function serializeUnknownError(value: unknown): unknown {
  return serializeValue(value, new WeakSet<object>());
}

function serializeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Error) {
    const output: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
      cause: serializeValue(value.cause, seen),
      code: getErrorCode(value)
    };

    for (const key of Object.getOwnPropertyNames(value)) {
      output[key] = serializeValue((value as unknown as Record<string, unknown>)[key], seen);
    }

    return output;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry, seen));
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    output[key] = serializeValue((value as Record<string, unknown>)[key], seen);
  }

  return output;
}

function extractCandidateField(source: unknown, keys: string[]): unknown {
  if (!source || typeof source !== "object") {
    return null;
  }

  const sourceRecord = source as Record<string, unknown>;
  for (const key of keys) {
    if (key in sourceRecord) {
      return sourceRecord[key];
    }
  }

  return null;
}

export function getWalletConnectDiagnosticsSnapshot(): WalletConnectDiagnosticsSnapshot {
  const projectId = getWalletConnectProjectId();

  return {
    sdkVersions: {
      walletConnect: WALLETCONNECT_CORE_VERSION,
      reown: REOWN_APPKIT_VERSION
    },
    projectId: {
      masked: maskWalletConnectProjectId(projectId),
      validation: validateWalletConnectProjectId(projectId)
    },
    relayUrl: WALLETCONNECT_RELAY_URL,
    metadata: getWalletMetadata(),
    redirect: getWalletConnectRedirectConfig(),
    location: getWalletConnectLocation(),
    chainId: {
      caip: HYPERLIQUID_TESTNET_CAIP,
      hex: HYPERLIQUID_TESTNET_CHAIN_HEX,
      numeric: HYPERLIQUID_TESTNET_CHAIN_ID
    },
    requiredNamespaces: buildWalletConnectNamespaces(),
    optionalNamespaces: null,
    connectPayload: {
      requiredNamespaces: buildWalletConnectNamespaces(),
      optionalNamespaces: null
    },
    initializationState: {
      initialized: walletConnectDiagnosticsState.initialized,
      lastKnownProviderState: walletConnectDiagnosticsState.lastKnownProviderState
    },
    lastResponse: walletConnectDiagnosticsState.lastResponse,
    lastError: walletConnectDiagnosticsState.lastError,
    lastHttpResponse: walletConnectDiagnosticsState.lastHttpResponse,
    lastRelayJson: walletConnectDiagnosticsState.lastRelayJson,
    events: walletConnectDiagnosticsState.events
  };
}

type WalletConnectProviderInternals = {
  session?: WalletConnectSession;
  client?: {
    connect: (params: {
      requiredNamespaces: ReturnType<typeof buildWalletConnectNamespaces>;
    }) => Promise<{
      uri?: string;
      approval: () => Promise<WalletConnectSession>;
    }>;
    session?: {
      getAll?: () => WalletConnectSession[];
    };
    pairing?: {
      getPairings?: () => Array<{
        topic: string;
        relay?: {
          protocol?: string;
          data?: string;
        };
      }>;
    };
    core?: {
      relayUrl?: string;
      relayer?: {
        protocol?: string;
      };
    };
  };
};

function getWalletConnectAppKit(connector: UniversalConnector): {
  open: (options?: { uri?: string }) => Promise<void>;
  close: () => Promise<void>;
} | undefined {
  const internal = connector as unknown as {
    appKit?: {
      open: (options?: { uri?: string }) => Promise<void>;
      close: () => Promise<void>;
    };
  };

  return internal.appKit;
}

function collectWalletConnectFailureContext() {
  const connector = walletConnectConnectorInstance;
  const provider = connector?.provider as WalletConnectProviderInternals | undefined;
  const pairing = provider?.client?.pairing?.getPairings?.()?.[0];

  return {
    topic: pairing?.topic ?? null,
    pairingTopic: pairing?.topic ?? null,
    relayProtocol: provider?.client?.core?.relayer?.protocol ?? pairing?.relay?.protocol ?? null,
    relayUrl: provider?.client?.core?.relayUrl ?? WALLETCONNECT_RELAY_URL,
    pairingRelay: pairing?.relay ?? null,
    transport: extractTransportType(walletConnectDiagnosticsState.events)
  };
}

function extractTransportType(events: WalletConnectEventEntry[]): unknown {
  const lastEventWithTransport = [...events].reverse().find((entry) => {
    if (!entry.payload || typeof entry.payload !== "object") {
      return false;
    }

    const payload = entry.payload as Record<string, unknown>;
    return "transportType" in payload;
  });

  if (!lastEventWithTransport || !lastEventWithTransport.payload || typeof lastEventWithTransport.payload !== "object") {
    return null;
  }

  return (lastEventWithTransport.payload as Record<string, unknown>).transportType ?? null;
}
