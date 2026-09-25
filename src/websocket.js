/**
 * FUENTE=websocket — alternativa gratuita a Yellowstone gRPC.
 *
 * Usa la suscripción de logs del RPC normal de Solana (incluida en cualquier
 * endpoint de QuickNode): por cada wallet seguida recibe un aviso cuando
 * aparece en una transacción y la descarga completa con getTransaction.
 * Es ~1–2 s más lenta que gRPC.
 */
const { Connection, PublicKey } = require("@solana/web3.js");
const { fromRpc } = require("./parser");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function wsUrl(httpUrl) {
  return httpUrl.replace(/^http/, "ws");
}

/** La transacción puede tardar un momento en estar disponible por RPC. */
async function fetchTransaction(connection, signature) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1, // v1 = formato nuevo (SIMD-0385)
    });
    if (tx) return tx;
    await sleep(500 * (attempt + 1));
  }
  return null;
}

function connect(config) {
  return new Connection(config.solanaRpc, {
    commitment: "confirmed",
    wsEndpoint: config.solanaWss || wsUrl(config.solanaRpc),
  });
}

/** Falla con un mensaje claro si SOLANA_RPC no responde. */
async function assertRpc(connection) {
  try {
    return await connection.getSlot();
  } catch (e) {
    throw new Error(`No se pudo conectar a SOLANA_RPC (${e.cause?.code || e.message}). Revisa la URL en tu .env`);
  }
}

async function streamViaWebsocket(config, onTransaction) {
  const connection = connect(config);
  await assertRpc(connection);

  const handleLogs = async ({ signature, err, logs }) => {
    if (err) return;
    try {
      const tx = await fetchTransaction(connection, signature);
      if (!tx) return console.log(`⚠️  No se pudo descargar ${signature}`);
      onTransaction(fromRpc(signature, tx));
    } catch (e) {
      console.error(`⚠️  Error descargando ${signature}: ${e.message}`);
    }
  };

  // Una suscripción por wallet (el filtro "mentions" acepta una sola dirección).
  for (const wallet of config.watchList) {
    connection.onLogs(new PublicKey(wallet), handleLogs, "confirmed");
  }
  console.log("📡 Conectado por WebSocket (modo gratuito). Esperando operaciones de las wallets seguidas…\n");

  // web3.js reconecta el WebSocket sola; esto solo mantiene vivo el proceso.
  await new Promise(() => {});
}

module.exports = { streamViaWebsocket, wsUrl, connect, assertRpc };
