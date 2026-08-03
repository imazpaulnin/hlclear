# Informe de endpoints utilizados

## Endpoints oficiales Hyperliquid

- `POST /info` con `type: "clearinghouseState"`
- `POST /info` con `type: "portfolio"`
- `POST /info` con `type: "userFillsByTime"`
- `POST /info` con `type: "userFunding"`
- `POST /info` con `type: "userNonFundingLedgerUpdates"`
- `POST /info` con `type: "userFees"`
- `POST /info` con `type: "metaAndAssetCtxs"`
- `POST /info` con `type: "openOrders"`

## Redes

- Mainnet: `https://api.hyperliquid.xyz`
- Testnet: `https://api.hyperliquid-testnet.xyz`

## Paginacion

Los endpoints historicos se paginan por `startTime` usando el ultimo `time` recibido como siguiente cursor.

Restricciones oficiales relevantes:

- `userFillsByTime`: hasta `2000` fills por respuesta.
- `userFillsByTime`: solo los `10000` fills mas recientes estan disponibles.

Limite defensivo actual en la app:

- hasta `64` paginas internas por tipo de historico en una sincronizacion.

Si se alcanza un limite oficial o interno, el periodo se marca como incompleto y no se presenta como exacto.

## CORS

La verificacion practica desde navegador debe realizarse sobre la PWA levantada en `localhost` o ya publicada, porque la viabilidad real depende de la politica CORS efectiva del endpoint y del navegador.

## Validacion practica de esta auditoria

Se verifico desde navegador real que los ocho payloads de solo lectura devuelven `HTTP 200` y JSON valido tanto en:

- `https://api.hyperliquid.xyz/info`
- `https://api.hyperliquid-testnet.xyz/info`

No se uso `POST /exchange`, no se enviaron ordenes y no se solicito ninguna wallet.
