const LOCALHOST_WALLETCONNECT_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";
const WALLETCONNECT_OPTIONAL_CHAINS = [1, 42161] as const;
const WALLETCONNECT_RPC_MAP = {
  1: "https://cloudflare-eth.com",
  42161: "https://arb1.arbitrum.io/rpc"
} satisfies Record<number, string>;

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

export function hasWalletConnectProjectId(): boolean {
  return Boolean(getWalletConnectProjectId());
}

export function getWalletConnectOptionalChains(): [number, ...number[]] {
  return [...WALLETCONNECT_OPTIONAL_CHAINS] as [number, ...number[]];
}

export function getWalletConnectRpcMap(): Record<number, string> {
  return { ...WALLETCONNECT_RPC_MAP };
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
  const url = buildWalletConnectUrl();

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

function buildWalletConnectUrl(): string {
  if (typeof window === "undefined") {
    return import.meta.env.BASE_URL || "/";
  }

  const current = new URL(window.location.href);
  current.hash = "";
  return current.toString();
}

function buildWalletAssetUrl(pathname: string): string {
  if (typeof window === "undefined") {
    return `${import.meta.env.BASE_URL || "/"}${pathname}`;
  }

  return new URL(pathname, `${window.location.origin}${import.meta.env.BASE_URL}`).toString();
}
