import { EthereumProvider } from "@walletconnect/ethereum-provider";
import type { ConnectedWalletSession, Eip1193Provider, WalletConnectorId, WalletOption } from "./types";
import {
  getWalletConnectEmergencyProjectId,
  getWalletConnectRequiredChains,
  getWalletConnectRequiredEvents,
  getWalletConnectRequiredMethods,
  getWalletConnectOptionalChains,
  getWalletConnectProjectId,
  getWalletConnectRpcMap,
  getWalletMetadata,
  hasWalletConnectProjectId
} from "./walletConfig";
import { isIosSafari } from "./walletEnvironment";

type WalletDebugLogger = (message: string) => void;

const LEGACY_WALLET_SCHEMA_KEY = "hlclear.walletConnectionSchemaVersion";
const LEGACY_WALLET_SCHEMA_VERSION = 4;
const LEGACY_WALLET_STORAGE_PATTERNS = [/walletconnect/i, /\bwc@2/i, /reown/i, /appkit/i];

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
  private readonly debug?: WalletDebugLogger;

  constructor(option: WalletOption, debug?: WalletDebugLogger) {
    if (!option.provider) {
      throw new Error("Wallet inyectada no disponible.");
    }

    this.id = option.id;
    this.name = option.name;
    this.source = option.source;
    this.provider = option.provider;
    this.debug = debug;
  }

  async connect(): Promise<ConnectedWalletSession> {
    this.debug?.(`Solicitando cuentas a ${this.name}.`);
    const accounts = (await this.provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    const chainId = (await this.provider.request({ method: "eth_chainId" })) as string;

    if (!address) {
      throw new Error("La wallet no devolvio ninguna direccion.");
    }

    this.debug?.(`Conexion completada con ${this.name} en ${chainId}.`);

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
      // Algunas wallets no permiten revocar permisos desde la dapp.
    }
  }
}

class WalletConnectConnector implements WalletConnector {
  readonly id = "walletconnect" as const;
  readonly name = "WalletConnect";
  readonly source = "walletconnect" as const;
  private readonly debug?: WalletDebugLogger;

  constructor(debug?: WalletDebugLogger) {
    this.debug = debug;
  }

  async connect(): Promise<ConnectedWalletSession> {
    const provider = await connectWalletConnectWithRetry(this.debug);

    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    const address = accounts[0];
    const chainId = (await provider.request({ method: "eth_chainId" })) as string;

    if (!address) {
      throw new Error("WalletConnect no devolvio ninguna direccion.");
    }

    return {
      connectorId: this.id,
      connectorName: this.name,
      source: this.source,
      address,
      chainId,
      provider
    };
  }

  async disconnect(): Promise<void> {
    const provider = walletConnectProviderPromise ? await walletConnectProviderPromise : undefined;
    try {
      await provider?.disconnect?.();
    } finally {
      walletConnectProviderPromise = undefined;
      clearLegacyWalletStorage();
      writeLegacyWalletSchemaVersion(LEGACY_WALLET_SCHEMA_VERSION);
    }
  }
}

let walletConnectProviderPromise: Promise<Eip1193Provider> | undefined;

export function createConnector(option: WalletOption, debug?: WalletDebugLogger): WalletConnector {
  if (option.id === "walletconnect") {
    return new WalletConnectConnector(debug);
  }

  return new InjectedWalletConnector(option, debug);
}

export function buildWalletConnectOption(): WalletOption {
  return {
    id: "walletconnect",
    name: "WalletConnect",
    source: "walletconnect",
    available: hasWalletConnectProjectId(),
    preferred: false,
    reasonUnavailable: hasWalletConnectProjectId()
      ? undefined
      : "Falta configurar VITE_WALLETCONNECT_PROJECT_ID para abrir el selector oficial en Safari o PWA."
  };
}

async function getWalletConnectProvider(debug?: WalletDebugLogger): Promise<Eip1193Provider> {
  if (!walletConnectProviderPromise) {
    walletConnectProviderPromise = initializeWalletConnectProvider(undefined, debug);
  } else if (debug) {
    debug("WalletConnect reutiliza la instancia preparada.");
  }

  return walletConnectProviderPromise;
}

async function initializeWalletConnectProvider(projectIdOverride?: string, debug?: WalletDebugLogger): Promise<Eip1193Provider> {
  const projectId = projectIdOverride ?? getWalletConnectProjectId();
  if (!projectId) {
    throw new Error("WalletConnect no esta configurado en este entorno.");
  }

  debug?.(
    `Inicializando proveedor WalletConnect con projectId ${
      projectId === getWalletConnectEmergencyProjectId() ? "publico de contingencia" : "configurado"
    }.`
  );

  const provider = await EthereumProvider.init({
    projectId,
    metadata: getWalletMetadata(),
    showQrModal: !isIosSafari(),
    chains: getWalletConnectRequiredChains(),
    optionalChains: getWalletConnectOptionalChains(),
    methods: getWalletConnectRequiredMethods(),
    events: getWalletConnectRequiredEvents(),
    rpcMap: getWalletConnectRpcMap()
  });

  attachWalletConnectDebug(provider as unknown as Eip1193Provider, debug);
  return provider as unknown as Eip1193Provider;
}

