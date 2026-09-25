const test = require("node:test");
const assert = require("node:assert");
const { analyze, verdict } = require("../src/evaluate");

const now = Math.floor(Date.now() / 1000);
const tx = (side, mint, sol, venue = "pump.fun", ago = 60) => ({
  blockTime: now - ago,
  trades: [{ side, mint, lamports: BigInt(sol * 1e9), venue }],
});

test("calcula ganancia realizada y acierto solo con tokens cerrados", () => {
  const history = [
    tx("BUY", "A", 1), tx("SELL", "A", 1.5, "PumpSwap"), // +0.5 (vende ya graduado)
    tx("BUY", "B", 1), tx("SELL", "B", 0.4),             // -0.6
    tx("BUY", "C", 2),                                   // abierto: no cuenta
  ];
  const a = analyze(history);
  assert.equal(a.closed, 2);
  assert.equal(a.winRate, 0.5);
  assert.equal(a.realized, BigInt(-0.1 * 1e9));
  assert.equal(a.curveBuys, 3);
  assert.equal(a.gradTrades, 1);
  assert.equal(a.tokens, 3);
});

test("recomienda una wallet activa, rentable y diversificada", () => {
  const history = [];
  for (const m of ["A", "B", "C", "D", "E", "F"]) history.push(tx("BUY", m, 1), tx("SELL", m, 1.3));
  assert.deepEqual(verdict(analyze(history)), []);
});

test("advierte de wallets inactivas o que casi no usan la curva", () => {
  const history = [tx("BUY", "A", 1, "PumpSwap", 5 * 24 * 3600), tx("SELL", "A", 2, "PumpSwap", 5 * 24 * 3600)];
  const problems = verdict(analyze(history)).join(" | ");
  assert.match(problems, /curva/);
  assert.match(problems, /inactiva/);
});
