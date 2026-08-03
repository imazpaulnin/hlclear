import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../ui/App";

describe("mobile-first shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();

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

  it("renders four primary navigation items without legacy abbreviations", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: /Resumen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Posiciones/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Historial/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mas$/i })).toBeInTheDocument();

    expect(screen.queryByText("RS")).not.toBeInTheDocument();
    expect(screen.queryByText("PS")).not.toBeInTheDocument();
    expect(screen.queryByText("HS")).not.toBeInTheDocument();
    expect(screen.queryByText("MV")).not.toBeInTheDocument();
  });

  it("groups secondary destinations under Mas", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Mas$/i }));

    expect(screen.getByRole("button", { name: /Movimientos/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diagnostico API/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajustes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Metodologia/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Borrar datos locales/i })).toBeInTheDocument();
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
