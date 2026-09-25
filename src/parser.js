/**
 * Convierte una transacción de Yellowstone en operaciones legibles.
 *
 * En lugar de decodificar las instrucciones de pump.fun (que cambian de
 * versión y además llegan envueltas por routers como Axiom o Photon), mira
 * cómo cambiaron los saldos de la wallet seguida:
 *   - sube el saldo de un token y baja el SOL  -> COMPRA
 *   - baja el saldo de un token y sube el SOL  -> VENTA
 */
const bs58 = require("bs58").default;
const { WSOL_MINT } = require("./config");

const toBase58 = (bytes) => bs58.encode(Buffer.from(bytes));

function accountKeysOf(tx) {
  const message = tx.transaction?.message;
  const meta = tx.meta;
  return [
    ...(message?.accountKeys || []),
    ...(meta?.loadedWritableAddresses || []),
    ...(meta?.loadedReadonlyAddresses || []),
  ].map(toBase58);
}

function tokenDeltasByMint(meta, owner) {
  const deltas = new Map();
  const add = (balances, sign) => {
    for (const b of balances || []) {
      if (b.owner !== owner) continue;
      const amount = BigInt(b.uiTokenAmount?.amount || "0");
      const current = deltas.get(b.mint) || { delta: 0n, decimals: b.uiTokenAmount?.decimals ?? 0 };
      current.delta += sign * amount;
      deltas.set(b.mint, current);
    }
  };
  add(meta.preTokenBalances, -1n);
  add(meta.postTokenBalances, 1n);
  return deltas;
}

/**
 * @param {object} tx  SubscribeUpdateTransactionInfo (data.transaction.transaction)
 * @param {Set<string>} watched  wallets seguidas
 * @returns {Array<{signature, trader, side, mint, tokenAmount, decimals, lamports}>}
 *   tokenAmount y lamports son BigInt positivos (cantidad movida).
 */
function parseTrades(tx, watched) {
  const meta = tx?.meta;
  if (!tx?.transaction?.message || !meta || meta.err) return [];

  const signature = toBase58(tx.signature);
  const keys = accountKeysOf(tx);
  const trades = [];

  keys.forEach((key, index) => {
    if (!watched.has(key)) return;

    const deltas = tokenDeltasByMint(meta, key);
    // Si un router envolvió SOL en WSOL, cuenta ese movimiento como SOL.
    let solDelta = BigInt(meta.postBalances[index] ?? 0) - BigInt(meta.preBalances[index] ?? 0);
    if (deltas.has(WSOL_MINT)) {
      solDelta += deltas.get(WSOL_MINT).delta;
      deltas.delete(WSOL_MINT);
    }

    for (const [mint, { delta, decimals }] of deltas) {
      if (delta === 0n) continue;
      const side = delta > 0n ? "BUY" : "SELL";
      // Una compra que no gasta SOL (o una venta que no lo recibe) no es un
      // swap: puede ser un airdrop o una transferencia. Se ignora.
      if ((side === "BUY" && solDelta >= 0n) || (side === "SELL" && solDelta <= 0n)) continue;
      trades.push({
        signature,
        trader: key,
        side,
        mint,
        tokenAmount: delta < 0n ? -delta : delta,
        decimals,
        lamports: solDelta < 0n ? -solDelta : solDelta,
      });
    }
  });

  return trades;
}

module.exports = { parseTrades };
