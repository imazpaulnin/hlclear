import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletConnection } from "../wallet/useWalletConnection";

const walletMocks = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  resetStateMock: vi.fn().mockResolvedValue(undefined)
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
  createConnector: vi.fn(() => ({
    id: "rabby",
    name: "Rabby",
    source: "eip6963",
    connect: walletMocks.connectMock,
    disconnect: walletMocks.disconnectMock
  })),
  runLegacyWalletSchemaMigration: vi.fn(),
  resetLegacyWalletState: walletMocks.resetStateMock
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
      <button type="button" onClick={() => void wallet.connectWith("rabby")}>
        conectar
      </button>
      <button type="button" onClick={() => void wallet.resetWalletState()}>
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
      connectorId: "rabby",
      connectorName: "Rabby",
      source: "eip6963",
      address: "0x3333333333333333333333333333333333333333",
      chainId: "0xa4b1",
      provider: {}
    });

    render(<Harness auditAddress="0x3333333333333333333333333333333333333333" />);
    await waitFor(() => expect(screen.getByTestId("wallet-count").textContent).toBe("1"));
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));

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
    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));

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

    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("error"));

    fireEvent.click(screen.getByRole("button", { name: /conectar/i }));
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
});
