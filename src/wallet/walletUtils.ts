import type { WalletConnectorId, WalletOption } from "./types";
import { shouldPreferWalletConnect } from "./walletEnvironment";

const KNOWN_NETWORKS: Record<string, string> = {
  "0x1": "Ethereum Mainnet",
  "0xa4b1": "Arbitrum One",
  "0x2105": "Base",
  "0x89": "Polygon",
  "0xaa36a7": "Sepolia",
  "0x3e6": "Hyperliquid Testnet",
  "0x3e7": "Hyperliquid Mainnet"
};

export function normalizeAddress(address?: string | null): string | undefined {
  if (!address) {
    return undefined;
  }

  return /^0x[a-fA-F0-9]{40}$/.test(address) ? address.toLowerCase() : undefined;
}

export function addressesMatch(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeAddress(left);
  const normalizedRight = normalizeAddress(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function formatWalletNetwork(chainId?: string): string {
  if (!chainId) {
    return "Sin red";
  }

  return KNOWN_NETWORKS[chainId] ? `${KNOWN_NETWORKS[chainId]} (${chainId})` : chainId;
}

export function pickPreferredWallet(options: WalletOption[], targetWindow: Window = window): WalletOption | undefined {
  const available = options.filter((option) => option.available);
  const byPriority: WalletConnectorId[] = shouldPreferWalletConnect(targetWindow)
    ? ["walletconnect", "rabby", "metamask", "injected"]
    : ["rabby", "metamask", "walletconnect", "injected"];

  return byPriority
    .map((id) => available.find((option) => option.id === id))
    .find((option): option is WalletOption => Boolean(option));
}

export function walletStatusLabel(status: "disconnected" | "connecting" | "connected" | "error"): string {
  switch (status) {
    case "connecting":
      return "Conectando";
    case "connected":
      return "Conectado";
    case "error":
      return "Error";
    case "disconnected":
    default:
      return "Desconectado";
  }
}

export function parseWalletConnectAccount(account: string): { chainId: string; address: string } | undefined {
  const [namespace, chainReference, address] = account.split(":");
  if (namespace !== "eip155" || !chainReference || !address) {
    return undefined;
  }

  const numericChainId = Number(chainReference);
  if (!Number.isFinite(numericChainId)) {
    return undefined;
  }

  return {
    chainId: `0x${numericChainId.toString(16)}`,
    address
  };
}