async function connectWalletConnectWithRetry(debug?: WalletDebugLogger): Promise<Eip1193Provider> {
  const preferredProjectId = getWalletConnectProjectId();
  const emergencyProjectId = getWalletConnectEmergencyProjectId();

  try {
    const provider = await getWalletConnectProvider(debug);
    await ensureWalletConnectSession(provider, debug);
    return provider;
  } catch (error) {
    if (!isPublishPayloadError(error)) {
      throw error;
    }

    if (!preferredProjectId || preferredProjectId === emergencyProjectId) {
      throw error;
    }

    debug?.("El projectId configurado no ha podido publicar la propuesta. Se reintentara una sola vez con el projectId publico de contingencia.");
    walletConnectProviderPromise = undefined;
    clearLegacyWalletStorage();

    const provider = await initializeWalletConnectProvider(emergencyProjectId, debug);
    walletConnectProviderPromise = Promise.resolve(provider);
    await ensureWalletConnectSession(provider, debug);
    return provider;
  }
}

async function ensureWalletConnectSession(provider: Eip1193Provider, debug?: WalletDebugLogger) {
  const hasSession = Boolean(provider.session);
  const prefersDirectMobileUri = isIosSafari();

  debug?.(`WalletConnect inicializado. Sesion previa: ${hasSession ? "si" : "no"}.`);

  if (hasSession) {
    return;
  }

  if (prefersDirectMobileUri) {
    debug?.("Safari iPhone detectado. Se evitara el modal AppKit y se lanzara la URI directa de WalletConnect.");
  } else {
    debug?.("Abriendo modal oficial de WalletConnect.");
  }

  await provider.connect?.({
    chains: getWalletConnectRequiredChains(),
    optionalChains: getWalletConnectOptionalChains(),
    rpcMap: getWalletConnectRpcMap()
  });
}

function isPublishPayloadError(error: unknown): boolean {
  return error instanceof Error && /Failed to publish custom payload/i.test(error.message);
}

function attachWalletConnectDebug(provider: Eip1193Provider, debug?: WalletDebugLogger) {
  if (!debug || !provider.on) {
    return;
  }

  provider.on("display_uri", (...args: unknown[]) => {
    const uri = typeof args[0] === "string" ? args[0] : undefined;
    debug(`WalletConnect ha emitido display_uri.${uri ? ` URI: ${uri}` : ""}`);

    if (uri && isIosSafari()) {
      debug("Safari iPhone abrira la URI directa para delegar la conexion a la wallet instalada.");
      openWalletConnectUri(uri, debug);
    }
  });
  provider.on("connect", () => {
    debug("WalletConnect ha establecido la sesion.");
  });
  provider.on("disconnect", () => {
    debug("WalletConnect ha cerrado la sesion.");
  });
}

function openWalletConnectUri(uri: string, debug?: WalletDebugLogger) {
  try {
    // En iPhone Safari esta via evita depender del modal cargado desde AppKit.
    window.location.href = uri;
  } catch (error) {
    debug?.(
      `No se pudo abrir la URI de WalletConnect: ${
        error instanceof Error ? error.message : JSON.stringify(error)
      }`
    );
  }
}

export function runLegacyWalletSchemaMigration() {
  const currentVersion = readLegacyWalletSchemaVersion();
  if (currentVersion >= LEGACY_WALLET_SCHEMA_VERSION) {
    return;
  }

  clearLegacyWalletStorage();
  writeLegacyWalletSchemaVersion(LEGACY_WALLET_SCHEMA_VERSION);
}

export async function resetLegacyWalletState(): Promise<void> {
  const provider = walletConnectProviderPromise ? await walletConnectProviderPromise.catch(() => undefined) : undefined;

  try {
    await provider?.disconnect?.();
  } catch {
    // Ignora sesiones rotas antes de limpiar almacenamiento.
  } finally {
    walletConnectProviderPromise = undefined;
    clearLegacyWalletStorage();
    writeLegacyWalletSchemaVersion(LEGACY_WALLET_SCHEMA_VERSION);
  }
}

function clearLegacyWalletStorage() {
  clearMatchingStorage(window.localStorage);
  clearMatchingStorage(window.sessionStorage);
}

function clearMatchingStorage(storage: Storage) {
  const keysToDelete: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || key === LEGACY_WALLET_SCHEMA_KEY) {
      continue;
    }

    if (LEGACY_WALLET_STORAGE_PATTERNS.some((pattern) => pattern.test(key))) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach((key) => storage.removeItem(key));
}

function readLegacyWalletSchemaVersion(): number {
  const raw = window.localStorage.getItem(LEGACY_WALLET_SCHEMA_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeLegacyWalletSchemaVersion(version: number) {
  window.localStorage.setItem(LEGACY_WALLET_SCHEMA_KEY, String(version));
}
