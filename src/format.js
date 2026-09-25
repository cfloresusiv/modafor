const { LAMPORTS_PER_SOL } = require("@solana/web3.js");

const solStr = (lamports) => (Number(lamports) / LAMPORTS_PER_SOL).toFixed(6) + " SOL";

const tokenStr = (amount, decimals) => (Number(amount) / 10 ** decimals).toLocaleString("es");

const short = (address) => `${address.slice(0, 4)}…${address.slice(-4)}`;

module.exports = { solStr, tokenStr, short };
