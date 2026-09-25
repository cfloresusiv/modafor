/**
 * MODE=real — compra y vende con tu wallet usando la API de pump.fun de
 * Metis (QuickNode), como en la guía original.
 *
 * Protecciones:
 *   - Límites de guard.js (presupuesto total, posiciones, tamaño mínimo).
 *   - Nunca baja de MIN_SOL_RESERVE de saldo.
 *   - Cada transacción se SIMULA en la red antes de enviarse; si la
 *     simulación falla, no se envía nada.
 *   - Lo gastado y recibido se mide con el saldo real antes/después.
 */
const { Connection, PublicKey, VersionedTransaction } = require("@solana/web3.js");
const { loadKeypair } = require("./wallet");
const { solStr, tokenStr, short } = require("./format");

const CONFIRM_TIMEOUT_MS = 45_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class LiveTrader {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.connection = new Connection(config.solanaRpc, "confirmed");
    this.wallet = loadKeypair(config.secretKey);
  }

  get publicKey() {
    return this.wallet.publicKey.toBase58();
  }

  async solBalance() {
    return BigInt(await this.connection.getBalance(this.wallet.publicKey, "confirmed"));
  }

  async tokenBalance(mint) {
    const { value } = await this.connection.getParsedTokenAccountsByOwner(
      this.wallet.publicKey,
      { mint: new PublicKey(mint) },
      "confirmed"
    );
    return value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
  }

  async fetchSwapTransaction(type, mint, inAmount) {
    const res = await fetch(`${this.config.metisEndpoint}/pump-fun/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: this.publicKey,
        type,
        mint,
        inAmount,
        priorityFeeLevel: this.config.priorityFeeLevel,
        slippageBps: this.config.slippageBps,
      }),
    });
    if (!res.ok) throw new Error(`Metis respondió ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (!body.tx) throw new Error(`Respuesta inesperada de Metis: ${JSON.stringify(body)}`);
    return body.tx;
  }

  /** Arma y firma la transacción, y la simula en la red. Lanza error si la simulación falla. */
  async buildAndSimulate(type, mint, inAmount) {
    const base64 = await this.fetchSwapTransaction(type, mint, inAmount);
    const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.message.recentBlockhash = blockhash;
    tx.sign([this.wallet]);

    const sim = await this.connection.simulateTransaction(tx, { sigVerify: true, commitment: "confirmed" });
    if (sim.value.err) {
      const logs = (sim.value.logs || []).slice(-5).join("\n      ");
      throw new Error(`La simulación falló, no se envió nada: ${JSON.stringify(sim.value.err)}\n      ${logs}`);
    }
    return { tx, lastValidBlockHeight };
  }

  async sendSigned({ tx, lastValidBlockHeight }) {
    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true, // ya la simulamos arriba
      maxRetries: 3,
    });

    const start = Date.now();
    while (Date.now() - start < CONFIRM_TIMEOUT_MS) {
      const { value } = await this.connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) throw new Error(`La transacción ${signature} falló: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        return signature;
      }
      const height = await this.connection.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) break;
      await sleep(2_000);
    }
    throw new Error(`No se confirmó a tiempo: ${signature} (revisa en solscan.io; puede haber expirado)`);
  }

  async onBuy(trade, reason) {
    if (reason) return console.log(`   ⏭️  No se copia: ${reason}`);
    const { buyLamports, minReserveLamports } = this.config;

    const before = await this.solBalance();
    if (before < buyLamports + minReserveLamports) {
      return console.log(`   ⏭️  No se copia: saldo ${solStr(before)} < compra + reserva (${solStr(buyLamports + minReserveLamports)})`);
    }

    try {
      const prepared = await this.buildAndSimulate("BUY", trade.mint, Number(buyLamports));
      // El presupuesto se descuenta justo antes de enviar: si el envío queda
      // en duda (sin confirmar), cuenta como gastado y nunca se supera MAX_TOTAL_SOL.
      this.store.state.spentLamports = (BigInt(this.store.state.spentLamports) + buyLamports).toString();
      this.store.save();
      const signature = await this.sendSigned(prepared);
      const [after, tokens] = await Promise.all([this.solBalance(), this.tokenBalance(trade.mint)]);
      const cost = before - after;
      this.store.positions[trade.mint] = {
        tokens: tokens.toString(),
        decimals: trade.decimals,
        costLamports: cost.toString(),
        copiedFrom: trade.trader,
        openedAt: new Date().toISOString(),
        buyTx: signature,
      };
      this.store.save();
      this.store.log({ event: "BUY", mint: trade.mint, tokens, costLamports: cost, tx: signature, copiedTx: trade.signature });
      console.log(`   ✅ Comprado ${tokenStr(tokens, trade.decimals)} tokens, costo total ${solStr(cost)}`);
      console.log(`      https://solscan.io/tx/${signature}`);
    } catch (err) {
      this.store.log({ event: "BUY_ERROR", mint: trade.mint, error: err.message, copiedTx: trade.signature });
      console.log(`   ❌ Compra fallida: ${err.message}`);
      // Si la compra llegó a la red aunque no se confirmó a tiempo, registrar
      // la posición igual para que se venda cuando la ballena venda.
      const tokens = await this.tokenBalance(trade.mint).catch(() => 0n);
      if (tokens > 0n) {
        this.store.positions[trade.mint] = {
          tokens: tokens.toString(),
          decimals: trade.decimals,
          costLamports: buyLamports.toString(),
          copiedFrom: trade.trader,
          openedAt: new Date().toISOString(),
        };
        this.store.save();
        console.log(`   ℹ️  Aun así tienes ${tokenStr(tokens, trade.decimals)} tokens; se registra la posición`);
      }
    }
  }

  async onSell(trade) {
    const position = this.store.positions[trade.mint];
    if (!position) return;

    try {
      const tokens = await this.tokenBalance(trade.mint);
      if (tokens === 0n) {
        delete this.store.positions[trade.mint];
        this.store.save();
        return console.log(`   ℹ️  Ya no tienes ${short(trade.mint)}; se quita de posiciones`);
      }
      if (tokens > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("cantidad de tokens fuera de rango");

      const before = await this.solBalance();
      const signature = await this.sendSigned(await this.buildAndSimulate("SELL", trade.mint, Number(tokens)));
      const after = await this.solBalance();
      const proceeds = after - before;
      const pnl = proceeds - BigInt(position.costLamports);

      this.store.state.realizedLamports = (BigInt(this.store.state.realizedLamports) + pnl).toString();
      delete this.store.positions[trade.mint];
      this.store.save();
      this.store.log({ event: "SELL", mint: trade.mint, proceedsLamports: proceeds, pnlLamports: pnl, tx: signature, copiedTx: trade.signature });
      console.log(`   ✅ Vendido: recibiste ${solStr(proceeds)} → ${pnl >= 0n ? "🟢 +" : "🔴 "}${solStr(pnl)}`);
      console.log(`      https://solscan.io/tx/${signature}`);
    } catch (err) {
      this.store.log({ event: "SELL_ERROR", mint: trade.mint, error: err.message, copiedTx: trade.signature });
      console.log(`   ❌ Venta fallida (la posición sigue abierta): ${err.message}`);
    }
  }

  summary() {
    const s = this.store.state;
    return [
      `Gastado en compras: ${solStr(s.spentLamports)} de ${solStr(this.config.maxTotalLamports)}`,
      `Resultado realizado: ${solStr(s.realizedLamports)}`,
      `Posiciones abiertas: ${Object.keys(s.positions).length}`,
    ].join("\n");
  }
}

module.exports = { LiveTrader };
