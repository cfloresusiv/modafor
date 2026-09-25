# 🧪 Laboratorio de copy trading en pump.fun

Bot educativo que **copia las compras y ventas** de wallets de Solana en
[pump.fun](https://pump.fun). Está basado en la guía de QuickNode
[*Pump.fun copy trading bot*](https://www.quicknode.com/guides/solana-development/defi/pump-fun-copy-trade)
y se amplió para usarlo como laboratorio: tiene modos seguros para aprender
sin arriesgar dinero.

> ⚠️ **Esto es para aprender, no para ganar dinero.** La gran mayoría de los
> tokens de pump.fun pierden casi todo su valor. Al copiar, siempre llegas
> después que la wallet copiada y pagas un precio peor. Usa solo dinero que
> estés dispuesto a perder por completo.

## Cómo funciona

```
Wallet seguida opera en pump.fun
        │
        ▼
WebSocket (gratis) o gRPC (de pago) ──► el bot recibe la transacción
        │
        ▼
parser.js: ¿subió o bajó el saldo de un token de esa wallet?
        │            │
     COMPRA        VENTA
        │            │
        ▼            ▼
 guard.js: límites   ¿tengo ese token? → vender todo
        │
        ▼
 Metis arma la transacción → se SIMULA en la red → si pasa, se envía
```

| Modo | Qué hace | Qué necesitas | Riesgo |
|---|---|---|---|
| `observar` | Muestra en vivo lo que hacen las wallets | Endpoint de QuickNode | Ninguno |
| `simular` | Copia con **dinero ficticio** y calcula ganancias/pérdidas | Endpoint de QuickNode | Ninguno |
| `real` | Compra y vende de verdad | Endpoint + Metis + wallet con SOL | Pierdes lo que inviertes |

### Fuente de datos (`FUENTE`)

| `FUENTE` | Costo | Velocidad | Qué necesitas |
|---|---|---|---|
| `websocket` (por defecto) | Gratis, incluido en el endpoint | ~1–2 s después de la operación | `SOLANA_RPC` |
| `grpc` | Add-on de pago "Solana gRPC" | Milisegundos | `YELLOWSTONE_ENDPOINT` y `YELLOWSTONE_TOKEN` |

Buen punto para explicar: los bots profesionales pagan por velocidad, y por
eso entran antes que tú.

## Protecciones de seguridad

- **Wallet separada**: el bot usa una wallet nueva solo para él. Tu wallet
  principal nunca se toca.
- **Presupuesto máximo** (`MAX_TOTAL_SOL`): al llegar, deja de comprar.
  Se guarda en disco, así que reiniciar no lo resetea.
- **Reserva mínima** (`MIN_SOL_RESERVE`): nunca gasta el SOL que necesitas
  para las comisiones de las ventas.
- **Máximo de posiciones** (`MAX_OPEN_POSITIONS`) y nunca compra dos veces el
  mismo token.
- **Simulación previa**: cada transacción se simula en la red antes de
  enviarse. Si la simulación falla, no se envía nada.
- **Slippage máximo** (`SLIPPAGE_BPS`): si el precio se movió demasiado, la
  compra se rechaza en vez de pagar cualquier precio.
- La clave privada solo se lee del archivo `.env` (que git ignora) y nunca
  se muestra en pantalla ni en los registros.

## Instalación

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
git clone https://github.com/cfloresusiv/modafor.git
cd modafor
npm install
cp .env.example .env
```

### Cuenta de QuickNode

1. Crea una cuenta en [quicknode.com](https://www.quicknode.com) y un endpoint
   de **Solana Mainnet**.
2. En la pestaña *Overview* del endpoint copia la **HTTP Provider** URL en
   `SOLANA_RPC`. Con eso ya funcionan `observar` y `simular` (con `FUENTE=websocket`).
3. Solo para el modo `real`: en *Add-ons* instala **Metis Jupiter Swap API**
   (tiene plan gratuito) y copia su URL en `METIS_ENDPOINT`.
4. Opcional y de pago: el add-on **Solana gRPC** para `FUENTE=grpc`.

### Elegir wallets para seguir

Busca wallets activas en pump.fun en exploradores como
[gmgn.ai](https://gmgn.ai) o [solscan.io](https://solscan.io) y ponlas en
`WATCH_LIST` separadas por comas. Buen tema para la clase: una wallet con
muchas ganancias en el pasado no garantiza nada en el futuro.

## Plan de prueba recomendado

**1. Observar (sin riesgo)**

```bash
# en .env: MODE=observar
npm run check    # verifica la conexión
npm start        # Ctrl+C para detener
```

**2. Simular varios días (sin riesgo)**

```bash
# en .env: MODE=simular
npm start
```

Al detenerlo verás el resultado ficticio. Todo queda registrado en
`data/operaciones-simular.jsonl`. `SIM_DELAY_PENALTY_PCT` modela que llegas
tarde; prueba con 0, 5 y 15 para ver cómo cambia el resultado.

La simulación es **optimista**: no modela tokens que no se pueden vender,
transacciones fallidas ni rug pulls. Si en simulación pierde, en real
perderá más.

**3. Probar el modo real sin gastar**

1. En Phantom crea una cuenta nueva (*Agregar cuenta*) solo para el bot.
2. Exporta su clave privada (*Configuración → Cuenta → Mostrar clave
   privada*) y pégala en `SECRET_KEY` dentro de `.env`.
3. Envíale un poco de **SOL** (no USDC: pump.fun opera en SOL). Si solo
   tienes USDC, cámbialo por SOL en Phantom con el botón *Intercambiar*.
4. Ejecuta, con el mint de cualquier token activo de pump.fun:

```bash
# en .env: MODE=real
npm run check -- <MINT_DEL_TOKEN>
```

Esto pide la transacción de compra real y la simula en la red **sin
enviarla**. Si dice que la simulación pasó, todo está bien configurado.

**4. Real con poco**

Con valores pequeños, por ejemplo `BUY_AMOUNT_SOL=0.005` y `MAX_TOTAL_SOL=0.015`
(3 compras como máximo):

```bash
npm start
```

Cada operación muestra un enlace de solscan.io para verla en la blockchain.

### Costos que debes conocer

- Comisión de red + prioridad en cada compra y venta.
- ~0.002 SOL de *rent* la primera vez que la wallet recibe cada token
  (para crear la cuenta del token).
- El slippage y llegar tarde respecto a la wallet copiada.

Con montos pequeños, estos costos pueden ser mayores que cualquier ganancia.
Eso también es parte de la lección.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/index.js` | Programa principal |
| `src/websocket.js` | Fuente gratuita: suscripción de logs por WebSocket |
| `src/stream.js` | Fuente de pago: Yellowstone gRPC con reconexión automática |
| `src/parser.js` | Detecta compras y ventas por cambios de saldo |
| `src/guard.js` | Límites de seguridad |
| `src/paperTrader.js` | Modo `simular` |
| `src/liveTrader.js` | Modo `real` (Metis + simulación previa) |
| `src/check.js` | Verificación sin gastar |
| `data/` | Estado e historial (se crea solo, no se sube a git) |

## Tests

```bash
npm test
```

## Diferencias con la guía original

- Además de copiar compras, **copia las ventas**; la guía solo compraba.
- Modos `observar` y `simular`, límites de presupuesto y simulación previa
  a cada envío.
- Detecta operaciones por cambios de saldo en lugar de decodificar las
  instrucciones de pump.fun. Así funciona aunque la wallet opere a través
  de routers como Axiom o Photon, o use instrucciones nuevas.
- Corrige errores del ejemplo original: la dependencia `node-fetch` no estaba
  declarada y el manejo de errores usaba una variable inexistente.
- Acepta la clave privada en el formato que exporta Phantom (base58).
- Reconexión automática si se corta la conexión.
- Alternativa gratuita por WebSocket además de Yellowstone gRPC.

---

*Código solo con fines educativos. No es consejo financiero.*
