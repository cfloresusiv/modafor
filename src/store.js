/**
 * Guarda el estado del bot en disco para que sobreviva a reinicios:
 *   data/estado-<modo>.json      posiciones abiertas, gasto y resultado acumulado
 *   data/operaciones-<modo>.jsonl  historial, una operación por línea
 */
const fs = require("fs");
const path = require("path");

class Store {
  constructor(dataDir, mode, initial) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.statePath = path.join(dataDir, `estado-${mode}.json`);
    this.journalPath = path.join(dataDir, `operaciones-${mode}.jsonl`);
    this.state = fs.existsSync(this.statePath)
      ? JSON.parse(fs.readFileSync(this.statePath, "utf-8"))
      : { positions: {}, spentLamports: "0", realizedLamports: "0", ...initial };
  }

  get positions() {
    return this.state.positions;
  }

  save() {
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  log(entry) {
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    );
    fs.appendFileSync(this.journalPath, line + "\n");
  }
}

module.exports = { Store };
