# Informe de metodologia financiera

## Principios

- Todos los calculos monetarios criticos usan `decimal.js`.
- Se conserva el valor original recibido de la API como `string`.
- Se separa siempre:
  - valor original recibido;
  - valor exacto derivado;
  - valor redondeado para mostrar.
- Ninguna discrepancia desaparece por redondeo.

## Campos raw conservados

- `rawClosedPnl`: suma exacta de `userFillsByTime[].closedPnl`.
- `rawFee`: suma exacta de `userFillsByTime[].fee`, conservando exactamente su signo.
- `rawBuilderFeeIncluded`: suma informativa de `userFillsByTime[].builderFee`.
- `rawFunding`: suma exacta de `userFunding`.

`builderFee` se trata como subconjunto de `fee`, nunca como coste adicional independiente.

Convencion de signos:

- `rawFee > 0`: comision cobrada al usuario.
- `rawFee < 0`: rebate recibido.
- `rawFee = 0`: sin comision.

## Semantica de `closedPnl`

La app no asume automaticamente que `closedPnl` excluya o incluya `fee`.

Se manejan tres modos:

- `includes_fee`: solo cuando la muestra permite demostrarlo.
- `excludes_fee`: reservado para el caso de demostracion contraria.
- `unverified`: estado conservador por defecto cuando la muestra real no permite probar la semantica con certeza.

Mientras la semantica sea `unverified`:

- no se promueve `closedPnl` como "P&L bruto exacto";
- el semaforo global permanece gris si esa ambiguedad afecta al resultado;
- `netPnlDerived` se muestra como no verificado.

## Reconciliacion

- Resultado patrimonial ajustado = `accountValue + retiradas externas - depositos externos`.
- Otros ajustes identificados = creditos y debitos del ledger clasificados de forma explicita.
- `grossTradingPnl`:
  - si `includes_fee`: `rawClosedPnl + rawFee`
  - si `excludes_fee`: `rawClosedPnl`
  - si `unverified`: no se declara como exacto
- `netPnlDerived`:
  - si `includes_fee`: `rawClosedPnl + rawFunding + unrealizedPnl + otros ajustes`
  - si `excludes_fee`: `rawClosedPnl - rawFee + rawFunding + unrealizedPnl + otros ajustes`
  - si `unverified`: no verificado
- Diferencia de reconciliacion = `accountValueAdjustedResult - netPnlDerived`

Solo puede marcarse como reconciliacion verificada cuando:

- la semantica `closedPnl` frente a `fee` esta demostrada;
- la cobertura temporal es completa para el periodo solicitado;
- no existen movimientos desconocidos del ledger;
- la diferencia absoluta es `<= 0,01 USDC`.

## Estimaciones oficiales de portfolio

`portfolio.pnlHistory` no se usa como contabilidad exacta.

La interfaz lo etiqueta unicamente como:

- `Estimacion oficial 24 h`
- `Estimacion oficial 7 dias`
- `Estimacion oficial 30 dias`

## Cobertura temporal

La app muestra:

- `requestedStartTime`
- `actualEarliestTimestamp`
- `actualLatestTimestamp`
- `fillsDownloaded`
- `fundingEntriesDownloaded`
- `ledgerEntriesDownloaded`
- `reachedApiLimit`
- `reachedInternalPageLimit`
- `isCompleteForRequestedPeriod`
- `reasonIfIncomplete`

Si el periodo es incompleto:

- el estado global se vuelve gris;
- no se presenta el resultado como exacto;
- la exportacion se advierte como parcial.

## Semaforo de rentabilidad real

Para posiciones abiertas:

- P&L no realizado actual.
- `rawClosedPnl` atribuido al ciclo.
- comisiones ya pagadas en USDC.
- `builderFee` historico como desglose informativo.
- funding atribuible al ciclo.
- comision estimada de cierre sobre el nominal restante.
- resultado neto si se cerrase ahora.
- resultado conservador con slippage estimado.

Estados:

- Rojo: `Perdida bruta`.
- Naranja: `Bruto positivo, neto negativo`.
- Verde: `Beneficio neto`.
- Gris: `Equilibrio o datos insuficientes`.

## Fees no USDC

Cuando `feeToken` no es `USDC`:

- se muestra por separado;
- no se convierte silenciosamente a USD;
- puede forzar estado gris si compromete la fiabilidad neta.
