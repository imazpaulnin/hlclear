export type WalletConnectorId = "metamask" | "rabby" | "walletconnect" | "injected";

export type WalletSource = "eip6963" | "window.ethereum" | "walletconnect";

export type WalletConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  connect?(): Promise<unknown>;
  disconnect?(): Promise<void>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  providers?: Eip1193Provider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  selectedAddress?: string | null;
  chainId?: string;
  session?: unknown;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface WalletOption {
  id: WalletConnectorId;
  name: string;
  source: WalletSource;
  available: boolean;
  preferred: boolean;
  provider?: Eip1193Provider;
  rdns?: string;
  reasonUnavailable?: string;
}

export interface ConnectedWalletSession {
  connectorId: WalletConnectorId;
  connectorName: string;
  source: WalletSource;
  address: string;
  chainId: string;
  provider: Eip1193Provider;
}

export interface WalletControllerState {
  status: WalletConnectionStatus;
  connectorId?: WalletConnectorId;
  connectorName?: string;
  source?: WalletSource;
  address?: string;
  chainId?: string;
  networkLabel: string;
  error?: string;
}
