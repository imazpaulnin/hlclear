import { describe, expect, it } from "vitest";
import type { WalletOption } from "../wallet/types";
import {
  addressesMatch,
  formatWalletNetwork,
  parseWalletConnectAccount,
  pickPreferredWallet
} from "../wallet/walletUtils";

describe("walletUtils", () => {
  it("matches addresses case-insensitively only when both are valid", () => {
    expect(addressesMatch("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(addressesMatch("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toBe(false);
    expect(addressesMatch("invalid", "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });

  it("formats known and unknown chain ids", () => {
    expect(formatWalletNetwork("0x1")).toBe("Ethereum Mainnet (0x1)");
    expect(formatWalletNetwork("0x999")).toBe("0x999");
    expect(formatWalletNetwork(undefined)).toBe("Sin red");
  });

  it("prefers Rabby, then MetaMask, then WalletConnect", () => {
    const options: WalletOption[] = [
      { id: "walletconnect", name: "WalletConnect", source: "walletconnect", available: true, preferred: false },
      { id: "metamask", name: "MetaMask", source: "window.ethereum", available: true, preferred: false },
      { id: "rabby", name: "Rabby", source: "eip6963", available: true, preferred: false }
    ];

    expect(pickPreferredWallet(options)?.id).toBe("rabby");
    expect(
      pickPreferredWallet(options.filter((option) => option.id !== "rabby"))?.id
    ).toBe("metamask");
  });

  it("parses WalletConnect accounts without transforming the address", () => {
    expect(parseWalletConnectAccount("eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toEqual({
      chainId: "0x1",
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });
    expect(parseWalletConnectAccount("solana:1:abc")).toBeUndefined();
    expect(parseWalletConnectAccount("eip155:not-a-number:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeUndefined();
  });
});
