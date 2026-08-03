# Informe de seguridad

## Medidas aplicadas

- Sin backend propio.
- Sin secretos en cliente.
- Sin claves privadas.
- Sin wallet conectada.
- Sin telemetria ni analitica.
- Sin publicidad.
- Sin servicios de terceros distintos de los endpoints oficiales de Hyperliquid.
- Content Security Policy en [index.html](/C:/Users/imazp/Desktop/hyperliquid/index.html).
- Service worker limitado al shell estatico y recursos del mismo origen.
- Persistencia local solo para direccion publica, ajustes y ultimo snapshot.

## CSP aplicada

La CSP permite:

- `connect-src` solo a:
  - `https://api.hyperliquid.xyz`
  - `https://api.hyperliquid-testnet.xyz`
  - `wss://api.hyperliquid.xyz`
  - `wss://api.hyperliquid-testnet.xyz`

La app bloquea:

- `form-action` externo
- `object-src`
- `frame-ancestors`
- recursos inseguros

## Cabeceras y limitaciones de GitHub Pages

GitHub Pages sirve contenido estatico y no ofrece una forma nativa de configurar todas las cabeceras HTTP de seguridad avanzadas por ruta, como `Strict-Transport-Security`, `X-Frame-Options` o `Permissions-Policy`.

Por ello:

- se aplica CSP por meta tag;
- la app evita iframes, formularios y scripts externos;
- la superficie de ataque queda reducida al minimo compatible con hosting gratuito y estatico.

Si en una fase futura fuese imprescindible controlar cabeceras a nivel servidor, habria que evaluar antes una alternativa sin coste recurrente.

## Comprobaciones automaticas

El script [scripts/check-security.mjs](/C:/Users/imazp/Desktop/hyperliquid/scripts/check-security.mjs) falla si detecta:

- builder codes o builder fee propio;
- menciones a claves privadas o secretos;
- Firebase o Supabase;
- endpoints externos ajenos a Hyperliquid.

Ademas, la implementacion actual de red solo construye payloads de lectura para `POST /info` y no contiene ninguna llamada a `POST /exchange`.
