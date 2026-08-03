import type { Eip1193Provider, Eip6963ProviderInfo, WalletOption } from "./types";
import { pickPreferredWallet } from "./walletUtils";

type AnnounceEvent = Event & {
  detail?: {
    info: Eip6963ProviderInfo;
    provider: Eip1193Provider;
  };
};

function asWalletOption(provider: Eip1193Provider, info?: Eip6963ProviderInfo): WalletOption {
  const rdns = info?.rdns?.toLowerCase();
  const isRabby = rdns === "io.rabby" || provider.isRabby === true;
  const isMetaMask = rdns === "io.metamask" || provider.isMetaMask === true;

  if (isRabby) {
    return {
      id: "rabby",
      name: "Rabby",
      source: info ? "eip6963" : "window.ethereum",
      available: true,
      preferred: false,
      provider,
      rdns: info?.rdns
    };
  }

  if (isMetaMask) {
    return {
      id: "metamask",
      name: "MetaMask",
      source: info ? "eip6963" : "window.ethereum",
      available: true,
      preferred: false,
      provider,
      rdns: info?.rdns
    };
  }

  return {
    id: "injected",
    name: info?.name ?? "Wallet inyectada",
    source: info ? "eip6963" : "window.ethereum",
    available: true,
    preferred: false,
    provider,
    rdns: info?.rdns
  };
}

function collectFallbackProviders(targetWindow: Window): Eip1193Provider[] {
  const rootProvider = (targetWindow as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!rootProvider) {
    return [];
  }

  const candidates = Array.isArray(rootProvider.providers) && rootProvider.providers.length > 0 ? rootProvider.providers : [rootProvider];
  return candidates.filter(Boolean);
}

export async function discoverInjectedWallets(targetWindow: Window = window): Promise<WalletOption[]> {
  const discovered = new Map<string, WalletOption>();

  function addWallet(option: WalletOption) {
    const dedupeKey = option.id === "injected" ? `${option.id}:${option.rdns ?? option.name}` : option.id;
    if (!discovered.has(dedupeKey)) {
      discovered.set(dedupeKey, option);
    }
  }

  const announceHandler = (event: Event) => {
    const announceEvent = event as AnnounceEvent;
    if (!announceEvent.detail?.provider) {
      return;
    }

    addWallet(asWalletOption(announceEvent.detail.provider, announceEvent.detail.info));
  };

  targetWindow.addEventListener("eip6963:announceProvider", announceHandler);
  targetWindow.dispatchEvent(new Event("eip6963:requestProvider"));

  await new Promise((resolve) => targetWindow.setTimeout(resolve, 0));

  targetWindow.removeEventListener("eip6963:announceProvider", announceHandler);

  collectFallbackProviders(targetWindow).forEach((provider) => addWallet(asWalletOption(provider)));

  const wallets = [...discovered.values()];
  const preferred = pickPreferredWallet(wallets);

  return wallets.map((wallet) => ({
    ...wallet,
    preferred: preferred?.id === wallet.id && (preferred.provider === wallet.provider || preferred.name === wallet.name)
  }));
}
