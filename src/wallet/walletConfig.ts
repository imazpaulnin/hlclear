const LOCALHOST_WALLETCONNECT_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";
const METAMASK_WALLETCONNECT_ID = "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96";
const RABBY_WALLETCONNECT_ID = "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1";
const WALLETCONNECT_REQUIRED_CHAINS = [1] as const;
const WALLETCONNECT_OPTIONAL_CHAINS = [42161] as const;
const WALLETCONNECT_REQUIRED_METHODS = [
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain"
] as const;
const WALLETCONNECT_REQUIRED_EVENTS = ["chainChanged", "accountsChanged"] as const;
const WALLETCONNECT_RPC_MAP = {
  1: "https://cloudflare-eth.com",
  42161: "https://arb1.arbitrum.io/rpc"
} satisfies Record<number, string>;

const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function getWalletConnectProjectId(): string | undefined {
  const configured = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    return LOCALHOST_WALLETCONNECT_PROJECT_ID;
  }

  return undefined;
}

export function getWalletConnectEmergencyProjectId(): string {
  return LOCALHOST_WALLETCONNECT_PROJECT_ID;
}

export function validateWalletConnectProjectId(projectId?: string) {
  const reasons: string[] = [];
  const normalized = projectId?.trim();

  if (!normalized) {
    reasons.push("No existe VITE_WALLETCONNECT_PROJECT_ID.");
  } else {
    if (/\s/.test(normalized)) {
      reasons.push("El projectId contiene espacios.");
    }
    if (normalized.length !== 32) {
      reasons.push(`La longitud del projectId es ${normalized.length} y deberia ser 32.`);
    }
    if (!PROJECT_ID_PATTERN.test(normalized)) {
      reasons.push("El projectId no tiene formato hexadecimal de 32 caracteres.");
    }
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

export function hasWalletConnectProjectId(): boolean {
  return Boolean(getWalletConnectProjectId());
}

export function getWalletConnectOptionalChains(): [number, ...number[]] {
  return [...WALLETCONNECT_OPTIONAL_CHAINS] as [number, ...number[]];
}

export function getWalletConnectRequiredChains(): [number, ...number[]] {
  return [...WALLETCONNECT_REQUIRED_CHAINS] as [number, ...number[]];
}

export function getWalletConnectRequiredMethods(): [string, ...string[]] {
  return [...WALLETCONNECT_REQUIRED_METHODS] as [string, ...string[]];
}

export function getWalletConnectRequiredEvents(): [string, ...string[]] {
  return [...WALLETCONNECT_REQUIRED_EVENTS] as [string, ...string[]];
}

export function getWalletConnectRpcMap(): Record<number, string> {
  return { ...WALLETCONNECT_RPC_MAP };
}

export function getWalletConnectQrModalOptions() {
  return {
    enableExplorer: true,
    enableMobileFullScreen: true,
    explorerRecommendedWalletIds: [RABBY_WALLETCONNECT_ID, METAMASK_WALLETCONNECT_ID]
  };
}

export function maskWalletConnectProjectId(projectId?: string): string {
  if (!projectId) {
    return "no";
  }

  if (projectId.length <= 10) {
    return projectId;
  }

  return `${projectId.slice(0, 6)}…${projectId.slice(-4)}`;
}

export function getWalletMetadata() {
  const url = getWalletConnectCanonicalUrl();

  return {
    name: "HLClear",
    description: "Cliente movil de Hyperliquid con auditoria financiera y operativa manual.",
    url,
    icons: [buildWalletAssetUrl("icons/icon-192.png")],
    redirect: {
      universal: url
    }
  };
}

export function getWalletConnectOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.origin;
}

export function getWalletConnectCanonicalUrl(): string {
  if (typeof window === "undefined") {
    return import.meta.env.BASE_URL || "/";
  }

  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

function buildWalletAssetUrl(pathname: string): string {
  if (typeof window === "undefined") {
    return `${import.meta.env.BASE_URL || "/"}${pathname}`;
  }

  return new URL(pathname, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();
}
