/**
 * Descarga el historial reciente de una wallet y lo interpreta con el
 * parser del bot. Lo usan `npm run revisar` y `npm run evaluar`.
 */
const { PublicKey } = require("@solana/web3.js");
const { parseTrades, fromRpc } = require("./parser");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONCURRENCY = 4; // pocas peticiones a la vez para no saturar el plan gratuito

/**
 * @returns {Promise<Array<{signature, blockTime, err, trades}>>} de más nueva a más antigua
 */
async function walletHistory(connection, wallet, limit, onProgress = () => {}) {
  const signatures = await connection.getSignaturesForAddress(new PublicKey(wallet), { limit });
  const results = new Array(signatures.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < signatures.length) {
      const i = next++;
      const { signature, blockTime, err } = signatures[i];
      let trades = [];
      if (!err) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const tx = await connection.getTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 1,
            });
            if (tx) trades = parseTrades(fromRpc(signature, tx), new Set([wallet]));
            break;
          } catch {
            await sleep(1_000 * (attempt + 1)); // límite de peticiones: esperar y reintentar
          }
        }
      }
      results[i] = { signature, blockTime, err, trades };
      onProgress(++done, signatures.length);
      await sleep(50);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

module.exports = { walletHistory };
