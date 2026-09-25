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
const { walletHistory } = require("./history");
const { solStr, tokenStr, short } = require("./format");

async function main() {
  const [address, countArg] = process.argv.slice(2);
  if (!address) throw new Error("Uso: npm run revisar -- <wallet> [cantidad]");
  let wallet;
  try {
    wallet = new PublicKey(address).toBase58();
  } catch {
    throw new Error(`Dirección de wallet inválida: ${address}`);
  }
  const limit = Math.min(Number(countArg) || 20, 100);

  const config = loadConfig();
  if (!config.solanaRpc) throw new Error("Falta SOLANA_RPC en tu .env");
  const connection = connect(config);
  await assertRpc(connection);

  console.log(`🔎 Últimas ${limit} transacciones de ${wallet}\n`);
  const history = await walletHistory(connection, wallet, limit);
  const counts = { "pump.fun": 0, PumpSwap: 0, "otro DEX": 0, cambios: 0, transferencias: 0, otras: 0 };
  const LABEL = {
    BUY: "🟢 COMPRA ",
    SELL: "🔴 VENTA  ",
    SWAP: "🔁 CAMBIO ",
    TRANSFER_OUT: "📤 ENVÍO  ",
    TRANSFER_IN: "📥 RECIBE ",
  };

  for (const { blockTime, err, trades } of history) {
    const when = blockTime ? new Date(blockTime * 1000).toLocaleString("es") : "?";
    if (err) {
      console.log(`${when}  ✖ fallida`);
      counts.otras++;
      continue;
    }
    if (trades.length === 0) {
      console.log(`${when}  ·  sin movimiento de tokens (envío de SOL u otra)`);
      counts.otras++;
    }
    for (const t of trades) {
      if (t.side === "BUY" || t.side === "SELL") {
        counts[t.venue]++;
        const copy = t.venue === "pump.fun" ? "✅ copiable" : "⏭️  no copiable (graduado)";
        console.log(`${when}  ${LABEL[t.side]} ${solStr(t.lamports).padStart(16)} en ${t.venue.padEnd(8)} ${copy}  token ${short(t.mint)}`);
      } else if (t.side === "SWAP") {
        counts.cambios++;
        console.log(`${when}  ${LABEL.SWAP} ${tokenStr(t.tokenAmount, t.decimals)} de ${short(t.mint)} → ${tokenStr(t.toAmount, t.toDecimals)} de ${short(t.toMint)} (vende uno, compra otro)`);
      } else {
        counts.transferencias++;
        console.log(`${when}  ${LABEL[t.side]} ${tokenStr(t.tokenAmount, t.decimals)} de ${short(t.mint)} (sin pago: no es compra ni venta)`);
      }
    }
  }

  console.log("\n📊 Resumen:");
  console.log(`   En la curva de pump.fun (el bot puede copiar): ${counts["pump.fun"]}`);
  console.log(`   En PumpSwap (tokens graduados):               ${counts.PumpSwap}`);
  console.log(`   En otros exchanges:                           ${counts["otro DEX"]}`);
  console.log(`   Cambios token → token (vende uno, compra otro): ${counts.cambios}`);
  console.log(`   Envíos/recepciones sin pago:                  ${counts.transferencias}`);
  console.log(`   Otras (envío de SOL, fallidas…):              ${counts.otras}`);
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
