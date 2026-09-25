/**
 * Laboratorio de copy trading en pump.fun — basado en la guía de QuickNode:
 * https://www.quicknode.com/guides/solana-development/defi/pump-fun-copy-trade
 *
 * Solo con fines educativos. No es consejo financiero: la mayoría de los
 * tokens de pump.fun pierden casi todo su valor y copiar operaciones
 * normalmente implica comprar más caro que la wallet copiada.
 */
const { loadConfig } = require("./config");
const { parseTrades } = require("./parser");
const { streamTransactions } = require("./stream");
const { streamViaWebsocket } = require("./websocket");
const { Store } = require("./store");
const { PaperTrader } = require("./paperTrader");
const { LiveTrader } = require("./liveTrader");
const { buyBlockedReason } = require("./guard");
const { solStr, tokenStr, short } = require("./format");

const MODE_LABEL = {
  observar: "👀 OBSERVAR (no opera)",
  simular: "🧪 SIMULAR (dinero ficticio)",
  real: "💸 REAL (dinero de verdad)",
};

async function main() {
  const config = loadConfig();
  const store = new Store(config.dataDir, config.mode, {});
  const trader =
    config.mode === "simular" ? new PaperTrader(config, store)
    : config.mode === "real" ? new LiveTrader(config, store)
    : null;

  console.log("🤖 Copy trader de pump.fun");
  console.log(`   Modo: ${MODE_LABEL[config.mode]} · Fuente: ${config.source}`);
  if (config.mode === "real") {
    console.log(`   Wallet del bot: ${trader.publicKey}`);
    console.log(`   Saldo: ${solStr(await trader.solBalance())}`);
  }
  if (trader) {
    console.log(`   Compra por operación: ${solStr(config.buyLamports)} · Presupuesto máximo: ${solStr(config.maxTotalLamports)}`);
  }
  console.log("   Wallets seguidas:");
  config.watchList.forEach((w) => console.log(`     - ${w}`));
  console.log();

  // Las operaciones de un mismo token se procesan en orden (una compra
  // en curso termina antes de procesar la venta de ese token).
  const queues = new Map();
  const seen = new Set();

  const handleTrade = async (trade) => {
    const icon = trade.side === "BUY" ? "🟢 COMPRA" : "🔴 VENTA";
    console.log(`${icon}  ${short(trade.trader)} ${trade.side === "BUY" ? "compró" : "vendió"} ${tokenStr(trade.tokenAmount, trade.decimals)} de ${trade.mint}`);
    console.log(`   por ${solStr(trade.lamports)} · https://solscan.io/tx/${trade.signature}`);
    if (!trader) return;
    if (trade.side === "BUY") await trader.onBuy(trade, buyBlockedReason(trade, config, store));
    else await trader.onSell(trade);
  };

  const onTransaction = (tx) => {
    const watched = new Set(config.watchList);
    for (const trade of parseTrades(tx, watched)) {
      const key = `${trade.signature}:${trade.trader}:${trade.mint}`;
      if (seen.has(key)) continue; // la reconexión puede repetir transacciones
      seen.add(key);
      if (seen.size > 10_000) seen.delete(seen.values().next().value);

      const previous = queues.get(trade.mint) || Promise.resolve();
      const next = previous
        .then(() => handleTrade(trade))
        .catch((err) => console.error(`Error procesando ${trade.signature}: ${err.message}`));
      queues.set(trade.mint, next);
      next.finally(() => queues.get(trade.mint) === next && queues.delete(trade.mint));
    }
  };

  const shutdown = () => {
    if (trader) console.log(`\n📊 Resumen\n${trader.summary()}`);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const stream = config.source === "grpc" ? streamTransactions : streamViaWebsocket;
  await stream(config, onTransaction);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
