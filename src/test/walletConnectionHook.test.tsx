import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletConnection } from "../wallet/useWalletConnection";

const walletMocks = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  resetConnectorMock: vi.fn().mockResolvedValue(undefined),
  resetStorageMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../wallet/injectedWallets", () => ({
  discoverInjectedWallets: vi.fn().mockResolvedValue([])
}));

vi.mock("../wallet/connectors", () => ({
  createConnector: vi.fn(() => ({
    id: "walletconnect",
    name: "WalletConnect",
    source: "walletconnect",
    connect: walletMocks.connectMock,
    disconnect: walletMocks.disconnectMock
  })),
  getWalletConnectDiagnosticsSnapshot: vi.fn(() => ({ ok: true })),
  prepareWalletConnectConnector: vi.fn().mockResolvedValue({}),
  resetWalletConnectConnector: walletMocks.resetConnectorMock,
  resetWalletConnectStorageAndConnector: walletMocks.resetStorageMock
}));

function Harness({ auditAddress }: { auditAddress: string }) {
  const wallet = useWalletConnection(auditAddress);

  return (
    <div>
      <div data-testid="status">{wallet.state.status}</div>
      <div data-testid="address">{wallet.state.address ?? ""}</div>
      <div data-testid="match">{String(wallet.auditAddressMatches)}</div>
      <div data-testid="warning">{wallet.mismatchWarning ?? ""}</div>
      <button type="button" onClick={() => void wallet.connectWith("walletconnect")}>
        conectar
      </button>
      <button type="button" onClick={() => void wallet.resetWalletConnectState()}>
        reset
      </button>
    </div>
  );
}

describe("useWalletConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("compares the returned address with the audited address", async () => {
    walletMocks.connectMock.mockResolvedValue({
      connectorId: "walletconnect",
      connectorName: "WalletConnect",
      source: "walletconnect",
      address: "0x3333333333333333333333333333333333333333",
      chainId: "0xa4b1",
      provider: {}
    });

    render(<Harness auditAddress="0x3333333333333333333333333333333333333333" />);
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("match").textContent).toBe("true");
    expect(screen.getByTestId("warning").textContent).toBe("");
  });

  it("shows a visible mismatch warning when wallet and audited address differ", async () => {
    walletMocks.connectMock.mockResolvedValue({
      connectorId: "walletconnect",
      connectorName: "WalletConnect",
      source: "walletconnect",
      address: "0x4444444444444444444444444444444444444444",
      chainId: "0xa4b1",
      provider: {}
    });

    render(<Harness auditAddress="0x5555555555555555555555555555555555555555" />);
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("match").textContent).toBe("false");
    expect(screen.getByTestId("warning").textContent).toMatch(/no coincide/i);
  });

  it("does not stay blocked after cancel and allows a second successful attempt", async () => {
    walletMocks.connectMock
      .mockRejectedValueOnce(new Error("User rejected"))
      .mockResolvedValueOnce({
        connectorId: "walletconnect",
        connectorName: "WalletConnect",
        source: "walletconnect",
        address: "0x6666666666666666666666666666666666666666",
        chainId: "0xa4b1",
        provider: {}
      });

    render(<Harness auditAddress="0x6666666666666666666666666666666666666666" />);

    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));
    expect(walletMocks.resetConnectorMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("connected"));
    expect(screen.getByTestId("address").textContent).toBe("0x6666666666666666666666666666666666666666");
  });

  it("resets local WalletConnect state without touching the rest of the app", async () => {
    render(<Harness auditAddress="0x7777777777777777777777777777777777777777" />);

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => expect(walletMocks.resetStorageMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("status").textContent).toBe("disconnected");
  });
});
