/**
 * Reglas de seguridad comunes a simular y real. Devuelve el motivo por el
 * que NO se debe copiar una compra, o null si está permitido.
 */
const { solStr } = require("./format");

function buyBlockedReason(trade, config, store) {
  if (trade.lamports < config.minWhaleLamports) {
    return `operación pequeña (${solStr(trade.lamports)} < MIN_WHALE_SOL)`;
  }
  if (store.positions[trade.mint]) {
    return "ya tienes este token";
  }
  if (Object.keys(store.positions).length >= config.maxOpenPositions) {
    return `ya tienes ${config.maxOpenPositions} posiciones abiertas (MAX_OPEN_POSITIONS)`;
  }
  const spent = BigInt(store.state.spentLamports);
  if (spent + config.buyLamports > config.maxTotalLamports) {
    return `presupuesto agotado: gastado ${solStr(spent)} de ${solStr(config.maxTotalLamports)} (MAX_TOTAL_SOL)`;
  }
  return null;
}

module.exports = { buyBlockedReason };
