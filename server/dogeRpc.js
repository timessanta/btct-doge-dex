// DOGE API Client for DEX (Blockcypher for queries, local node for broadcast)
const BLOCKCYPHER_BASE = 'https://api.blockcypher.com/v1/doge/main';

// Local Dogecoin Core RPC (for broadcast)
const DOGE_RPC_URL = 'http://127.0.0.1:22555';
const DOGE_RPC_USER = process.env.DOGE_RPC_USER || 'dogerpc';
const DOGE_RPC_PASS = process.env.DOGE_RPC_PASS || '';

// Balance cache
const balanceCache = new Map();
const CACHE_TTL_MS = 90000; // 90 seconds

function appendToken(url) {
  if (!process.env.BLOCKCYPHER_TOKEN) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${process.env.BLOCKCYPHER_TOKEN}`;
}

async function apiGet(path) {
  const url = appendToken(`${BLOCKCYPHER_BASE}${path}`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blockcypher GET ${path} [${res.status}]: ${text}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const url = appendToken(`${BLOCKCYPHER_BASE}${path}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blockcypher POST ${path} [${res.status}]: ${text}`);
  }
  return res.json();
}

async function getAddressBalance(address) {
  const cached = balanceCache.get(address);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return { balance: cached.balance, unconfirmed: cached.unconfirmed, final_balance: cached.final_balance };
  }
  try {
    const data = await apiGet(`/addrs/${address}/balance`);
    const result = { balance: data.balance || 0, unconfirmed: data.unconfirmed_balance || 0, final_balance: data.final_balance || 0 };
    balanceCache.set(address, { ...result, timestamp: now });
    return result;
  } catch (e) {
    // On rate limit (429) or error, return stale cache if available
    if (cached) {
      console.warn(`[DOGE] Balance fetch failed for ${address}, using stale cache: ${e.message}`);
      return { balance: cached.balance, unconfirmed: cached.unconfirmed, final_balance: cached.final_balance };
    }
    throw e;
  }
}

async function getBlockHeight() {
  const data = await apiGet('');
  return data.height;
}

async function getTransactionsByAddress(address, limit = 20) {
  try {
    const data = await apiGet(`/addrs/${address}?limit=${limit}`);
    return data.txrefs || [];
  } catch (e) {
    return [];
  }
}

const SATOSHIS_PER_DOGE = 1e8;

function dogeToSatoshis(doge) {
  return Math.round(Number(doge) * SATOSHIS_PER_DOGE);
}

function satoshisToDoge(satoshis) {
  return Number(satoshis) / SATOSHIS_PER_DOGE;
}

async function getUTXOs(address) {
  const bitcore = require('bitcore-lib-doge');
  const data = await apiGet(`/addrs/${address}?unspentOnly=true&includeScript=true`);
  const utxos = [];
  const refs = [...(data.txrefs || []), ...(data.unconfirmed_txrefs || [])];
  const addr = new bitcore.Address(address);
  const fallbackScript = addr.isPayToScriptHash()
    ? bitcore.Script.buildScriptHashOut(addr).toHex()
    : bitcore.Script.buildPublicKeyHashOut(addr).toHex();
  for (const ref of refs) {
    if (ref.spent) continue;
    const script = ref.script || fallbackScript;
    utxos.push({
      txId: ref.tx_hash,
      outputIndex: ref.tx_output_n,
      address: address,
      script: script,
      satoshis: ref.value
    });
  }
  return utxos;
}

// Broadcast raw TX via local Dogecoin Core RPC (sendrawtransaction)
async function broadcastRawTx(rawHex) {
  const auth = Buffer.from(`${DOGE_RPC_USER}:${DOGE_RPC_PASS}`).toString('base64');
  const res = await fetch(DOGE_RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify({
      jsonrpc: '1.0',
      id: 'dex-broadcast',
      method: 'sendrawtransaction',
      params: [rawHex]
    })
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`DOGE RPC sendrawtransaction: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data.result; // txid
}

async function sendWithWif(wif, toAddress, amountSat) {
  const bitcore = require('bitcore-lib-doge');
  const privateKey = new bitcore.PrivateKey(wif);
  const fromAddress = privateKey.toAddress().toString();
  const utxos = await getUTXOs(fromAddress);
  if (utxos.length === 0) throw new Error('No UTXOs (balance is 0)');

  const totalSat = utxos.reduce((sum, u) => sum + u.satoshis, 0);
  const feeSat = 1000000; // 0.01 DOGE

  if (totalSat < amountSat + feeSat) {
    throw new Error(`Insufficient balance. Have: ${satoshisToDoge(totalSat)} DOGE, need: ${satoshisToDoge(amountSat + feeSat)} DOGE (including 0.01 fee)`);
  }

  const tx = new bitcore.Transaction()
    .from(utxos)
    .to(toAddress, amountSat)
    .fee(feeSat)
    .change(fromAddress)
    .sign(privateKey);

  const rawHex = tx.serialize();
  const txid = await broadcastRawTx(rawHex);
  console.log(`[DOGE] Sent ${satoshisToDoge(amountSat)} DOGE from ${fromAddress} → ${toAddress}, txid: ${txid}`);
  return { txid, fee: satoshisToDoge(feeSat) };
}

module.exports = {
  getAddressBalance,
  getBlockHeight,
  getTransactionsByAddress,
  getUTXOs,
  sendWithWif,
  broadcastRawTx,
  SATOSHIS_PER_DOGE,
  dogeToSatoshis,
  satoshisToDoge
};
