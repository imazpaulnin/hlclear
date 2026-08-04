# AGENTS.md

## Reglas esenciales

- La Fase 1 de auditoria de solo lectura queda congelada y protegida. No degradar, eliminar ni simplificar ninguna capacidad de auditoria ya existente.
- HLClear entra en Fase 2 con el siguiente alcance: cliente movil de Hyperliquid con auditoria financiera completa y ejecucion manual de operaciones.
- Capacidades permitidas exclusivamente en Fase 2:
  - conexion de wallets compatibles con Hyperliquid;
  - firma local de ordenes;
  - envio de ordenes unicamente a Hyperliquid;
  - apertura, modificacion y cierre de posiciones;
  - cancelacion de ordenes;
  - gestion manual de TP y SL.
- Wallets permitidas: WalletConnect, Rabby y MetaMask.
- No implementar depositos ni retiradas.
- No introducir builder codes ni builder fees propios.
- Si aparece `builderFee` historico en datos, mostrarlo por separado y no mezclarlo con la tarifa de Hyperliquid.
- Hablar exclusivamente con endpoints oficiales de Hyperliquid.
- No anadir proxy ni backend silencioso si falla CORS o una politica de navegador.
- Guardar la direccion publica unicamente en el dispositivo.
- Nunca almacenar claves privadas.
- Nunca enviar claves privadas al servidor.
- Toda firma debe hacerse localmente.
- Sin backend custodio.
- Sin automatizacion de trading.
- Sin bots.
- Sin copy trading automatico.
- Sin ejecucion automatica de estrategias.
- Sin ordenes sin confirmacion explicita del usuario.
- Usar `decimal.js` para calculos monetarios criticos.
- No usar `Number` para reconciliacion ni costes de trading.
- No ocultar discrepancias por redondeo.
- Etiquetar cualquier calculo estimado.
- Marcar como grises los estados con datos insuficientes, fees no convertibles o snapshots desactualizados.
- Mantener la interfaz en espanol y mobile-first.
- Priorizar accesibilidad, contraste y explicaciones explicitas.
