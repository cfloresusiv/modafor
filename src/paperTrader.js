/**
 * MODE=simular — copia con dinero ficticio.
 *
 * Usa el precio al que operó la wallet seguida y le aplica una penalización
 * (SIM_DELAY_PENALTY_PCT) porque en la vida real tu copia llega después y
 * paga peor precio. También descuenta una comisión fija por operación.
 * Esto sigue siendo optimista: no modela tokens que no se pueden vender ni
 * transacciones fallidas.
 */
const { solStr, tokenStr, short } = require("./format");

class PaperTrader {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.store.state.cashLamports ??= config.simStartLamports.toString();
  }

  get cash() {
    return BigInt(this.store.state.cashLamports);
  }

  set cash(value) {
    this.store.state.cashLamports = value.toString();
  }

  async onBuy(trade, reason) {
    if (reason) return console.log(`   ⏭️  No se copia: ${reason}`);
    const { buyLamports, simFeeLamports, simPenaltyPct } = this.config;
    if (this.cash < buyLamports + simFeeLamports) {
      return console.log(`   ⏭️  No se copia: saldo ficticio insuficiente (${solStr(this.cash)})`);
    }

    // Precio de la ballena en lamports por unidad de token, empeorado por la penalización.
    const price = (Number(trade.lamports) / Number(trade.tokenAmount)) * (1 + simPenaltyPct / 100);
    const tokens = BigInt(Math.floor(Number(buyLamports) / price));

    this.cash -= buyLamports + simFeeLamports;
    this.store.state.spentLamports = (BigInt(this.store.state.spentLamports) + buyLamports).toString();
    this.store.positions[trade.mint] = {
      tokens: tokens.toString(),
      decimals: trade.decimals,
      costLamports: (buyLamports + simFeeLamports).toString(),
      copiedFrom: trade.trader,
      openedAt: new Date().toISOString(),
    };
    this.store.save();
    this.store.log({ event: "SIM_BUY", mint: trade.mint, tokens, costLamports: buyLamports + simFeeLamports, copiedTx: trade.signature });
    console.log(`   🧪 Compra simulada: ${tokenStr(tokens, trade.decimals)} tokens por ${solStr(buyLamports)} (+ ${solStr(simFeeLamports)} comisión)`);
  }

  async onSell(trade) {
    const position = this.store.positions[trade.mint];
    if (!position) return;
    const { simFeeLamports, simPenaltyPct } = this.config;

    const price = (Number(trade.lamports) / Number(trade.tokenAmount)) * (1 - simPenaltyPct / 100);
    const gross = BigInt(Math.floor(Number(position.tokens) * price));
    const proceeds = gross > simFeeLamports ? gross - simFeeLamports : 0n;
    const pnl = proceeds - BigInt(position.costLamports);

    this.cash += proceeds;
    this.store.state.realizedLamports = (BigInt(this.store.state.realizedLamports) + pnl).toString();
    delete this.store.positions[trade.mint];
    this.store.save();
    this.store.log({ event: "SIM_SELL", mint: trade.mint, proceedsLamports: proceeds, pnlLamports: pnl, copiedTx: trade.signature });
    const icon = pnl >= 0n ? "🟢" : "🔴";
    console.log(`   🧪 Venta simulada de ${short(trade.mint)}: recibes ${solStr(proceeds)} → ${icon} ${pnl >= 0n ? "+" : ""}${solStr(pnl)}`);
  }

  /** La ballena cambió o envió el token: en la simulación no hay precio de venta. */
  async onExit(trade) {
    if (!this.store.positions[trade.mint]) return;
    this.store.log({ event: "SIM_EXIT_SIN_PRECIO", mint: trade.mint, side: trade.side, copiedTx: trade.signature });
    console.log(`   ⚠️  Tienes ${short(trade.mint)} en la simulación, pero la ballena salió sin venderlo por SOL.`);
    console.log("      No hay precio para simular la venta: la posición queda abierta. En modo real se vendería.");
  }

  summary() {
    const s = this.store.state;
    return [
      `Saldo ficticio: ${solStr(this.cash)} (empezó con ${solStr(this.config.simStartLamports)})`,
      `Resultado realizado: ${solStr(s.realizedLamports)}`,
      `Posiciones abiertas: ${Object.keys(s.positions).length}`,
    ].join("\n");
  }
}

module.exports = { PaperTrader };
