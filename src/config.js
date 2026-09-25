require("dotenv").config();
const { PublicKey, LAMPORTS_PER_SOL } = require("@solana/web3.js");

const MODES = ["observar", "simular", "real"];
const SOURCES = ["websocket", "grpc"];

const PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisa tu .env)`);
  return value;
}

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} debe ser un número positivo, recibido: "${raw}"`);
  }
  return value;
}

const sol = (amount) => BigInt(Math.round(amount * LAMPORTS_PER_SOL));

function loadConfig() {
  const mode = (process.env.MODE || "observar").trim().toLowerCase();
  if (!MODES.includes(mode)) {
    throw new Error(`MODE debe ser uno de: ${MODES.join(", ")}`);
  }

  const source = (process.env.FUENTE || "websocket").trim().toLowerCase();
  if (!SOURCES.includes(source)) {
    throw new Error(`FUENTE debe ser uno de: ${SOURCES.join(", ")}`);
  }

  const watchList = required("WATCH_LIST")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const address of watchList) {
    try {
      new PublicKey(address);
    } catch {
      throw new Error(`Dirección inválida en WATCH_LIST: ${address}`);
    }
  }
  if (watchList.length === 0) throw new Error("WATCH_LIST está vacía");

  const config = {
    mode,
    source,
    watchList,

    buyLamports: sol(number("BUY_AMOUNT_SOL", 0.005)),
    minWhaleLamports: sol(number("MIN_WHALE_SOL", 0.1)),
    maxTotalLamports: sol(number("MAX_TOTAL_SOL", 0.03)),
    maxOpenPositions: number("MAX_OPEN_POSITIONS", 3),
    minReserveLamports: sol(number("MIN_SOL_RESERVE", 0.01)),
    slippageBps: String(number("SLIPPAGE_BPS", 300)),
    priorityFeeLevel: process.env.PRIORITY_FEE_LEVEL?.trim() || "high",

    simPenaltyPct: number("SIM_DELAY_PENALTY_PCT", 5),
    simFeeLamports: sol(number("SIM_FEE_SOL", 0.0002)),
    simStartLamports: sol(number("SIM_START_SOL", 0.05)),

    dataDir: process.env.DATA_DIR || "data",
  };

  if (source === "grpc") {
    config.yellowstoneEndpoint = required("YELLOWSTONE_ENDPOINT");
    config.yellowstoneToken = required("YELLOWSTONE_TOKEN");
  }
  if (source === "websocket" || mode === "real") {
    config.solanaRpc = required("SOLANA_RPC");
    config.solanaWss = process.env.SOLANA_WSS?.trim() || undefined;
  }
  if (mode === "real") {
    config.metisEndpoint = required("METIS_ENDPOINT").replace(/\/+$/, "");
    config.secretKey = required("SECRET_KEY");
  }

  return config;
}

module.exports = { loadConfig, PUMP_FUN_PROGRAM_ID, WSOL_MINT };
