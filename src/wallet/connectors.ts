import type { ConnectedWalletSession, Eip1193Provider, WalletConnectorId, WalletOption } from "./types";

type WalletDebugLogger = (message: string) => void;

const LEGACY_WALLET_SCHEMA_KEY = "hlclear.walletConnectionSchemaVersion";
const LEGACY_WALLET_SCHEMA_VERSION = 3;
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

export function createConnector(option: WalletOption, debug?: WalletDebugLogger): WalletConnector {
  return new InjectedWalletConnector(option, debug);
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
  clearLegacyWalletStorage();
  writeLegacyWalletSchemaVersion(LEGACY_WALLET_SCHEMA_VERSION);
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
