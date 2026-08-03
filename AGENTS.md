# AGENTS.md

## Reglas esenciales

- HLClear es una PWA de solo lectura.
- No implementar ordenes, firma, wallet connection, claves privadas, depositos, retiradas, copy trading ni automatizacion.
- No introducir builder codes ni builder fees propios.
- Si aparece `builderFee` historico en datos, mostrarlo por separado y no mezclarlo con la tarifa de Hyperliquid.
- Hablar exclusivamente con endpoints oficiales de Hyperliquid.
- No anadir proxy ni backend silencioso si falla CORS o una politica de navegador.
- Guardar la direccion publica unicamente en el dispositivo.
- Usar `decimal.js` para calculos monetarios criticos.
- No usar `Number` para reconciliacion ni costes de trading.
- No ocultar discrepancias por redondeo.
- Etiquetar cualquier calculo estimado.
- Marcar como grises los estados con datos insuficientes, fees no convertibles o snapshots desactualizados.
- Mantener la interfaz en espanol y mobile-first.
- Priorizar accesibilidad, contraste y explicaciones explicitas.
