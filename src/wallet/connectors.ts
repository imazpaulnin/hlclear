import type { ConnectedWalletSession, Eip1193Provider, WalletConnectorId, WalletOption } from "./types";
import { UniversalConnector, type UniversalConnectorConfig } from "@reown/appkit-universal-connector";
import type { CustomCaipNetwork } from "@reown/appkit-common";
import { mainnet } from "viem/chains";
import { getWalletConnectProjectId, getWalletMetadata } from "./walletConfig";
import { parseWalletConnectAccount } from "./walletUtils";

type WalletDebugLogger = (message: string) => void;

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

      const { session } = await connector.connect();
      const account = session.namespaces?.eip155?.accounts?.[0];
      const parsed = account ? parseWalletConnectAccount(account) : undefined;

      if (!parsed) {
        throw new Error("WalletConnect no devolvio una cuenta EVM compatible.");
      }

      const currentCaipChain = `eip155:${parsed.chainId === "0x1" ? "1" : Number.parseInt(parsed.chainId, 16)}`;
      const bridgeProvider: Eip1193Provider = {
        request: (args) => connector.request(args, currentCaipChain),
        on: (event, listener) => connector.provider.on?.(event, listener),
        removeListener: (event, listener) => connector.provider.removeListener?.(event, listener)
      };

      const chainId = (await bridgeProvider.request({ method: "eth_chainId" })) as string;

      return {
        connectorId: this.id,
        connectorName: this.name,
        source: this.source,
        address: parsed.address,
        chainId,
        provider: bridgeProvider
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido al abrir WalletConnect.";
      this.debug?.(`WalletConnect devolvio una excepcion: ${message}`);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.connector?.disconnect();
  }
}

export function createConnector(option: WalletOption, debug?: WalletDebugLogger): WalletConnector {
  if (option.id === "walletconnect") {
    return new WalletConnectConnector(debug);
  }

  return new InjectedWalletConnector(option);
}

let walletConnectConnectorPromise: Promise<UniversalConnector> | undefined;

export function prepareWalletConnectConnector(debug?: WalletDebugLogger): Promise<UniversalConnector> {
  if (!walletConnectConnectorPromise) {
    walletConnectConnectorPromise = initializeWalletConnectConnector(debug);
  } else {
    debug?.("WalletConnect reutiliza la instancia ya preparada.");
  }

  return walletConnectConnectorPromise;
}

async function initializeWalletConnectConnector(debug?: WalletDebugLogger): Promise<UniversalConnector> {
  const projectId = getWalletConnectProjectId();
  debug?.(`WalletConnect projectId cargado: ${projectId ? "si" : "no"}`);

  if (!projectId) {
    throw new Error("WalletConnect requiere VITE_WALLETCONNECT_PROJECT_ID en despliegue.");
  }

  debug?.("Inicializando WalletConnect...");

  return UniversalConnector.init({
    projectId,
    metadata: getWalletMetadata(),
    networks: [evmWalletConnectNamespace],
    providerConfig: {
      logger: "error"
    }
  } satisfies UniversalConnectorConfig);
}

const ethereumMainnetNetwork: CustomCaipNetwork<"eip155"> = {
  ...mainnet,
  id: mainnet.id,
  chainNamespace: "eip155",
  caipNetworkId: "eip155:1",
};

const evmWalletConnectNamespace: UniversalConnectorConfig["networks"][number] = {
  namespace: "eip155",
  methods: ["eth_requestAccounts", "eth_accounts", "eth_chainId", "eth_signTypedData_v4", "personal_sign"],
  events: ["accountsChanged", "chainChanged", "disconnect"],
  chains: [ethereumMainnetNetwork]
};
