import type { ConnectedWalletSession, Eip1193Provider, WalletConnectorId, WalletOption } from "./types";
import { getWalletConnectProjectId, getWalletMetadata } from "./walletConfig";
import { parseWalletConnectAccount } from "./walletUtils";

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
  private connector?: {
    connect: (params: { namespaces: Record<string, { methods: string[]; chains: string[]; events: string[] }> }) => Promise<{
      namespaces?: Record<string, { accounts?: string[] }>;
    }>;
    disconnect: () => Promise<void>;
    request: (request: { method: string; params?: unknown[] | Record<string, unknown> }, chainId?: string) => Promise<unknown>;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  async connect(): Promise<ConnectedWalletSession> {
    const projectId = getWalletConnectProjectId();
    if (!projectId) {
      throw new Error("WalletConnect requiere VITE_WALLETCONNECT_PROJECT_ID en despliegue.");
    }

    const { UniversalProvider } = await import("@walletconnect/universal-provider");
    const connector = await UniversalProvider.init({
      projectId,
      metadata: getWalletMetadata(),
      logger: "error"
    });

    const bridgeProvider: Eip1193Provider = {
      request: (args) => connector.request(args, "eip155:1"),
      on: (event, listener) => connector.on(event, listener),
      removeListener: (event, listener) => connector.removeListener(event, listener)
    };

    connector.on("display_uri", (...args: unknown[]) => {
      const displayUri = typeof args[0] === "string" ? args[0] : undefined;
      if (displayUri && typeof window !== "undefined") {
        window.location.assign(displayUri);
      }
    });

    this.connector = connector;
    const session = await connector.connect({
      namespaces: {
        eip155: {
          methods: ["eth_requestAccounts", "eth_accounts", "eth_chainId"],
          chains: ["eip155:1"],
          events: ["accountsChanged", "chainChanged", "disconnect"]
        }
      }
    });
    const account = session.namespaces?.eip155?.accounts?.[0];
    const parsed = account ? parseWalletConnectAccount(account) : undefined;

    if (!parsed) {
      throw new Error("WalletConnect no devolvio una cuenta EVM compatible.");
    }

    const chainId = (await bridgeProvider.request({ method: "eth_chainId" })) as string;

    return {
      connectorId: this.id,
      connectorName: this.name,
      source: this.source,
      address: parsed.address,
      chainId,
      provider: bridgeProvider
    };
  }

  async disconnect(): Promise<void> {
    await this.connector?.disconnect();
  }
}

export function createConnector(option: WalletOption): WalletConnector {
  if (option.id === "walletconnect") {
    return new WalletConnectConnector();
  }

  return new InjectedWalletConnector(option);
}
