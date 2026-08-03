(() => {
  const root = document.getElementById("root");
  const CACHE_RESET_PARAM = "cache-reset";
  const STARTUP_TIMEOUT_MS = 3000;

  function renderStartupError(title, message) {
    if (!root || window.__hlclearBooted) {
      return;
    }

    root.innerHTML =
      '<main style="font-family: system-ui, sans-serif; padding: 24px; color: #e5e7eb; background: #0f172a; min-height: 100vh;">' +
      '<section style="max-width: 32rem; margin: 0 auto; background: #111827; border: 1px solid #374151; border-radius: 16px; padding: 20px;">' +
      `<h1 style="margin: 0 0 12px; font-size: 1.25rem;">${title}</h1>` +
      `<p style="margin: 0 0 12px; line-height: 1.5;">${message}</p>` +
      '<p style="margin: 0; line-height: 1.5;">Si el problema persiste, recarga la pagina para actualizar los archivos publicados.</p>' +
      "</section>" +
      "</main>";
  }

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement) {
        renderStartupError("Error al cargar la aplicacion", "No se pudo descargar el bundle inicial.");
        return;
      }

      renderStartupError("Error al iniciar la aplicacion", "Se produjo una excepcion antes de que React pudiera mostrarse.");
    },
    true
  );

  window.addEventListener("unhandledrejection", () => {
    renderStartupError("Error al iniciar la aplicacion", "Se produjo un fallo no controlado durante el arranque.");
  });

  void cleanupStaleClients();

  window.setTimeout(() => {
    if (!root || window.__hlclearBooted) {
      return;
    }

    renderStartupError(
      "Error al iniciar la aplicacion",
      "La interfaz no ha terminado de arrancar en este navegador."
    );
  }, STARTUP_TIMEOUT_MS);

  async function cleanupStaleClients() {
    try {
      let changed = false;

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(async (registration) => {
            const scope = registration.scope ?? "";
            const scriptUrl =
              registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? "";

            if (scope.includes("/hlclear/") || scriptUrl.includes("/hlclear/")) {
              changed = (await registration.unregister()) || changed;
            }
          })
        );
      }

      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(
          cacheKeys.map(async (cacheKey) => {
            if (cacheKey.startsWith("hlclear-")) {
              changed = (await caches.delete(cacheKey)) || changed;
            }
          })
        );
      }

      if (!changed) {
        return;
      }

      const url = new URL(window.location.href);
      if (url.searchParams.get(CACHE_RESET_PARAM) === "1") {
        return;
      }

      url.searchParams.set(CACHE_RESET_PARAM, "1");
      window.location.replace(url.toString());
    } catch {
      renderStartupError(
        "Error al limpiar la caché",
        "El navegador mantiene archivos antiguos y no se ha podido forzar la recarga."
      );
    }
  }
})();
