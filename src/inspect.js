/**
 * npm run revisar -- <wallet> [cantidad]
 *
 * Muestra las últimas transacciones de una wallet tal como las interpreta
 * el bot: compra/venta, dónde (pump.fun, PumpSwap, otro DEX) y si se
 * copiaría. Sirve para decidir si vale la pena seguir a esa wallet.
 * Solo lee datos; no necesita wallet propia ni gasta nada.
 */
const { PublicKey } = require("@solana/web3.js");
const { loadConfig } = require("./config");
const { connect, assertRpc } = require("./websocket");
const { parseTrades, fromRpc } = require("./parser");
const { solStr, tokenStr, short } = require("./format");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [address, countArg] = process.argv.slice(2);
  if (!address) throw new Error("Uso: npm run revisar -- <wallet> [cantidad]");
  const wallet = new PublicKey(address).toBase58();
  const limit = Math.min(Number(countArg) || 20, 100);

  const config = loadConfig();
  if (!config.solanaRpc) throw new Error("Falta SOLANA_RPC en tu .env");
  const connection = connect(config);
  await assertRpc(connection);

  console.log(`🔎 Últimas ${limit} transacciones de ${wallet}\n`);
  const signatures = await connection.getSignaturesForAddress(new PublicKey(wallet), { limit });
  const counts = { "pump.fun": 0, PumpSwap: 0, "otro DEX": 0, otras: 0 };

  for (const { signature, blockTime, err } of signatures) {
    const when = blockTime ? new Date(blockTime * 1000).toLocaleString("es") : "?";
    if (err) {
      console.log(`${when}  ✖ fallida`);
      counts.otras++;
      continue;
    }
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 1,
    });
    const trades = tx ? parseTrades(fromRpc(signature, tx), new Set([wallet])) : [];
    if (trades.length === 0) {
      console.log(`${when}  ·  sin compra/venta (transferencia u otra)`);
      counts.otras++;
    }
    for (const t of trades) {
      counts[t.venue]++;
      const side = t.side === "BUY" ? "🟢 COMPRA" : "🔴 VENTA ";
      const copy = t.venue === "pump.fun" ? "✅ copiable" : "⏭️  no copiable (graduado)";
      console.log(`${when}  ${side} ${solStr(t.lamports).padStart(16)} en ${t.venue.padEnd(8)} ${copy}  token ${short(t.mint)}`);
    }
    await sleep(150); // no saturar el plan gratuito del RPC
  }

  console.log("\n📊 Resumen:");
  console.log(`   En la curva de pump.fun (el bot puede copiar): ${counts["pump.fun"]}`);
  console.log(`   En PumpSwap (tokens graduados):               ${counts.PumpSwap}`);
  console.log(`   En otros exchanges:                           ${counts["otro DEX"]}`);
  console.log(`   Otras (transferencias, fallidas…):            ${counts.otras}`);
  if (counts["pump.fun"] === 0) {
    console.log("\n⚠️  Esta wallet no operó en la curva de pump.fun en estas transacciones: el bot no tendría nada que copiar.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
