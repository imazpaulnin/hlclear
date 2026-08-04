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
  getWalletMetadata,
  maskWalletConnectProjectId
} from "./walletConfig";
import { parseWalletConnectAccount } from "./walletUtils";

type WalletDebugLogger = (message: string) => void;

type WalletConnectSessionEnvelope = Awaited<ReturnType<UniversalConnector["connect"]>>;
type WalletConnectSession = WalletConnectSessionEnvelope["session"];

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
  emitWalletConnectDebug(`WalletConnect projectId cargado: ${projectId ? maskWalletConnectProjectId(projectId) : "no"}`);

  if (!projectId) {
    throw new Error("WalletConnect requiere VITE_WALLETCONNECT_PROJECT_ID en despliegue.");
  }

  emitWalletConnectDebug(`Version Reown AppKit: ${REOWN_APPKIT_VERSION}`);
  emitWalletConnectDebug(`Version WalletConnect: ${WALLETCONNECT_CORE_VERSION}`);
  emitWalletConnectDebug(`Relay configurado: ${WALLETCONNECT_RELAY_URL}`);
  emitWalletConnectDebug(`Chain solicitada: ${HYPERLIQUID_TESTNET_CAIP} (${HYPERLIQUID_TESTNET_CHAIN_HEX})`);
  emitWalletConnectDebug(`Namespaces enviados: ${safeJsonStringify({ optionalNamespaces: buildWalletConnectNamespaces() })}`);
  emitWalletConnectDebug("Inicializando WalletConnect...");

  const connector = await UniversalConnector.init({
    projectId,
    metadata: getWalletMetadata(),
    networks: [evmWalletConnectNamespace],
    providerConfig: {
      logger: import.meta.env.DEV ? "info" : "error",
      relayUrl: WALLETCONNECT_RELAY_URL
    }
  } satisfies UniversalConnectorConfig);

  walletConnectConnectorInstance = connector;
  attachWalletConnectDebugEvents(connector);
  emitWalletConnectDebug(`Estado de inicializacion: ${describeWalletConnectState(connector)}`);

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
  emitWalletConnectDebug("Se intenta abrir el modal oficial de WalletConnect.");
  const response = await connector.connect();
  emitWalletConnectDebug(`Estado despues de connect(): ${describeWalletConnectState(connector)}`);
  emitWalletConnectDebug(`Respuesta completa de WalletConnect: ${safeJsonStringify(response)}`);
  return response;
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
  const provider = connector.provider as {
    session?: WalletConnectSession;
    client?: {
      session?: {
        getAll?: () => WalletConnectSession[];
      };
    };
  };

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

  (["display_uri", "session_proposal", "session_request", "session_delete", "session_update"] as const).forEach((eventName) => {
    provider.on?.(eventName, (...args: unknown[]) => {
      emitWalletConnectDebug(`Evento ${eventName}: ${safeJsonStringify(args.length <= 1 ? args[0] : args)}`);
    });
  });
}

function describeWalletConnectState(connector: UniversalConnector): string {
  const provider = connector.provider as {
    session?: WalletConnectSession;
    client?: {
      session?: {
        getAll?: () => WalletConnectSession[];
      };
      core?: {
        relayUrl?: string;
      };
    };
  };

  return safeJsonStringify({
    initialized: true,
    relayUrl: provider.client?.core?.relayUrl ?? WALLETCONNECT_RELAY_URL,
    hasSession: Boolean(provider.session),
    sessionCount: provider.client?.session?.getAll?.().length ?? 0,
    requestedChain: HYPERLIQUID_TESTNET_CAIP
  });
}

function formatWalletConnectError(error: unknown): string {
  if (error instanceof Error) {
    return safeJsonStringify({
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
      code: getErrorCode(error)
    });
  }

  return safeJsonStringify(error);
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
