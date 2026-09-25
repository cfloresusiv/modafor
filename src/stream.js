/**
 * FUENTE=grpc — recibe en tiempo real las transacciones de pump.fun donde participan las
 * wallets seguidas, usando Yellowstone gRPC (Geyser) de QuickNode.
 */
const { PUMP_FUN_PROGRAM_ID } = require("./config");
const { fromYellowstone } = require("./parser");

const PING_INTERVAL_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * La librería de gRPC trae un binario nativo por sistema operativo que a veces
 * npm no instala (p. ej. en Windows). Se carga solo si FUENTE=grpc, así el
 * modo gratuito funciona aunque falte.
 */
function loadYellowstone() {
  try {
    return require("@triton-one/yellowstone-grpc");
  } catch (e) {
    throw new Error(
      "No se pudo cargar la librería de gRPC en este sistema. Usa FUENTE=websocket, " +
        "o borra node_modules y package-lock.json y ejecuta npm install de nuevo. " +
        `(${e.message.split("\n")[0]})`
    );
  }
}

function subscribeRequest(watchList) {
  const { CommitmentLevel } = loadYellowstone();
  return {
    accounts: {},
    slots: {},
    transactions: {
      pumpFun: {
        vote: false,
        failed: false,
        accountInclude: watchList, // cualquiera de las wallets seguidas…
        accountExclude: [],
        accountRequired: [PUMP_FUN_PROGRAM_ID], // …operando en pump.fun
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.CONFIRMED,
  };
}

/** Se conecta y llama a onTransaction(tx) por cada transacción. Reconecta sola si se cae. */
async function streamTransactions(config, onTransaction) {
  const Client = loadYellowstone().default;
  let attempt = 0;
  for (;;) {
    let pinger;
    try {
      const client = new Client(config.yellowstoneEndpoint, config.yellowstoneToken, undefined);
      await client.connect();
      const stream = await client.subscribe();
      await new Promise((resolve, reject) =>
        stream.write(subscribeRequest(config.watchList), (err) => (err ? reject(err) : resolve()))
      );
      console.log("📡 Conectado a Yellowstone. Esperando operaciones de las wallets seguidas…\n");
      attempt = 0;

      // Algunos proveedores cierran la conexión si no hay tráfico.
      let pingId = 0;
      pinger = setInterval(() => {
        stream.write({ ...subscribeRequest(config.watchList), ping: { id: ++pingId } }, () => {});
      }, PING_INTERVAL_MS);

      await new Promise((resolve, reject) => {
        stream.on("data", (update) => {
          const tx = update.transaction?.transaction;
          if (tx) onTransaction(fromYellowstone(tx));
        });
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.on("close", resolve);
      });
      console.log("⚠️  La conexión se cerró.");
    } catch (err) {
      console.error(`⚠️  Error de conexión: ${err.message}`);
    } finally {
      clearInterval(pinger);
    }
    attempt += 1;
    const wait = Math.min(30_000, 1_000 * 2 ** attempt);
    console.log(`   Reintentando en ${wait / 1000}s…`);
    await sleep(wait);
  }
}

module.exports = { streamTransactions, subscribeRequest, loadYellowstone };
