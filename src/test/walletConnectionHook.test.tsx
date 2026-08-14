import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletConnection } from "../wallet/useWalletConnection";

const walletMocks = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  resetStateMock: vi.fn().mockResolvedValue(undefined)
}));

const walletEnvironmentMocks = vi.hoisted(() => ({
  isIosSafariMock: vi.fn(() => false),
  isIosStandaloneWebAppMock: vi.fn(() => false)
}));

vi.mock("../wallet/injectedWallets", () => ({
  discoverInjectedWallets: vi.fn().mockResolvedValue([
    {
      id: "rabby",
      name: "Rabby",
      source: "eip6963",
      available: true,
      preferred: true,
      provider: {}
    }
  ])
}));

vi.mock("../wallet/connectors", () => ({
  buildWalletConnectOption: vi.fn(() => ({
    id: "walletconnect",
    name: "WalletConnect",
    source: "walletconnect",
    available: true,
    preferred: false
  })),
  createConnector: vi.fn((option, _debug, onUri) => ({
    id: option.id,
    name: option.name,
    source: option.source,
    connect: async () => {
      if (option.id === "walletconnect") {
        onUri?.("wc:test-topic@2?relay-protocol=irn&symKey=test");
      }
      return walletMocks.connectMock();
    },
    disconnect: walletMocks.disconnectMock
  })),
  runLegacyWalletSchemaMigration: vi.fn(),
  resetLegacyWalletState: walletMocks.resetStateMock
}));

vi.mock("../wallet/walletConfig", () => ({
  getWalletConnectProjectId: vi.fn(() => "b56e18d47c72ab683b10814fe9495694"),
  maskWalletConnectProjectId: vi.fn(() => "b56e18…5694"),
  getWalletConnectCanonicalUrl: vi.fn(() => "https://imazpaulnin.github.io/hlclear/"),
  getWalletConnectOrigin: vi.fn(() => "https://imazpaulnin.github.io"),
  getWalletConnectRpcMap: vi.fn(() => ({ 1: "https://cloudflare-eth.com", 42161: "https://arb1.arbitrum.io/rpc" })),
  getWalletConnectQrModalOptions: vi.fn(() => ({
    enableExplorer: false,
    enableMobileFullScreen: true,
    mobileWallets: [
      {
        id: "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1",
        name: "Rabby",
        links: {
          native: "rabby://"
        }
      },
      {
        id: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
        name: "MetaMask",
        links: {
          native: "metamask://",
          universal: "https://" + "metamask.app.link"
        }
      }
    ]
  })),
  getWalletMetadata: vi.fn(() => ({
    name: "HLClear",
    description: "Cliente movil de Hyperliquid con auditoria financiera y operativa manual.",
    url: "https://imazpaulnin.github.io/hlclear/",
    icons: ["https://imazpaulnin.github.io/hlclear/icons/icon-192.png"],
    redirect: { universal: "https://imazpaulnin.github.io/hlclear/" }
  })),
  validateWalletConnectProjectId: vi.fn(() => ({ valid: true, reasons: [] }))
}));

vi.mock("../wallet/walletEnvironment", () => ({
  isIosSafari: walletEnvironmentMocks.isIosSafariMock,
  isIosStandaloneWebApp: walletEnvironmentMocks.isIosStandaloneWebAppMock
}));

function Harness({ auditAddress }: { auditAddress: string }) {
  const wallet = useWalletConnection(auditAddress);

  return (
    <div>
      <div data-testid="wallet-count">{String(wallet.availableWallets.length)}</div>
      <div data-testid="status">{wallet.state.status}</div>
      <div data-testid="address">{wallet.state.address ?? ""}</div>
      <div data-testid="match">{String(wallet.auditAddressMatches)}</div>
      <div data-testid="warning">{wallet.mismatchWarning ?? ""}</div>
      <div data-testid="wc-uri">{wallet.state.walletConnectUri ?? ""}</div>
      <button type="button" onClick={() => void wallet.connectWith("rabby")}>
        conectar
      </button>
      <button type="button" onClick={() => void wallet.connectWith("walletconnect")}>
        conectar-walletconnect
      </button>
      <button type="button" onClick={() => void wallet.resetWalletState()}>
        reset
      </button>
      <button type="button" onClick={wallet.openWalletConnectInRabby}>
        abrir-rabby
      </button>
    </div>
  );
}

