# HLClear

HLClear es una PWA instalable, mobile-first y de solo lectura para consultar y reconciliar de forma transparente una cuenta de Hyperliquid desde iPhone o navegador moderno, sin App Store, sin Apple Developer Program y sin backend propio.

## Alcance de esta fase

- Solo lectura.
- Sin envio de ordenes.
- Sin firma de wallet.
- Sin almacenamiento de claves.
- Sin depositos ni retiradas.
- Sin copy trading.
- Sin automatizacion.
- Sin builder code.
- Sin builder fee propio.
- Sin telemetria.
- Sin analitica.
- Sin publicidad.
- Sin Firebase.
- Sin Supabase.
- Sin servicios de pago.

## Stack principal

- React.
- TypeScript `strict`.
- Vite.
- PWA con `manifest.webmanifest`.
- Service Worker propio.
- `display: standalone`.
- `decimal.js` para calculos monetarios.

## Estructura

- [src/ui/App.tsx](/C:/Users/imazp/Desktop/hyperliquid/src/ui/App.tsx): shell principal y pestanas.
- [src/data/hyperliquidApi.ts](/C:/Users/imazp/Desktop/hyperliquid/src/data/hyperliquidApi.ts): acceso directo a la API oficial.
- [src/domain/dashboard.ts](/C:/Users/imazp/Desktop/hyperliquid/src/domain/dashboard.ts): reconciliacion, resumen y semaforo de rentabilidad.
- [src/domain/cycles.ts](/C:/Users/imazp/Desktop/hyperliquid/src/domain/cycles.ts): ciclos de posicion, ampliaciones y cierres parciales.
- [public/manifest.webmanifest](/C:/Users/imazp/Desktop/hyperliquid/public/manifest.webmanifest): manifest PWA.
- [public/sw.js](/C:/Users/imazp/Desktop/hyperliquid/public/sw.js): service worker.
- [.github/workflows/deploy-pages.yml](/C:/Users/imazp/Desktop/hyperliquid/.github/workflows/deploy-pages.yml): despliegue automatico a GitHub Pages.
- [reference](/C:/Users/imazp/Desktop/hyperliquid/reference): referencia archivada del prototipo SwiftUI anterior.

## Requisitos locales

- Node.js 24 o compatible.
- npm.

## Desarrollo local

```bash
npm install
npm run dev
```

La app queda disponible en `http://127.0.0.1:4173/`.

## Validacion local

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Instalacion en iPhone

1. Publica la PWA en GitHub Pages.
2. Abre la URL en Safari en iPhone con iOS 17 o posterior.
3. Pulsa `Compartir`.
4. Pulsa `Anadir a pantalla de inicio`.
5. Abre `HLClear` desde el icono.

La app se abrira en modo `standalone`, sin barra del navegador, como aplicacion a pantalla completa.

## Funcionamiento offline

Con conexion:

- Consulta directamente los endpoints oficiales de Hyperliquid.
- Guarda el ultimo snapshot en el dispositivo.
- Permite refresco manual.

Sin conexion:

- Sigue abriendo la interfaz.
- Muestra el ultimo snapshot guardado.
- Etiqueta los datos como desactualizados.
- Indica fecha y hora de la ultima sincronizacion.
- No presenta los datos como tiempo real.

## Base path para GitHub Pages

El `base` de Vite se resuelve automaticamente:

- Si existe `VITE_BASE_PATH`, se usa ese valor.
- Si el build se ejecuta en GitHub Actions, se usa el nombre del repositorio de `GITHUB_REPOSITORY`.
- En local se usa `/`.

Esto permite publicar en `https://usuario.github.io/nombre-del-repo/` sin depender de un dominio propio.

## Publicacion exacta con GitHub Free

1. Crea un repositorio GitHub, publico o privado.
2. Sube este proyecto a la rama `main`.
3. En GitHub, ve a `Settings > Pages`.
4. En `Build and deployment`, elige `GitHub Actions`.
5. Haz push a `main`.
6. El workflow [deploy-pages.yml](/C:/Users/imazp/Desktop/hyperliquid/.github/workflows/deploy-pages.yml) ejecutara tests, typecheck, comprobacion de seguridad y build.
7. GitHub Pages publicara el contenido estatico de `dist`.

No hace falta dominio personalizado, Apple Developer Program, TestFlight ni ninguna suscripcion.

## Actualizacion en iPhone

- Haz push a `main`.
- GitHub Pages despliega la nueva version.
- El service worker actualizara el shell de la app.
- Si Safari mantiene contenido antiguo, cierra y reabre la app desde pantalla de inicio o usa el gesto de recarga en Safari antes de volver a instalar.

## Seguridad

- La direccion publica se introduce desde la interfaz y se guarda solo en el dispositivo.
- No hay backend propio.
- No hay secretos en el repositorio.
- No hay builder codes.
- No hay builder fees propios.
- No hay endpoints propios.
- La CSP se aplica via `<meta http-equiv="Content-Security-Policy">`.
- GitHub Pages no permite configurar todas las cabeceras HTTP avanzadas; esa limitacion esta documentada en el informe de seguridad.

Detalles:

- [Informe de seguridad](/C:/Users/imazp/Desktop/hyperliquid/docs/reports/security.md)
- [Informe de metodologia financiera](/C:/Users/imazp/Desktop/hyperliquid/docs/reports/financial-methodology.md)
- [Informe de endpoints](/C:/Users/imazp/Desktop/hyperliquid/docs/reports/endpoints.md)

## Endpoints oficiales usados

- `clearinghouseState`
- `portfolio`
- `userFillsByTime`
- `userFunding`
- `userNonFundingLedgerUpdates`
- `userFees`
- `metaAndAssetCtxs`
- `openOrders`

## Limitacion del despliegue en esta maquina

Puedo preparar todo el proyecto, ejecutar build y tests locales y dejar GitHub Pages configurado, pero la publicacion real depende de disponer de un repositorio GitHub remoto y permisos para hacer push desde esta maquina. Si ese contexto no existe, el workflow queda listo para activarse en cuanto el repo se suba a GitHub.
