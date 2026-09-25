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
const { WSOL_MINT, PUMP_FUN_PROGRAM_ID, PUMP_SWAP_PROGRAM_ID } = require("./config");

// Movimientos de SOL menores a esto son comisiones o el depósito/devolución
// (~0.002 SOL) por abrir o cerrar la cuenta de un token, no un pago.
const DUST_LAMPORTS = 3_000_000n;

const toBase58 = (bytes) => bs58.encode(Buffer.from(bytes));

/**
 * Formato común que usa parseTrades, venga la transacción de Yellowstone
 * (gRPC) o del RPC normal (WebSocket):
 *   { signature, accountKeys: string[], err, preBalances, postBalances,
 *     preTokenBalances, postTokenBalances }
 */
function fromYellowstone(tx) {
  const message = tx?.transaction?.message;
  const meta = tx?.meta;
  if (!message || !meta) return null;
  return {
    signature: toBase58(tx.signature),
    accountKeys: [
      ...(message.accountKeys || []),
      ...(meta.loadedWritableAddresses || []),
      ...(meta.loadedReadonlyAddresses || []),
    ].map(toBase58),
    err: meta.err,
    preBalances: meta.preBalances,
    postBalances: meta.postBalances,
    preTokenBalances: meta.preTokenBalances,
    postTokenBalances: meta.postTokenBalances,
  };
}

/** Respuesta de connection.getTransaction(sig, { maxSupportedTransactionVersion: 1 }), mensaje v0 o v1. */
function fromRpc(signature, tx) {
  const meta = tx?.meta;
  if (!tx?.transaction?.message || !meta) return null;
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  return {
    signature,
    accountKeys: keys.keySegments().flat().map((k) => k.toBase58()),
    err: meta.err,
    preBalances: meta.preBalances,
    postBalances: meta.postBalances,
    preTokenBalances: meta.preTokenBalances,
    postTokenBalances: meta.postTokenBalances,
  };
}

/** Dónde ocurrió la operación, según los programas que aparecen en la transacción. */
function venueOf(tx) {
  if (tx.accountKeys.includes(PUMP_FUN_PROGRAM_ID)) return "pump.fun";
  if (tx.accountKeys.includes(PUMP_SWAP_PROGRAM_ID)) return "PumpSwap";
  return "otro DEX";
}

function tokenDeltasByMint(tx, owner) {
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
  add(tx.preTokenBalances, -1n);
  add(tx.postTokenBalances, 1n);
  return deltas;
}

/**
 * @param {object} tx  transacción en el formato común (fromYellowstone / fromRpc)
 * @param {Set<string>} watched  wallets seguidas
 * @returns {Array<{signature, trader, side, mint, tokenAmount, decimals, lamports, venue}>}
 *   side: BUY / SELL (contra SOL), SWAP (entrega `mint` a cambio de `toMint`),
 *   TRANSFER_OUT / TRANSFER_IN (tokens enviados o recibidos sin pago).
 *   venue: "pump.fun" (curva, token nuevo), "PumpSwap" (token graduado) u "otro DEX".
 *   tokenAmount y lamports son BigInt positivos (cantidad movida).
 */
function parseTrades(tx, watched) {
  if (!tx || tx.err) return [];
  const trades = [];
  const venue = venueOf(tx);

  tx.accountKeys.forEach((key, index) => {
    if (!watched.has(key)) return;

    const deltas = tokenDeltasByMint(tx, key);
    // Si un router envolvió SOL en WSOL, cuenta ese movimiento como SOL.
    let solDelta = BigInt(tx.postBalances[index] ?? 0) - BigInt(tx.preBalances[index] ?? 0);
    if (deltas.has(WSOL_MINT)) {
      solDelta += deltas.get(WSOL_MINT).delta;
      deltas.delete(WSOL_MINT);
    }

    const base = { signature: tx.signature, trader: key, venue, lamports: solDelta < 0n ? -solDelta : solDelta };
    const moved = [...deltas]
      .filter(([, d]) => d.delta !== 0n)
      .map(([mint, { delta, decimals }]) => ({ mint, decimals, amount: delta < 0n ? -delta : delta, up: delta > 0n }));
    const ups = moved.filter((m) => m.up);
    const downs = moved.filter((m) => !m.up);
    const entry = (side, m, extra = {}) =>
      trades.push({ ...base, side, mint: m.mint, tokenAmount: m.amount, decimals: m.decimals, ...extra });

    if (ups.length && downs.length) {
      // Cambió un token por otro sin pasar por SOL: es una venta del que
      // entrega (realiza ganancia o pérdida) y una compra del que recibe.
      for (const m of downs) {
        entry("SWAP", m, { toMint: ups[0].mint, toAmount: ups[0].amount, toDecimals: ups[0].decimals });
      }
    } else if (ups.length) {
      // Recibe tokens: si pagó SOL es una compra; si no, se los enviaron.
      for (const m of ups) entry(solDelta < -DUST_LAMPORTS ? "BUY" : "TRANSFER_IN", m);
    } else if (downs.length) {
      // Entrega tokens: si recibió SOL es una venta; si no, los envió a otra
      // wallet (puede ser para vender desde ahí).
      for (const m of downs) entry(solDelta > DUST_LAMPORTS ? "SELL" : "TRANSFER_OUT", m);
    }
  });

  return trades;
}

module.exports = { parseTrades, fromYellowstone, fromRpc };