describe("useWalletConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletMocks.connectMock.mockReset();
    walletMocks.disconnectMock.mockReset();
    walletMocks.resetStateMock.mockReset().mockResolvedValue(undefined);
    window.localStorage.clear();
    walletEnvironmentMocks.isIosSafariMock.mockReturnValue(false);
    walletEnvironmentMocks.isIosStandaloneWebAppMock.mockReturnValue(false);
  });

  it("compares the returned address with the audited address", async () => {
    walletMocks.connectMock.mockResolvedValue({
      connectorId: "rabby",
      connectorName: "Rabby",
      source: "eip6963",
      address: "0x3333333333333333333333333333333333333333",
      chainId: "0xa4b1",
      provider: {}
    });

    render(<Harness auditAddress="0x3333333333333333333333333333333333333333" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /^conectar$/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("match").textContent).toBe("true");
    expect(screen.getByTestId("warning").textContent).toBe("");
  });

  it("shows a visible mismatch warning when wallet and audited address differ", async () => {
    walletMocks.connectMock.mockResolvedValue({
      connectorId: "rabby",
      connectorName: "Rabby",
      source: "eip6963",
      address: "0x4444444444444444444444444444444444444444",
      chainId: "0xa4b1",
      provider: {}
    });

    render(<Harness auditAddress="0x5555555555555555555555555555555555555555" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /^conectar$/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("match").textContent).toBe("false");
    expect(screen.getByTestId("warning").textContent).toMatch(/no coincide/i);
  });

  it("does not stay blocked after cancel and allows a second successful attempt", async () => {
    walletMocks.connectMock
      .mockRejectedValueOnce(new Error("User rejected"))
      .mockResolvedValueOnce({
        connectorId: "rabby",
        connectorName: "Rabby",
        source: "eip6963",
        address: "0x6666666666666666666666666666666666666666",
        chainId: "0xa4b1",
        provider: {}
      });

    render(<Harness auditAddress="0x6666666666666666666666666666666666666666" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: /^conectar$/i }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));

    fireEvent.click(screen.getByRole("button", { name: /^conectar$/i }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("address").textContent).toBe("0x6666666666666666666666666666666666666666");
  });

  it("resets only the local legacy wallet state", async () => {
    render(<Harness auditAddress="0x7777777777777777777777777777777777777777" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => expect(walletMocks.resetStateMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
  });

  it("captures the WalletConnect uri while connecting", async () => {
    walletMocks.connectMock.mockImplementation(
      () =>
        new Promise(() => {
          // Mantiene la conexion pendiente para validar la URI previa a la aprobacion.
        })
    );

    render(<Harness auditAddress="0x8888888888888888888888888888888888888888" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: /conectar-walletconnect/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connecting"));
    await waitFor(() =>
      expect(screen.getByTestId("wc-uri").textContent).toBe("wc:test-topic@2?relay-protocol=irn&symKey=test")
    );
  });

  it("allows the generic connection path inside the installed iPhone web app", async () => {
    walletEnvironmentMocks.isIosStandaloneWebAppMock.mockReturnValue(true);
    const { discoverInjectedWallets } = await import("../wallet/injectedWallets");
    vi.mocked(discoverInjectedWallets).mockResolvedValue([]);
    walletEnvironmentMocks.isIosSafariMock.mockReturnValue(true);
    walletMocks.connectMock.mockResolvedValue({
      connectorId: "walletconnect",
      connectorName: "WalletConnect",
      source: "walletconnect",
      address: "0x7777777777777777777777777777777777777777",
      chainId: "0xa4b1",
      provider: {}
    });

    function ConnectHarness() {
      const wallet = useWalletConnection("0x7777777777777777777777777777777777777777");

      return (
        <div>
          <div data-testid="status">{wallet.state.status}</div>
          <div data-testid="error">{wallet.state.error ?? ""}</div>
          <button type="button" onClick={() => void wallet.connect()}>
            conectar-generico
          </button>
        </div>
      );
    }

    render(<ConnectHarness />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("disconnected"));

    fireEvent.click(screen.getByRole("button", { name: /conectar-generico/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(walletMocks.connectMock).toHaveBeenCalledTimes(1);
  });
});
