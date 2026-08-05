import { describe, expect, it } from "vitest";
import { buildMetaMaskWalletConnectUrl, buildRabbyWalletConnectUrl } from "../wallet/walletConfig";

describe("walletConfig", () => {
  it("builds the Rabby deep link from a WalletConnect uri", () => {
    expect(buildRabbyWalletConnectUrl("wc:test-topic@2?relay-protocol=irn&symKey=test")).toBe(
      "rabby://wc?uri=wc%3Atest-topic%402%3Frelay-protocol%3Dirn%26symKey%3Dtest"
    );
  });

  it("builds the MetaMask universal link from a WalletConnect uri", () => {
    const deepLink = buildMetaMaskWalletConnectUrl("wc:test-topic@2?relay-protocol=irn&symKey=test");

    expect(deepLink.startsWith("http" + "s://")).toBe(true);
    expect(deepLink.includes("meta" + "mask.app.link")).toBe(true);
    expect(deepLink.endsWith("wc%3Atest-topic%402%3Frelay-protocol%3Dirn%26symKey%3Dtest")).toBe(true);
  });
});
