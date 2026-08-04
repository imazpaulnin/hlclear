# HLClear

HLClear es una PWA instalable, mobile-first para iPhone y navegador moderno orientada a Hyperliquid.

La Fase 1 de auditoria de solo lectura queda congelada y protegida.

La Fase 2 redefine el producto como:

`Cliente movil de Hyperliquid con auditoria financiera completa y ejecucion manual de operaciones.`

## Alcance actual

### Fase 1 protegida

- Auditoria financiera de solo lectura.
- Reconciliacion transparente.
- Diagnostico raw de API y metodologia.
- Persistencia local de snapshots.

### Fase 2 permitida en documentacion y arquitectura

- Conexion de wallets compatibles con Hyperliquid.
- Firma local de ordenes.
- Envio de ordenes unicamente a Hyperliquid.
- Apertura, modificacion y cierre de posiciones.
- Cancelacion de ordenes.
- Gestion manual de TP y SL.
- Modo simulacion para probar interfaz sin enviar ordenes reales.

## Restricciones obligatorias

- Sin almacenamiento de claves privadas.
- Sin envio de claves privadas al servidor.
- Toda firma debe hacerse localmente.
- Sin backend custodio.
- Sin depositos ni retiradas.
- Sin automatizacion de trading.
- Sin bots.
- Sin copy trading automatico.
- Sin ejecucion automatica de estrategias.
- Sin ordenes sin confirmacion explicita del usuario.
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
- [docs/architecture.md](/C:/Users/imazp/Desktop/hyperliquid/docs/architecture.md): alcance y fronteras entre auditoria y ejecucion manual.
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
- Cualquier futura firma de ordenes debe ocurrir localmente en la wallet del usuario.
- Nunca se deben custodiar claves privadas.
- No hay backend propio.
- No hay secretos en el repositorio.
- No hay builder codes.
- No hay builder fees propios.
- No hay endpoints propios.
- La CSP se aplica via `<meta http-equiv="Content-Security-Policy">`.
- GitHub Pages no permite configurar todas las cabeceras HTTP avanzadas; esa limitacion esta documentada en el informe de seguridad.

Detalles:

- [Arquitectura](/C:/Users/imazp/Desktop/hyperliquid/docs/architecture.md)
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
