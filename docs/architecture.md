# Arquitectura

## Alcance actual

HLClear se divide en dos capas que deben convivir:

- Fase 1: auditoria financiera de solo lectura, congelada y protegida.
- Fase 2: ejecucion manual de operaciones en Hyperliquid desde cliente movil, sin custodia de claves y sin automatizacion.

La filosofia del proyecto es:

`Cliente movil de Hyperliquid con auditoria financiera completa y ejecucion manual de operaciones.`

## Principios de arquitectura

- Cliente-first: la PWA habla directamente con endpoints oficiales de Hyperliquid.
- Sin backend custodio: no se introduce un servidor que firme, custodie o reemita ordenes por cuenta del usuario.
- Firma local: cualquier firma de ordenes debe ocurrir en el dispositivo del usuario mediante wallet compatible.
- Auditoria protegida: la capa de trading no puede romper, ocultar ni degradar la auditoria de Fase 1.
- Confirmacion explicita: ninguna orden se envia sin confirmacion clara del usuario.
- Transparencia de costes: nocional, fees, slippage, funding y break-even deben mostrarse antes de confirmar.

## Capas funcionales

### 1. Capa de auditoria

Responsabilidad:

- lectura de balances, fills, funding, ledger y estados de cuenta;
- reconciliacion financiera;
- diagnostico raw;
- persistencia local de snapshots;
- UI de auditoria y metodologia.

Restriccion:

- esta capa queda congelada funcionalmente salvo correcciones, compatibilidad y mantenimiento.

### 2. Capa de ejecucion manual

Responsabilidad futura:

- conexion de wallet;
- firma local de ordenes;
- apertura, modificacion y cierre de posiciones;
- cancelacion de ordenes;
- gestion manual de TP y SL;
- modo simulacion para probar UI sin enviar ordenes reales.

Restricciones:

- solo Hyperliquid;
- sin claves privadas en almacenamiento local persistente;
- sin envio de claves privadas;
- sin bots;
- sin copy trading automatico;
- sin estrategias automaticas;
- sin ejecucion sin confirmacion del usuario.

## Fronteras tecnicas

### Datos oficiales

- Los datos de auditoria y trading deben proceder unicamente de endpoints oficiales de Hyperliquid.

### Estado local

- Se permite guardar configuracion local, direccion publica, snapshots de auditoria y preferencias de interfaz.
- No se permite guardar claves privadas, seed phrases ni material sensible equivalente.

### Wallets soportadas

- WalletConnect
- MetaMask
- Rabby

## Estrategia de convivencia entre Fase 1 y Fase 2

- La navegacion debe mantener visible y accesible toda la auditoria existente.
- La nueva capa de trading debe añadirse como modulo paralelo, no como reemplazo del shell actual.
- Los calculos de PnL bruto, PnL neto, fees y funding deben reutilizar la logica financiera existente siempre que sea coherente.
- Cualquier nueva UI de trading debe seguir siendo mobile-first y optimizada para iPhone.

## Fuera de alcance

- backend custodio;
- almacenamiento de claves privadas;
- depositos y retiradas;
- copy trading automatico;
- bots;
- automatizacion de estrategias;
- ordenes sin confirmacion del usuario;
- integraciones con exchanges distintos de Hyperliquid.
