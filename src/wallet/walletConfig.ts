const LOCALHOST_WALLETCONNECT_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

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

export function getWalletMetadata() {
  const origin = typeof window !== "undefined" ? window.location.origin : "app://hlclear";
  const basePath = import.meta.env.BASE_URL || "/";
  const appUrl = typeof window !== "undefined" ? new URL(basePath, origin).toString() : `${origin}/`;
  const iconPath = typeof window !== "undefined" ? new URL(`icons/icon-192.png`, appUrl).toString() : `${origin}/icons/icon-192.png`;

  return {
    name: "HLClear",
    description: "Cliente movil de Hyperliquid con auditoria financiera completa y ejecucion manual.",
    url: appUrl,
    icons: [iconPath]
  };
}
