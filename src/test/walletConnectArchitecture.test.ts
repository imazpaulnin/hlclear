import { beforeEach, describe, expect, it, vi } from "vitest";

const universalInitSpy = vi.fn();
const universalConnectSpy = vi.fn();
const universalDisconnectSpy = vi.fn();
const universalRequestSpy = vi.fn();
const providerOnSpy = vi.fn();
const providerRemoveListenerSpy = vi.fn();

vi.mock("@reown/appkit-universal-connector", () => {
  class MockUniversalConnector {
    static init = universalInitSpy;
  }

  return {
    UniversalConnector: MockUniversalConnector
  };
});

function buildSession(address = "0x1111111111111111111111111111111111111111") {
  return {
    namespaces: {
      eip155: {
        accounts: [`eip155:42161:${address}`]
      }
    }
  };
}

function buildMockConnector(session?: ReturnType<typeof buildSession>) {
  return {
    connect: universalConnectSpy,
    disconnect: universalDisconnectSpy,
    request: universalRequestSpy,
    provider: {
      session,
      on: providerOnSpy,
      removeListener: providerRemoveListenerSpy
    }
  };
}

describe("WalletConnect architecture", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    universalRequestSpy.mockResolvedValue("0xa4b1");
  });

  it("calls UniversalConnector.connect only once and uses eip155:42161", async () => {
    universalConnectSpy.mockResolvedValue({ session: buildSession() });
    universalInitSpy.mockResolvedValue(buildMockConnector());

    const connectors = await import("../wallet/connectors");
    const walletConnector = connectors.createConnector({
      id: "walletconnect",
      name: "WalletConnect",
      source: "walletconnect",
      available: true,
      preferred: true
    });

    const session = await walletConnector.connect();

    expect(universalConnectSpy).toHaveBeenCalledTimes(1);
    expect(universalConnectSpy).toHaveBeenCalledWith({
      namespaces: {
        eip155: expect.objectContaining({
          chains: ["eip155:42161"]
        })
      }
    });
    expect(session.address).toBe("0x1111111111111111111111111111111111111111");
    expect(session.chainId).toBe("0xa4b1");
    expect(connectors.buildWalletConnectNamespaces().eip155.chains).toEqual(["eip155:42161"]);
  });

  it("reuses a restored session instead of creating a second connection", async () => {
    universalInitSpy.mockResolvedValue(buildMockConnector(buildSession("0x2222222222222222222222222222222222222222")));

    const connectors = await import("../wallet/connectors");
    const walletConnector = connectors.createConnector({
      id: "walletconnect",
      name: "WalletConnect",
      source: "walletconnect",
      available: true,
      preferred: true
    });

    const session = await walletConnector.connect();

    expect(universalConnectSpy).not.toHaveBeenCalled();
    expect(session.address).toBe("0x2222222222222222222222222222222222222222");
  });

  it("clears only WalletConnect storage during schema migration", async () => {
    window.localStorage.setItem("hlclear.state.v1", "{\"settings\":{\"address\":\"0xabc\"}}");
    window.localStorage.setItem("wc@2:client", "stale");
    window.localStorage.setItem("reown-store", "stale");
    window.sessionStorage.setItem("walletconnect-temp", "stale");

    const connectors = await import("../wallet/connectors");
    connectors.runWalletConnectSchemaMigration();

    expect(window.localStorage.getItem("hlclear.state.v1")).toBe("{\"settings\":{\"address\":\"0xabc\"}}");
    expect(window.localStorage.getItem("wc@2:client")).toBeNull();
    expect(window.localStorage.getItem("reown-store")).toBeNull();
    expect(window.sessionStorage.getItem("walletconnect-temp")).toBeNull();
    expect(window.localStorage.getItem("hlclear.walletConnectionSchemaVersion")).toBe("2");
  });

  it("resets a broken session and disconnects the singleton connector", async () => {
    universalInitSpy.mockResolvedValue(buildMockConnector());
    window.localStorage.setItem("walletconnect", "broken");

    const connectors = await import("../wallet/connectors");
    await connectors.prepareWalletConnectConnector();
    await connectors.resetWalletConnectStorageAndConnector();

    expect(universalDisconnectSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("walletconnect")).toBeNull();
    expect(window.localStorage.getItem("hlclear.walletConnectionSchemaVersion")).toBe("2");
  });

  it("registers the public WalletConnect events during initialization", async () => {
    universalInitSpy.mockResolvedValue(buildMockConnector());

    const connectors = await import("../wallet/connectors");
    await connectors.prepareWalletConnectConnector();

    expect(providerOnSpy.mock.calls.map(([eventName]) => eventName)).toEqual(
      expect.arrayContaining(["display_uri", "session_proposal", "session_request", "session_update", "session_delete", "session_expire"])
    );
  });
});
