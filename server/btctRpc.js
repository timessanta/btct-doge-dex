// BTCT RPC Client for DEX
const BTCT_RPC_URL = process.env.BTCT_RPC_URL || 'http://127.0.0.1:12211';

let requestId = 0;

async function rpcCall(method, params = []) {
  requestId++;
  const response = await fetch(BTCT_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: requestId })
  });
  const data = await response.json();
  if (data.error) throw new Error(`RPC Error: ${JSON.stringify(data.error)}`);
  return data.result;
}

async function getBalance(address) {
  return await rpcCall('getBalance', [address.replace(/^0x/, '')]);
}

async function getBlockNumber() {
  return await rpcCall('blockNumber');
}

async function getBlockByNumber(height, includeBody = true) {
  return await rpcCall('getBlockByNumber', [height, includeBody]);
}

async function sendRawTransaction(txHex) {
  return await rpcCall('sendRawTransaction', [txHex]);
}

async function getTransactionByHash(hash) {
  return await rpcCall('getTransactionByHash', [hash]);
}

// Get account info (needed to check HTLC contract details)
async function getAccount(address) {
  return await rpcCall('getAccount', [address.replace(/^0x/, '')]);
}

async function getPeerCount() {
  return await rpcCall('peerCount');
}

async function getConsensus() {
  return await rpcCall('consensus');
}

const SATOSHIS_PER_BTCT = 1e11;

function satoshisToBTCT(satoshis) {
  return Number(satoshis) / SATOSHIS_PER_BTCT;
}

function btctToSatoshis(btct) {
  return Math.round(Number(btct) * SATOSHIS_PER_BTCT);
}

module.exports = {
  rpcCall,
  getBalance,
  getBlockNumber,
  getBlockByNumber,
  sendRawTransaction,
  getTransactionByHash,
  getAccount,
  getPeerCount,
  getConsensus,
  SATOSHIS_PER_BTCT,
  satoshisToBTCT,
  btctToSatoshis
};
