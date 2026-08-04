const LOCALHOST_WALLETCONNECT_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

export const REOWN_APPKIT_VERSION = "1.8.23";
export const WALLETCONNECT_CORE_VERSION = "2.23.10";
export const WALLETCONNECT_RELAY_URL = "wss://relay.walletconnect.org";
export const HYPERLIQUID_TESTNET_CHAIN_ID = 998;
export const HYPERLIQUID_MAINNET_CHAIN_ID = 999;
export const HYPERLIQUID_TESTNET_CHAIN_HEX = "0x3e6";
export const HYPERLIQUID_MAINNET_CHAIN_HEX = "0x3e7";
export const HYPERLIQUID_TESTNET_CAIP = "eip155:998";
export const HYPERLIQUID_MAINNET_CAIP = "eip155:999";

export type WalletConnectProjectIdValidation = {
  exists: boolean;
  isEmpty: boolean;
  hasSpaces: boolean;
  length: number;
  expectedLength: number;
  format: "hex32" | "invalid";
  valid: boolean;
  reasons: string[];
};

export function getWalletConnectProjectId(): string | undefined {
  const configured = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      return LOCALHOST_WALLETCONNECT_PROJECT_ID;
    }
  }

  return undefined;
}

export function hasWalletConnectProjectId(): boolean {
  return Boolean(getWalletConnectProjectId());
}

export function maskWalletConnectProjectId(projectId?: string): string {
  if (!projectId) {
    return "no";
  }

  if (projectId.length <= 10) {
    return projectId;
  }

  return `${projectId.slice(0, 6)}...${projectId.slice(-4)}`;
}

export function validateWalletConnectProjectId(projectId?: string): WalletConnectProjectIdValidation {
  const exists = typeof projectId === "string";
  const raw = projectId ?? "";
  const isEmpty = raw.length === 0;
  const hasSpaces = /\s/.test(raw);
  const expectedLength = 32;
  const format = /^[a-fA-F0-9]{32}$/.test(raw) ? "hex32" : "invalid";
  const reasons: string[] = [];

  if (!exists) {
    reasons.push("No existe VITE_WALLETCONNECT_PROJECT_ID.");
  }
  if (isEmpty) {
    reasons.push("El Project ID esta vacio.");
  }
  if (hasSpaces) {
    reasons.push("El Project ID contiene espacios.");
  }
  if (!isEmpty && raw.length !== expectedLength) {
    reasons.push(`La longitud es ${raw.length} y deberia ser ${expectedLength}.`);
  }
  if (!isEmpty && format !== "hex32") {
    reasons.push("El formato no coincide con 32 caracteres hexadecimales.");
  }

  return {
    exists,
    isEmpty,
    hasSpaces,
    length: raw.length,
    expectedLength,
    format,
    valid: reasons.length === 0,
    reasons
  };
}

export function getWalletMetadata() {
  const origin = typeof window !== "undefined" ? window.location.origin : "app://hlclear";
  const basePath = import.meta.env.BASE_URL || "/";
  const appUrl = typeof window !== "undefined" ? new URL(basePath, origin).toString() : `${origin}/`;
  const iconPath = typeof window !== "undefined" ? new URL(`icons/icon-192.png`, appUrl).toString() : `${origin}/icons/icon-192.png`;
  const redirect = getWalletConnectRedirectConfig();

  return {
    name: "HLClear",
    description: "Cliente movil de Hyperliquid con auditoria financiera completa y ejecucion manual.",
    url: appUrl,
    icons: [iconPath],
    redirect: {
      universal: redirect.universal ?? undefined,
      native: redirect.native ?? undefined,
      linkMode: redirect.linkMode
    }
  };
}

export function getWalletConnectLocation() {
  return {
    origin: typeof window !== "undefined" ? window.location.origin : "app://hlclear",
    href: typeof window !== "undefined" ? window.location.href : "app://hlclear/"
  };
}

export function getWalletConnectRedirectConfig() {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://imazpaulnin.github.io";
  const basePath = import.meta.env.BASE_URL || "/";
  const appUrl = new URL(basePath, `${origin}/`).toString();

  return {
    configured: true,
    native: null,
    universal: appUrl,
    linkMode: true
  };
}
