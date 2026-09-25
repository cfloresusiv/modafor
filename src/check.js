/**
 * npm run check [-- <mint>]
 *
 * Verifica la configuración SIN gastar nada:
 *   1. Lee y valida el .env
 *   2. Prueba la fuente de datos (WebSocket del RPC o Yellowstone gRPC)
 *   3. (modo real) Revisa RPC, saldo de la wallet y límites
 *   4. (modo real + mint) Pide a Metis una compra real de ese token y la
 *      SIMULA en la red. No se envía ninguna transacción.
 */
const Client = require("@triton-one/yellowstone-grpc").default;
const { loadConfig } = require("./config");
const { connect, assertRpc } = require("./websocket");
const { LiveTrader } = require("./liveTrader");
const { Store } = require("./store");
const { solStr } = require("./format");

const ok = (msg) => console.log(`✅ ${msg}`);

async function main() {
  const config = loadConfig();
  ok(`.env válido · modo "${config.mode}" · ${config.watchList.length} wallet(s) seguida(s)`);

  if (config.source === "grpc") {
    const client = new Client(config.yellowstoneEndpoint, config.yellowstoneToken, undefined);
    await client.connect();
    const slot = await client.getSlot();
    ok(`Yellowstone gRPC responde (slot ${slot.slot})`);
  } else {
    const connection = connect(config);
    ok(`RPC responde (slot ${await assertRpc(connection)})`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("El WebSocket no respondió en 15 s (revisa SOLANA_RPC / SOLANA_WSS)")), 15_000);
      const id = connection.onSlotChange(() => {
        clearTimeout(timer);
        connection.removeSlotChangeListener(id).finally(resolve);
      });
    });
    ok("WebSocket responde (recibe bloques en vivo)");
  }

  if (config.mode !== "real") {
    console.log("\nListo. Para probar la parte de compra/venta configura MODE=real y vuelve a ejecutar.");
    return;
  }

  const trader = new LiveTrader(config, new Store(config.dataDir, "check", {}));
  const balance = await trader.solBalance();
  ok(`RPC responde · wallet ${trader.publicKey} · saldo ${solStr(balance)}`);

  const needed = config.buyLamports + config.minReserveLamports;
  if (balance < needed) {
    console.log(`⚠️  Saldo insuficiente: necesitas al menos ${solStr(needed)} (una compra + reserva)`);
  }
  if (config.maxTotalLamports > balance) {
    console.log(`ℹ️  MAX_TOTAL_SOL (${solStr(config.maxTotalLamports)}) es mayor que tu saldo; el límite real será el saldo`);
  }

  const mint = process.argv[2];
  if (!mint) {
    console.log("\nPara simular una compra real sin enviarla: npm run check -- <mint de un token de pump.fun>");
    return;
  }
  await trader.buildAndSimulate("BUY", mint, Number(config.buyLamports));
  ok(`Metis armó la compra de ${solStr(config.buyLamports)} de ${mint} y la simulación en la red PASÓ. No se envió nada.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
