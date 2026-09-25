const test = require("node:test");
const assert = require("node:assert");
const bs58 = require("bs58").default;
const { Keypair, PublicKey, TransactionMessage, AddressLookupTableAccount, SystemProgram } = require("@solana/web3.js");
const { parseTrades: parseNormalized, fromYellowstone, fromRpc } = require("../src/parser");
const { wsUrl } = require("../src/websocket");
const { WSOL_MINT } = require("../src/config");

const whale = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const watched = new Set([whale]);
const parseTrades = (tx, w) => parseNormalized(fromYellowstone(tx), w);

const bal = (accountIndex, owner, m, amount, decimals = 6) => ({
  accountIndex, owner, mint: m, programId: "", uiTokenAmount: { amount: String(amount), decimals },
});

function makeTx({ keys, pre, post, preTokens = [], postTokens = [], err, loaded = [] }) {
  return {
    signature: new Uint8Array(64).fill(7),
    transaction: { message: { accountKeys: keys.map((k) => bs58.decode(k)) } },
    meta: {
      err,
      preBalances: pre.map(String),
      postBalances: post.map(String),
      preTokenBalances: preTokens,
      postTokenBalances: postTokens,
      loadedWritableAddresses: loaded.map((k) => bs58.decode(k)),
      loadedReadonlyAddresses: [],
    },
  };
}

test("detecta una compra (sube token, baja SOL)", () => {
  const tx = makeTx({
    keys: [whale, other],
    pre: [2_000_000_000, 0],
    post: [1_500_000_000, 0],
    postTokens: [bal(1, whale, mint, 1_000_000_000)],
  });
  const [t] = parseTrades(tx, watched);
  assert.equal(t.side, "BUY");
  assert.equal(t.trader, whale);
  assert.equal(t.mint, mint);
  assert.equal(t.tokenAmount, 1_000_000_000n);
  assert.equal(t.lamports, 500_000_000n);
  assert.equal(t.decimals, 6);
  assert.equal(t.signature, bs58.encode(new Uint8Array(64).fill(7)));
});

test("detecta una venta (baja token, sube SOL)", () => {
  const tx = makeTx({
    keys: [whale, other],
    pre: [1_000_000_000, 0],
    post: [1_700_000_000, 0],
    preTokens: [bal(1, whale, mint, 900)],
    postTokens: [bal(1, whale, mint, 0)],
  });
  const [t] = parseTrades(tx, watched);
  assert.equal(t.side, "SELL");
  assert.equal(t.tokenAmount, 900n);
  assert.equal(t.lamports, 700_000_000n);
});

test("cuenta WSOL como SOL cuando un router lo envuelve", () => {
  const tx = makeTx({
    keys: [whale, other],
    pre: [1_000_000_000, 0],
    post: [1_000_000_000, 0],
    preTokens: [bal(1, whale, WSOL_MINT, 300_000_000, 9)],
    postTokens: [bal(1, whale, WSOL_MINT, 0, 9), bal(1, whale, mint, 50)],
  });
  const [t] = parseTrades(tx, watched);
  assert.equal(t.side, "BUY");
  assert.equal(t.lamports, 300_000_000n);
});

test("encuentra a la wallet en direcciones cargadas por lookup table", () => {
  const tx = makeTx({
    keys: [other],
    loaded: [whale],
    pre: [0, 2_000],
    post: [0, 1_000],
    postTokens: [bal(1, whale, mint, 10)],
  });
  const [t] = parseTrades(tx, watched);
  assert.equal(t.trader, whale);
  assert.equal(t.lamports, 1_000n);
});

test("ignora transacciones fallidas", () => {
  const tx = makeTx({
    keys: [whale], pre: [2], post: [1], postTokens: [bal(0, whale, mint, 10)], err: { err: new Uint8Array([1]) },
  });
  assert.deepEqual(parseTrades(tx, watched), []);
});

test("ignora tokens recibidos sin pagar SOL (airdrop/transferencia)", () => {
  const tx = makeTx({
    keys: [whale], pre: [1_000], post: [1_000], postTokens: [bal(0, whale, mint, 10)],
  });
  assert.deepEqual(parseTrades(tx, watched), []);
});

test("ignora movimientos de wallets no seguidas", () => {
  const tx = makeTx({
    keys: [other], pre: [2_000], post: [1_000], postTokens: [bal(0, other, mint, 10)],
  });
  assert.deepEqual(parseTrades(tx, watched), []);
});

test("formato RPC (WebSocket): incluye cuentas de lookup tables", () => {
  const payer = Keypair.generate().publicKey;
  const lookupTable = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [new PublicKey(whale)] },
  });
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(whale), lamports: 1 })],
  }).compileToV0Message([lookupTable]);
  // payer y System Program quedan como claves estáticas; la ballena llega por la lookup table.
  const rpcTx = {
    transaction: { message },
    meta: {
      err: null,
      preBalances: [5_000, 1, 2_000],
      postBalances: [5_000, 1, 1_000],
      preTokenBalances: [],
      postTokenBalances: [bal(3, whale, mint, 42)],
      loadedAddresses: { writable: [new PublicKey(whale)], readonly: [] },
    },
  };
  const normalized = fromRpc("firma123", rpcTx);
  assert.equal(normalized.accountKeys[2], whale);
  const [t] = parseNormalized(normalized, watched);
  assert.equal(t.signature, "firma123");
  assert.equal(t.side, "BUY");
  assert.equal(t.lamports, 1_000n);
  assert.equal(t.tokenAmount, 42n);
});

test("wsUrl convierte la URL http del RPC en ws", () => {
  assert.equal(wsUrl("https://x.quiknode.pro/abc/"), "wss://x.quiknode.pro/abc/");
  assert.equal(wsUrl("http://localhost:8899"), "ws://localhost:8899");
});
