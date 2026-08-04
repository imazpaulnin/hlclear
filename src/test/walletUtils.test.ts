import { afterEach, describe, expect, it } from "vitest";
import type { WalletOption } from "../wallet/types";
import { addressesMatch, formatWalletNetwork, pickPreferredWallet } from "../wallet/walletUtils";

describe("walletUtils", () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0"
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32"
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0
    });
  });

  it("matches addresses case-insensitively only when both are valid", () => {
    expect(addressesMatch("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(addressesMatch("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(addressesMatch("invalid", "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });

  it("formats known and unknown chain ids", () => {
    expect(formatWalletNetwork("0x1")).toBe("Ethereum Mainnet (0x1)");
    expect(formatWalletNetwork("0x3e6")).toBe("Hyperliquid Testnet (0x3e6)");
    expect(formatWalletNetwork("0x3e7")).toBe("Hyperliquid Mainnet (0x3e7)");
    expect(formatWalletNetwork("0x999")).toBe("0x999");
    expect(formatWalletNetwork(undefined)).toBe("Sin red");
  });

  it("prefers Rabby, then MetaMask, then WalletConnect, then generic injected wallets", () => {
    const options: WalletOption[] = [
      { id: "metamask", name: "MetaMask", source: "window.ethereum", available: true, preferred: false },
      { id: "rabby", name: "Rabby", source: "eip6963", available: true, preferred: false },
      { id: "walletconnect", name: "WalletConnect", source: "walletconnect", available: true, preferred: false },
      { id: "injected", name: "Injected", source: "window.ethereum", available: true, preferred: false }
    ];

    expect(pickPreferredWallet(options)?.id).toBe("rabby");
    expect(
      pickPreferredWallet(options.filter((option) => option.id !== "rabby"))?.id
    ).toBe("metamask");
    expect(
      pickPreferredWallet(options.filter((option) => option.id === "walletconnect" || option.id === "injected"))?.id
    ).toBe("walletconnect");
    expect(
      pickPreferredWallet(options.filter((option) => option.id === "injected"))?.id
    ).toBe("injected");
  });

  it("keeps preferring Rabby on iPhone Safari when it is injected", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "iPhone"
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5
    });

    const options: WalletOption[] = [
      { id: "metamask", name: "MetaMask", source: "window.ethereum", available: true, preferred: false },
      { id: "rabby", name: "Rabby", source: "eip6963", available: true, preferred: false }
    ];

    expect(pickPreferredWallet(options)?.id).toBe("rabby");
  });
});
