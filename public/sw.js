const CACHE_NAME = "hlclear-shell-v2";
const STATIC_EXTENSIONS = [".js", ".css", ".png", ".svg", ".ico", ".webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["./", "./index.html", "./manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve(true);
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (!shouldCache(requestUrl)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then((response) => {
          if (!response.ok || response.type === "opaque") {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

function shouldCache(requestUrl) {
  if (
    requestUrl.pathname.endsWith("/") ||
    requestUrl.pathname.endsWith("/index.html") ||
    requestUrl.pathname.endsWith("/manifest.webmanifest") ||
    requestUrl.pathname.endsWith("/sw.js")
  ) {
    return true;
  }

  return STATIC_EXTENSIONS.some((extension) => requestUrl.pathname.endsWith(extension));
}
