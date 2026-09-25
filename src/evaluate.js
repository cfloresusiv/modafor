/**
 * npm run evaluar [-- <wallet1> <wallet2> ...]
 *
 * Califica wallets candidatas para copiar, con datos reales de la blockchain.
 * Si no se pasan wallets, evalúa las de WATCH_LIST.
 *
 * Criterios (los que recomiendan las herramientas de análisis de traders):
 *   - Opera seguido en la curva de pump.fun (lo único que el bot puede copiar)
 *   - Ganancia REALIZADA positiva (vendió con ganancia, no solo "tiene tokens que subieron")
 *   - % de acierto en los tokens que cerró
 *   - Variedad de tokens (no depende de un solo golpe de suerte)
 *   - Actividad reciente
 *
 * Solo lee datos; no necesita wallet propia ni gasta nada.
 * Variable opcional: EVAL_TX (transacciones a revisar por wallet, por defecto 150).
 */
const { PublicKey } = require("@solana/web3.js");
const { loadConfig } = require("./config");
const { connect, assertRpc } = require("./websocket");
const { walletHistory } = require("./history");
const { solStr, short } = require("./format");

const HOUR = 3600;

function analyze(history) {
  const perMint = new Map(); // mint -> { in, out, curveBuy }
  let curveBuys = 0;
  let gradTrades = 0;
  let exitsWithoutSol = 0;
  const times = history.map((h) => h.blockTime).filter(Boolean);

  for (const { trades } of history) {
    for (const t of trades) {
      if (t.side === "SWAP" || t.side === "TRANSFER_OUT") exitsWithoutSol++;
      if (t.side !== "BUY" && t.side !== "SELL") continue;
      if (t.venue === "pump.fun" && t.side === "BUY") curveBuys++;
      if (t.venue !== "pump.fun") gradTrades++;
      const m = perMint.get(t.mint) || { in: 0n, out: 0n };
      if (t.side === "BUY") m.in += t.lamports;
      else m.out += t.lamports;
      perMint.set(t.mint, m);
    }
  }

  // Tokens "cerrados": compró y vendió dentro del período revisado.
  const closed = [...perMint.values()].filter((m) => m.in > 0n && m.out > 0n);
  const realized = closed.reduce((sum, m) => sum + (m.out - m.in), 0n);
  const wins = closed.filter((m) => m.out > m.in).length;

  return {
    txs: history.length,
    hoursCovered: times.length ? (Math.max(...times) - Math.min(...times)) / HOUR : 0,
    hoursSinceLast: times.length ? (Date.now() / 1000 - Math.max(...times)) / HOUR : Infinity,
    curveBuys,
    gradTrades,
    tokens: perMint.size,
    closed: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    realized,
    exitsWithoutSol,
  };
}

function verdict(a) {
  const problems = [];
  if (a.curveBuys < 5) problems.push("casi no compra en la curva de pump.fun");
  if (a.closed < 3) problems.push("pocos tokens cerrados para juzgar");
  else {
    if (a.realized <= 0n) problems.push("ganancia realizada negativa");
    if (a.winRate < 0.5) problems.push("acierta menos de la mitad");
  }
  if (a.tokens < 5) problems.push("opera muy pocos tokens");
  if (a.hoursSinceLast > 48) problems.push("inactiva hace más de 2 días");
  if (a.exitsWithoutSol > a.closed) problems.push("sale mucho por envíos/cambios (difícil de copiar)");
  return problems;
}

async function main() {
  const config = loadConfig();
  if (!config.solanaRpc) throw new Error("Falta SOLANA_RPC en tu .env");
  const wallets = (process.argv.length > 2 ? process.argv.slice(2) : config.watchList).map((w) =>
    new PublicKey(w).toBase58()
  );
  const limit = Math.min(Number(process.env.EVAL_TX) || 150, 1000);

  const connection = connect(config);
  await assertRpc(connection);
  console.log(`🔎 Evaluando ${wallets.length} wallet(s) con sus últimas ${limit} transacciones…\n`);

  const rows = [];
  for (const wallet of wallets) {
    const history = await walletHistory(connection, wallet, limit, (done, total) => {
      process.stdout.write(`\r   ${short(wallet)}: ${done}/${total}   `);
    });
    process.stdout.write("\n");
    const a = analyze(history);
    rows.push({ wallet, a, problems: verdict(a) });
  }

  rows.sort((x, y) => x.problems.length - y.problems.length || Number(y.a.realized - x.a.realized));

  console.log("\n📊 Ranking (mejor arriba)\n");
  for (const { wallet, a, problems } of rows) {
    const ok = problems.length === 0;
    console.log(`${ok ? "✅" : "⚠️ "} ${wallet}`);
    console.log(
      `   Período: ${a.hoursCovered.toFixed(1)} h · última actividad hace ${a.hoursSinceLast.toFixed(1)} h · ${a.txs} transacciones`
    );
    console.log(
      `   Compras en curva pump.fun: ${a.curveBuys} · operaciones en tokens graduados: ${a.gradTrades} · tokens distintos: ${a.tokens}`
    );
    console.log(
      `   Tokens cerrados: ${a.closed} · acierto: ${(a.winRate * 100).toFixed(0)}% · ganancia realizada: ${solStr(a.realized)}`
    );
    console.log(ok ? "   👉 Buena candidata para copiar" : `   👉 Ojo: ${problems.join("; ")}`);
    console.log();
  }

  console.log("Notas:");
  console.log("- La ganancia realizada cuenta solo tokens comprados Y vendidos en el período revisado (aprox., incluye comisiones).");
  console.log("- Un buen historial no garantiza el futuro, y las wallets más famosas son las más copiadas (entras más caro).");
  console.log("- Confirma siempre con MODE=simular antes de usar dinero real.");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n❌ ${err.message}`);
      process.exit(1);
    });
}

module.exports = { analyze, verdict };
