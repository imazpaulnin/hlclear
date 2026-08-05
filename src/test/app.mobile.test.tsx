import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/App";

const walletEnvironmentMocks = vi.hoisted(() => ({
  isIosStandaloneWebAppMock: vi.fn(() => false)
}));

vi.mock("../wallet/walletEnvironment", async () => {
  const actual = await vi.importActual<typeof import("../wallet/walletEnvironment")>("../wallet/walletEnvironment");
  return {
    ...actual,
    isIosStandaloneWebApp: walletEnvironmentMocks.isIosStandaloneWebAppMock
  };
});

describe("mobile-first shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    walletEnvironmentMocks.isIosStandaloneWebAppMock.mockReturnValue(false);

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true
    });

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      }
    });
  });

  it("renders five primary navigation items without legacy abbreviations", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /Resumen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Operar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Posiciones/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Historial/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mas$/i })).toBeInTheDocument();

    expect(screen.queryByText("RS")).not.toBeInTheDocument();
    expect(screen.queryByText("PS")).not.toBeInTheDocument();
    expect(screen.queryByText("HS")).not.toBeInTheDocument();
    expect(screen.queryByText("MV")).not.toBeInTheDocument();
  });

  it("opens the trade preparation tab", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Operar/i }));

    expect(screen.getByRole("heading", { name: /Operar/i })).toBeInTheDocument();
    expect(screen.getByText(/Ejecucion manual en navegador/i)).toBeInTheDocument();
    expect(screen.getByText(/TESTNET habilitado/i)).toBeInTheDocument();
  });

  it("groups secondary destinations under Mas", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));

    expect(screen.getByRole("button", { name: /Movimientos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wallet.*Conexion por Rabby, MetaMask o WalletConnect\./i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Debug/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diagnostico API/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajustes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Metodologia/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Borrar datos locales/i })).toBeInTheDocument();
  });

  it("renders the wallet connection screen from Mas", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Wallet.*Conexion por Rabby, MetaMask o WalletConnect\./i }));

    expect(screen.getByRole("heading", { name: /^Wallet$/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Estado de conexion$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Conectar wallet$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conectar WalletConnect/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Desconectar/i })).toBeInTheDocument();
    expect(screen.getByText(/Direccion auditada/i)).toBeInTheDocument();
  });

  it("shows the Safari escape hatch for installed iPhone web apps", async () => {
    walletEnvironmentMocks.isIosStandaloneWebAppMock.mockReturnValue(true);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Wallet.*Conexion por Rabby, MetaMask o WalletConnect\./i }));

    expect(screen.getByText(/Modo web app de iPhone detectado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Abrir esta pagina en Safari/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Conectar WalletConnect/i })).not.toBeInTheDocument();
  });

  it("renders the wallet debug screen from Mas", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Debug.*Diagnostico local de wallet y WalletConnect\./i }));

    expect(screen.getByRole("heading", { name: /Debug wallet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copiar diagnostico/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Limpiar estado de conexion/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Informe JSON/i })).toBeInTheDocument();
  });

  it("shows simplified basic settings first and keeps advanced options collapsed", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ajustes/i }));

    expect(screen.getByLabelText(/Direccion publica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Entorno/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guardar y sincronizar/i })).toBeDisabled();
    expect(screen.getByText(/Ultima sincronizacion/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opciones avanzadas/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/Slippage estimado/i)).not.toBeInTheDocument();
  });

  it("opens advanced settings on demand", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));
    fireEvent.click(screen.getByRole("button", { name: /Ajustes/i }));
    fireEvent.click(screen.getByRole("button", { name: /Opciones avanzadas/i }));

    expect(screen.getByRole("button", { name: /Opciones avanzadas/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Slippage estimado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activar auditoria local/i })).toBeInTheDocument();
  });
});
