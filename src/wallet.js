const bs58 = require("bs58").default;
const { Keypair } = require("@solana/web3.js");

/** Acepta la clave exportada de Phantom (base58) o un arreglo JSON [1,2,...]. */
function loadKeypair(secret) {
  const value = secret.trim();
  try {
    const bytes = value.startsWith("[")
      ? Uint8Array.from(JSON.parse(value))
      : bs58.decode(value);
    return Keypair.fromSecretKey(bytes);
  } catch {
    // No se incluye la clave en el mensaje de error a propósito.
    throw new Error("SECRET_KEY no tiene un formato válido (base58 de Phantom o arreglo JSON)");
  }
}

module.exports = { loadKeypair };
