const CURRENT_CACHE_NAMES = new Set(["hlclear-shell-v3"]);

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.origin);
    void reconcileServiceWorker(serviceWorkerUrl);
  });
}

async function reconcileServiceWorker(serviceWorkerUrl: URL): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();

  await Promise.all(
    registrations.map(async (registration) => {
      if (!isHLClearRegistration(registration, serviceWorkerUrl)) {
        return;
      }

      const registeredScriptUrl = getRegisteredScriptUrl(registration);
      if (registeredScriptUrl && registeredScriptUrl !== serviceWorkerUrl.href) {
        await registration.unregister();
      }
    })
  );

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(
      cacheKeys.map((cacheKey) => {
        if (cacheKey.startsWith("hlclear-shell-") && !CURRENT_CACHE_NAMES.has(cacheKey)) {
          return caches.delete(cacheKey);
        }
        return Promise.resolve(false);
      })
    );
  }

  const registration = await navigator.serviceWorker.register(serviceWorkerUrl.href);
  void registration.update();
}

function isHLClearRegistration(registration: ServiceWorkerRegistration, serviceWorkerUrl: URL): boolean {
  const scopePathname = safePathname(registration.scope);
  const scriptUrl = getRegisteredScriptUrl(registration);
  const scriptPathname = scriptUrl ? safePathname(scriptUrl) : "";
  const targetPathname = serviceWorkerUrl.pathname;

  return (
    scopePathname.includes("/hlclear/") ||
    scriptPathname.includes("/hlclear/") ||
    scopePathname === serviceWorkerUrl.pathname.replace(/sw\.js$/, "") ||
    scriptPathname === targetPathname
  );
}

function getRegisteredScriptUrl(registration: ServiceWorkerRegistration): string | undefined {
  return registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}
