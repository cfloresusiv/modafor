const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../src/store");
const { PaperTrader } = require("../src/paperTrader");
const { buyBlockedReason } = require("../src/guard");

const SOL = 1_000_000_000n;
const config = {
  buyLamports: SOL / 100n, // 0.01
  minWhaleLamports: SOL / 10n, // 0.1
  maxTotalLamports: SOL / 50n, // 0.02 → caben 2 compras
  maxOpenPositions: 3,
  simPenaltyPct: 5,
  simFeeLamports: 0n,
  simStartLamports: SOL,
};

const newStore = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), "lab-")), "simular", {});
const trade = (side, mint, lamports, tokenAmount) => ({
  signature: "sig", trader: "whale", side, mint, lamports, tokenAmount, decimals: 6, venue: "pump.fun",
});
console.log = () => {}; // silencia la salida del bot durante los tests

test("guard: bloquea operaciones pequeñas de la ballena", () => {
  const store = newStore();
  assert.match(buyBlockedReason(trade("BUY", "A", SOL / 100n, 1n), config, store), /pequeña/);
  assert.equal(buyBlockedReason(trade("BUY", "A", SOL, 1n), config, store), null);
});

test("guard: respeta MAX_TOTAL_SOL y no recompra el mismo token", async () => {
  const store = newStore();
  const paper = new PaperTrader(config, store);
  for (const m of ["A", "B", "C"]) {
    const t = trade("BUY", m, SOL, 1_000_000n);
    await paper.onBuy(t, buyBlockedReason(t, config, store));
  }
  assert.deepEqual(Object.keys(store.positions), ["A", "B"]);
  assert.equal(BigInt(store.state.spentLamports), config.maxTotalLamports);
  assert.match(buyBlockedReason(trade("BUY", "A", SOL, 1n), config, store), /ya tienes/);
});

test("simulación: aplica la penalización al comprar y vender", async () => {
  const store = newStore();
  const paper = new PaperTrader(config, store);
  // La ballena compra y vende al mismo precio: 1 lamport por unidad.
  await paper.onBuy(trade("BUY", "A", SOL, SOL), null);
  await paper.onSell(trade("SELL", "A", SOL, SOL));
  // Compra: 0.01 SOL / 1.05 → tokens; venta a 0.95 → pierde ~9.5 %.
  const pnl = BigInt(store.state.realizedLamports);
  assert.ok(pnl < 0n, "copiar al mismo precio debe perder por llegar tarde");
  assert.equal(pnl, BigInt(Math.floor(Math.floor(1e7 / 1.05) * 0.95)) - 10_000_000n);
  assert.equal(Object.keys(store.positions).length, 0);
});

test("simulación: el estado sobrevive a un reinicio", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-"));
  await new PaperTrader(config, new Store(dir, "simular", {})).onBuy(trade("BUY", "A", SOL, SOL), null);
  const reloaded = new Store(dir, "simular", {});
  assert.ok(reloaded.positions.A);
  assert.equal(fs.readFileSync(path.join(dir, "operaciones-simular.jsonl"), "utf-8").trim().split("\n").length, 1);
});

test("guard: no copia tokens graduados (PumpSwap u otro DEX)", () => {
  const t = { ...trade("BUY", "A", SOL, 1n), venue: "PumpSwap" };
  assert.match(buyBlockedReason(t, config, newStore()), /graduado/);
});
