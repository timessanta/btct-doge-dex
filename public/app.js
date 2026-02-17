// ===================== DEX CLIENT (Atomic Swap via HTLC) =====================
// Server holds NO private keys. All signing happens client-side.
const socket = io();

let currentUser = null;  // { btctAddress, btctKey, dogeAddress, dogeWif }
let currentPage = 'market';
let currentTradeId = null;
let kryptonReady = false;
let adminToken = localStorage.getItem('dex_admin_token') || null;

// ===================== KRYPTON WASM INIT =====================

(async function initWasm() {
  try {
    await Krypton.WasmHelper.doImport();
    kryptonReady = true;
    console.log('[WASM] Krypton initialized');
  } catch (e) {
    console.error('[WASM] Init failed:', e);
  }
})();

async function ensureKrypton() {
  if (kryptonReady) return;
  await Krypton.WasmHelper.doImport();
  kryptonReady = true;
}

// ===================== API HELPERS =====================

async function api(path, opts = {}) {
  const url = '/api' + path;
  const config = { 
    headers: { ...(opts.headers || {}) }
  };
  if (opts.method) config.method = opts.method;

  if (opts.body) {
    config.method = config.method || 'POST';
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(opts.body);
  }

  const res = await fetch(url, config);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API Error');
  return data;
}

// ===================== UNIT CONVERSION =====================

const BTCT_SAT = 1e11;
const DOGE_SAT = 1e8;

function satToBTCT(sat) { return (Number(sat) / BTCT_SAT).toFixed(5); }
function btctToSat(btct) { return Math.round(Number(btct) * BTCT_SAT); }
function satToDOGE(sat) { return (Number(sat) / DOGE_SAT).toFixed(4); }
function dogeToSat(doge) { return Math.round(Number(doge) * DOGE_SAT); }

function shortAddr(addr) {
  if (!addr) return '—';
  const a = addr.startsWith('0x') ? addr : '0x' + addr;
  return a.substring(0, 10) + '...' + a.substring(a.length - 4);
}

// ===================== MULTI-WALLET LOCAL STORAGE =====================

function getStoredBtctWallets() {
  try { return JSON.parse(localStorage.getItem('dex_btct_wallets') || '{}'); } catch { return {}; }
}

function getStoredDogeWallets() {
  try { return JSON.parse(localStorage.getItem('dex_doge_wallets') || '{}'); } catch { return {}; }
}

function saveBtctWallet(address, key) {
  const addr = (address || '').replace(/^0x/, '').toLowerCase();
  const wallets = getStoredBtctWallets();
  wallets[addr] = key;
  localStorage.setItem('dex_btct_wallets', JSON.stringify(wallets));
}

function saveDogeWallet(address, wif) {
  const wallets = getStoredDogeWallets();
  wallets[address] = wif;
  localStorage.setItem('dex_doge_wallets', JSON.stringify(wallets));
}

function getActiveBtctAddr() { return localStorage.getItem('dex_active_btct') || ''; }
function setActiveBtctAddr(addr) { localStorage.setItem('dex_active_btct', (addr || '').replace(/^0x/, '').toLowerCase()); }
function getActiveDogeAddr() { return localStorage.getItem('dex_active_doge') || ''; }
function setActiveDogeAddr(addr) { localStorage.setItem('dex_active_doge', addr || ''); }

function getBtctKeyForAddr(addr) {
  const a = (addr || '').replace(/^0x/, '').toLowerCase();
  return getStoredBtctWallets()[a] || null;
}

function getDogeWifForAddr(addr) {
  return getStoredDogeWallets()[addr] || null;
}

function hasLocalBtctKey(addr) { return !!getBtctKeyForAddr(addr); }
function hasLocalDogeWif(addr) { return !!getDogeWifForAddr(addr); }

function syncCurrentUser() {
  const btctAddr = getActiveBtctAddr();
  const dogeAddr = getActiveDogeAddr();
  if (!btctAddr) {
    currentUser = null;
    localStorage.removeItem('dex_wallet');
    return;
  }
  currentUser = {
    btctAddress: btctAddr,
    btctKey: getBtctKeyForAddr(btctAddr) || '',
    dogeAddress: dogeAddr || '',
    dogeWif: getDogeWifForAddr(dogeAddr) || ''
  };
  localStorage.setItem('dex_wallet', JSON.stringify(currentUser));
}

// ===================== WALLET CONNECTION (no registration!) =====================

function connectWallet() {
  // Check if we already have wallets in multi-wallet store
  const btctWallets = getStoredBtctWallets();
  if (Object.keys(btctWallets).length > 0) {
    syncCurrentUser();
    updateUI();
    navigateTo('wallet');
    return;
  }

  // Check localStorage for saved wallet (legacy)
  const saved = localStorage.getItem('dex_wallet');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      if (data.btctAddress && data.btctKey) {
        saveBtctWallet(data.btctAddress, data.btctKey);
        setActiveBtctAddr(data.btctAddress);
      }
      if (data.dogeAddress && data.dogeWif) {
        saveDogeWallet(data.dogeAddress, data.dogeWif);
        setActiveDogeAddr(data.dogeAddress);
      }
      syncCurrentUser();
      updateUI();
      return;
    } catch (e) { /* ignore */ }
  }

  // Show connect options
  const container = document.getElementById('app');
  container.innerHTML = `
    <div class="card" style="max-width: 500px; margin: 40px auto;">
      <h2 style="margin-bottom: 20px;">Connect Wallet</h2>
      <p class="dim small" style="margin-bottom: 20px;">
        No registration. Your private keys stay in your browser.
      </p>

      <div style="margin-bottom: 20px;">
        <h4 style="margin-bottom: 10px;">BTCT Wallet</h4>
        <button class="btn" onclick="generateBtctWallet()" style="margin-bottom: 8px;">Generate New Wallet</button>
        <p class="dim small" style="margin-bottom: 8px;">or import existing:</p>
        <input type="text" id="importBtctKey" placeholder="BTCT Private Key (hex)" style="width:100%; padding: 8px; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px;">
        <button class="btn btn-sm btn-outline" onclick="importBtctWallet()" style="margin-top: 6px;">Import</button>
      </div>

      <div id="btctWalletInfo" class="hidden info-box" style="margin-bottom: 20px;"></div>

      <div style="margin-bottom: 20px;">
        <h4 style="margin-bottom: 10px;">DOGE Wallet (optional)</h4>
        <button class="btn" onclick="generateDogeWallet()" style="margin-bottom: 8px;">Generate New DOGE Wallet</button>
        <p class="dim small" style="margin-bottom: 8px;">or import existing WIF key:</p>
        <input type="text" id="importDogeWif" placeholder="DOGE Private Key (WIF)" style="width:100%; padding: 8px; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px; margin-bottom: 6px;">
        <button class="btn btn-sm btn-outline" onclick="importDogeWallet()" style="margin-bottom: 6px;">Import</button>
        <input type="text" id="importDogeAddr" placeholder="DOGE Address (auto-filled)" style="width:100%; padding: 8px; background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: 6px;" readonly>
      </div>
      <div id="dogeWalletInfo" class="hidden info-box" style="margin-bottom: 20px;"></div>

      <button class="btn btn-green" id="finalConnectBtn" onclick="finalizeConnect()" disabled>Connect</button>
    </div>
  `;
}

async function generateBtctWallet() {
  await ensureKrypton();
  const wallet = await Krypton.Wallet.generate();
  const privKey = wallet.keyPair.privateKey.toHex();
  const addr = wallet.address.toHex();

  document.getElementById('importBtctKey').value = privKey;
  document.getElementById('btctWalletInfo').classList.remove('hidden');
  document.getElementById('btctWalletInfo').innerHTML = `
    <p class="success-text"><strong>✓ New wallet generated!</strong></p>
    <p class="small" style="margin-top: 4px;">Address: <span class="mono">0x${addr}</span></p>
    <p class="small error-text" style="margin-top: 6px;">⚠ BACKUP your private key! It only exists in this browser.</p>
    <p class="mono small" style="margin-top: 4px; word-break: break-all; user-select: all;">${privKey}</p>
  `;
  document.getElementById('finalConnectBtn').disabled = false;

  // Store temporarily
  window._tempBtctKey = privKey;
  window._tempBtctAddr = addr;
}

async function importBtctWallet() {
  await ensureKrypton();
  let key = document.getElementById('importBtctKey').value.trim();
  if (!key) return alert('Enter a private key');
  key = key.replace(/^0x/, '');

  try {
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(key));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const addr = keyPair.publicKey.toAddress().toHex();

    document.getElementById('btctWalletInfo').classList.remove('hidden');
    document.getElementById('btctWalletInfo').innerHTML = `
      <p class="success-text"><strong>✓ Wallet imported!</strong></p>
      <p class="small" style="margin-top: 4px;">Address: <span class="mono">0x${addr}</span></p>
    `;
    document.getElementById('finalConnectBtn').disabled = false;

    window._tempBtctKey = key;
    window._tempBtctAddr = addr;
  } catch (e) {
    alert('Invalid private key: ' + e.message);
  }
}

async function generateDogeWallet() {
  try {
    const result = await api('/doge/generate', { method: 'POST' });
    document.getElementById('importDogeWif').value = result.wif;
    document.getElementById('importDogeAddr').value = result.address;

    const infoEl = document.getElementById('dogeWalletInfo');
    infoEl.classList.remove('hidden');
    infoEl.innerHTML = `
      <p class="success-text"><strong>✓ DOGE wallet generated!</strong></p>
      <p class="small" style="margin-top: 4px;">Address: <span class="mono">${result.address}</span></p>
      <p class="small error-text" style="margin-top: 6px;">⚠ BACKUP your WIF key! It only exists in this browser.</p>
      <p class="mono small" style="margin-top: 4px; word-break: break-all; user-select: all;">${result.wif}</p>
    `;

    window._tempDogeAddr = result.address;
    window._tempDogeWif = result.wif;
  } catch (e) {
    alert('DOGE wallet generation failed: ' + e.message);
  }
}

async function importDogeWallet() {
  const wif = document.getElementById('importDogeWif').value.trim();
  if (!wif) return alert('Enter a WIF private key');

  try {
    const result = await api('/doge/import', { body: { wif } });
    document.getElementById('importDogeAddr').value = result.address;

    const infoEl = document.getElementById('dogeWalletInfo');
    infoEl.classList.remove('hidden');
    infoEl.innerHTML = `
      <p class="success-text"><strong>✓ DOGE wallet imported!</strong></p>
      <p class="small" style="margin-top: 4px;">Address: <span class="mono">${result.address}</span></p>
    `;

    window._tempDogeAddr = result.address;
    window._tempDogeWif = result.wif;
  } catch (e) {
    alert('Invalid WIF key: ' + e.message);
  }
}

function finalizeConnect() {
  if (!window._tempBtctKey || !window._tempBtctAddr) {
    return alert('Generate or import a BTCT wallet first');
  }

  const addr = window._tempBtctAddr.replace(/^0x/, '').toLowerCase();
  saveBtctWallet(addr, window._tempBtctKey);
  setActiveBtctAddr(addr);

  const dogeAddr = window._tempDogeAddr || '';
  const dogeWif = window._tempDogeWif || '';
  if (dogeAddr && dogeWif) {
    saveDogeWallet(dogeAddr, dogeWif);
    setActiveDogeAddr(dogeAddr);
  }

  syncCurrentUser();
  delete window._tempBtctKey;
  delete window._tempBtctAddr;
  delete window._tempDogeAddr;
  delete window._tempDogeWif;

  updateUI();
  navigateTo('market');
}

function disconnectWallet() {
  if (!confirm('Disconnect wallet?\n\n⚠ This will remove ALL private keys from this browser.\nMake sure you have backed them up!')) return;

  // Clear all dex_ entries
  const keys = Object.keys(localStorage);
  for (const k of keys) {
    if (k.startsWith('dex_')) localStorage.removeItem(k);
  }

  currentUser = null;
  updateUI();
  navigateTo('market');
}

function updateUI() {
  const userInfo = document.getElementById('userInfo');
  const connectBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');

  if (currentUser) {
    userInfo.textContent = shortAddr(currentUser.btctAddress);
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    userInfo.textContent = '';
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  }
}

// ===================== NAVIGATION =====================

function navigateTo(page, param, pushHash = true) {
  currentPage = page;
  if (param !== undefined && page === 'trade') currentTradeId = param;

  // Update URL hash
  if (pushHash) {
    if (page === 'trade' && currentTradeId) {
      location.hash = 'trade/' + currentTradeId;
    } else {
      location.hash = page;
    }
  }

  document.querySelectorAll('.nav-link').forEach((el, i) => {
    const pages = ['market', 'myAds', 'myTrades', 'wallet'];
    el.classList.toggle('active', pages[i] === page);
  });

  const container = document.getElementById('app');

  switch (page) {
    case 'market': loadMarket(container); break;
    case 'myAds': loadMyAds(container); break;
    case 'myTrades': loadMyTrades(container); break;
    case 'wallet': loadWallet(container); break;
    case 'trade': loadTradeDetail(container, currentTradeId); break;
    case 'krypton': loadAdminPage(container); break;
    default: loadMarket(container);
  }
}

// ===================== MARKET =====================

async function loadMarket(el) {
  el.innerHTML = `
    <div class="card-header">
      <h2>Bulletin Board</h2>
      <button class="btn" onclick="showModal('createAdModal')" ${currentUser ? '' : 'disabled title="Connect wallet first"'}>Post Listing</button>
    </div>
    <div id="listingList"><div class="empty">Loading...</div></div>
  `;

  try {
    const ads = await api('/ads');
    const listingList = document.getElementById('listingList');
    if (ads.length === 0) {
      listingList.innerHTML = '<div class="empty">No listings yet. Post one!</div>';
      return;
    }

    listingList.innerHTML = ads.map(ad => {
      const isMine = currentUser && currentUser.btctAddress.toLowerCase() === ad.btct_address.toLowerCase();
      return `
        <div class="listing-card">
          <div class="listing-info">
            <span class="type-badge ${ad.type}">${ad.type === 'sell' ? 'SELL' : 'BUY'} BTCT</span>
            <div class="listing-price">1 BTCT = ${Number(ad.price).toFixed(4)} DOGE</div>
            <div class="listing-detail">
              Range: ${satToBTCT(ad.min_btct)} – ${satToBTCT(ad.remaining)} BTCT
            </div>
            <div class="listing-addr">${shortAddr(ad.btct_address)}</div>
          </div>
          <div>
            ${!isMine && currentUser ? `<button class="btn btn-sm ${ad.type === 'sell' ? 'btn-green' : 'btn-red'}" onclick="openTradeModal(${ad.id})">${ad.type === 'sell' ? 'Buy' : 'Sell'}</button>` : ''}
            ${!currentUser ? '<span class="dim small">Connect to trade</span>' : ''}
            ${isMine ? '<span class="dim small">Your ad</span>' : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('listingList').innerHTML = `<div class="empty error-text">${e.message}</div>`;
  }
}

// ===================== MY ADS =====================

async function loadMyAds(el) {
  if (!currentUser) {
    el.innerHTML = '<div class="empty">Connect wallet to see your listings</div>';
    return;
  }

  el.innerHTML = `
    <div class="card-header">
      <h2>My Listings</h2>
      <button class="btn" onclick="showModal('createAdModal')">Post Listing</button>
    </div>
    <div id="myListingList"><div class="empty">Loading...</div></div>
  `;

  try {
    const allAds = await api('/ads');
    const myAds = allAds.filter(a => a.btct_address.toLowerCase() === currentUser.btctAddress.toLowerCase());

    const list = document.getElementById('myListingList');
    if (myAds.length === 0) {
      list.innerHTML = '<div class="empty">No listings yet</div>';
      return;
    }

    list.innerHTML = myAds.map(ad => `
      <div class="listing-card">
        <div class="listing-info">
          <span class="type-badge ${ad.type}">${ad.type === 'sell' ? 'SELL' : 'BUY'}</span>
          <div class="listing-price">1 BTCT = ${Number(ad.price).toFixed(4)} DOGE</div>
          <div class="listing-detail">Remaining: ${satToBTCT(ad.remaining)} BTCT</div>
        </div>
        <button class="btn btn-sm btn-red" onclick="closeAd(${ad.id})">Close</button>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('myListingList').innerHTML = `<div class="empty error-text">${e.message}</div>`;
  }
}

async function closeAd(adId) {
  if (!currentUser) return;
  if (!confirm('Close this ad?')) return;
  try {
    await api(`/ads/${adId}/close`, { body: { btctAddress: currentUser.btctAddress } });
    navigateTo('myAds');
  } catch (e) { alert(e.message); }
}

// ===================== MY TRADES =====================

async function loadMyTrades(el) {
  if (!currentUser) {
    el.innerHTML = '<div class="empty">Connect wallet to see your swaps</div>';
    return;
  }

  el.innerHTML = '<div class="card-header"><h2>Swap History</h2></div><div id="myTradeList"><div class="empty">Loading...</div></div>';

  try {
    const trades = await api(`/trades?address=${currentUser.btctAddress}`);
    const list = document.getElementById('myTradeList');
    if (trades.length === 0) {
      list.innerHTML = '<div class="empty">No swaps yet</div>';
      return;
    }

    list.innerHTML = trades.map(t => `
      <div class="listing-card" onclick="openTrade(${t.id})" style="cursor:pointer;">
        <div class="listing-info">
          <strong>Trade #${t.id}</strong>
          <div class="listing-detail">${satToBTCT(t.btct_amount)} BTCT ↔ ${satToDOGE(t.doge_amount)} DOGE</div>
          <div class="listing-addr">
            Seller: ${shortAddr(t.seller_address)} · Buyer: ${shortAddr(t.buyer_address)}
          </div>
        </div>
        <span class="trade-status ${t.status}">${tradeStatusLabel(t.status)}</span>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('myTradeList').innerHTML = `<div class="empty error-text">${e.message}</div>`;
  }
}

function openTrade(tradeId) {
  currentTradeId = tradeId;
  navigateTo('trade');
}

// ===================== WALLET =====================

async function loadWallet(el) {
  if (!currentUser) {
    el.innerHTML = '<div class="empty">Connect wallet to view balances</div>';
    return;
  }

  const btctWallets = getStoredBtctWallets();
  const dogeWallets = getStoredDogeWallets();
  const btctAddrs = Object.keys(btctWallets);
  const dogeAddrs = Object.keys(dogeWallets);
  const activeBtct = getActiveBtctAddr();
  const activeDoge = getActiveDogeAddr();
  const hasBtctKey = activeBtct ? !!btctWallets[activeBtct] : false;
  const hasDogeWif = activeDoge ? !!dogeWallets[activeDoge] : false;

  // BTCT wallet selector
  let btctSelectHTML = '';
  if (btctAddrs.length > 0) {
    btctSelectHTML = `
      <div style="margin-top:8px;">
        <label>Switch Wallet</label>
        <select id="btctWalletSelect" class="wallet-select" onchange="switchBtctWallet(this.value)">
          ${btctAddrs.map(a => {
            const icon = btctWallets[a] ? '🔑' : '🔒';
            return `<option value="${a}" ${a === activeBtct ? 'selected' : ''}>${icon} 0x${a.slice(0,6)}...${a.slice(-4)}</option>`;
          }).join('')}
        </select>
      </div>`;
  }

  // DOGE wallet selector
  let dogeSelectHTML = '';
  if (dogeAddrs.length > 0) {
    dogeSelectHTML = `
      <div style="margin-top:8px;">
        <label>Switch Wallet</label>
        <select id="dogeWalletSelect" class="wallet-select" onchange="switchDogeWallet(this.value)">
          ${dogeAddrs.map(a => {
            const icon = dogeWallets[a] ? '🔑' : '🔒';
            return `<option value="${a}" ${a === activeDoge ? 'selected' : ''}>${icon} ${a.slice(0,8)}...${a.slice(-6)}</option>`;
          }).join('')}
        </select>
      </div>`;
  }

  el.innerHTML = `
    <h2>Wallet</h2>
    <div class="wallet-cards">
      <!-- BTCT Card -->
      <div class="wallet-card">
        <div class="wallet-card-header">
          <span class="wallet-coin-name">BTCT</span>
          <span class="wallet-coin-label">Bitcoin Time</span>
        </div>
        <div class="wallet-balance">
          <span class="balance-label">Balance</span>
          <span class="balance-value" id="walletBtctBalance">Loading...</span>
        </div>

        <div class="wallet-section">
          <label>Active BTCT Address</label>
          <div class="address-box" onclick="copyText(this)" title="Click to copy">
            ${activeBtct ? '0x' + activeBtct : 'Not set'}
          </div>
          ${btctSelectHTML}
        </div>

        <div class="wallet-actions" style="margin:10px 0; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="walletGenerateBtct()">🔑 New Wallet</button>
          <button class="btn btn-sm btn-outline" onclick="walletToggleBtctImport()">📥 Import Key</button>
          <button class="btn btn-sm btn-outline ${!hasBtctKey ? 'hidden' : ''}" onclick="walletExportBtctKey()">🔓 Export Key</button>
          <button class="btn btn-sm btn-outline btn-danger ${btctAddrs.length === 0 ? 'hidden' : ''}" onclick="walletDeleteBtct()">🗑 Delete</button>
        </div>

        <div id="walletBtctImportSection" class="hidden">
          <hr class="divider">
          <h4>Import Private Key</h4>
          <p class="small">Enter your BTCT private key (64-char hex).</p>
          <label>Private Key (Hex)</label>
          <input type="password" id="walletBtctImportKey" placeholder="64-character hex..." autocomplete="off">
          <button class="btn btn-full" onclick="walletImportBtctKey()" style="margin-top:8px;">Import</button>
        </div>

        <div id="walletBtctBackup" class="hidden">
          <div class="wallet-backup-box">
            <h4>⚠ IMPORTANT — Save your private key!</h4>
            <p class="small">Lost if you clear browser data!</p>
            <label>Private Key (Hex)</label>
            <div class="info-box mono wif-display" id="walletBtctGeneratedKey"></div>
            <button class="btn btn-sm" onclick="copyText(document.getElementById('walletBtctGeneratedKey'))">📋 Copy Key</button>
          </div>
        </div>

        <div id="walletBtctSendSection" class="${!hasBtctKey ? 'hidden' : ''}">
          <hr class="divider">
          <h4>Send BTCT</h4>
          <label>Recipient Address</label>
          <input type="text" id="btctSendTo" placeholder="0x...">
          <label>Amount (BTCT)</label>
          <input type="number" id="btctSendAmount" step="0.00000000001" placeholder="0.00000000000">
          <p class="small fee-notice">Network fee: 0.00001 BTCT</p>
          <button class="btn btn-full" onclick="walletSendBtct()">Send BTCT</button>
        </div>

        <hr class="divider">
        <details>
          <summary class="small">Add address without private key (receive only)</summary>
          <div class="help-box">
            <p><strong>What is this?</strong></p>
            <p>Register a BTCT address for receiving only, without storing the private key in your browser.</p>
            <p><strong>Use case:</strong></p>
            <ul>
              <li>You have an external wallet (web wallet, another node, etc.)</li>
              <li>You want to receive BTCT directly to that wallet</li>
              <li>You'll manage sending from the external wallet</li>
            </ul>
            <p class="small" style="color:#f0ad4e;">⚠ You cannot send from this address via this page. Receive only.</p>
          </div>
          <input type="text" id="walletBtctManualAddr" placeholder="0x..." style="margin-top:6px;">
          <button class="btn btn-sm" onclick="walletSaveBtctAddr()" style="margin-top:6px;">Add Address</button>
        </details>

        <div id="btctSendError" class="error hidden"></div>
        <div id="btctSendSuccess" class="success-text hidden"></div>
      </div>

      <!-- DOGE Card -->
      <div class="wallet-card">
        <div class="wallet-card-header">
          <span class="wallet-coin-name">DOGE</span>
          <span class="wallet-coin-label">Dogecoin</span>
        </div>
        <div class="wallet-balance">
          <span class="balance-label">Balance</span>
          <span class="balance-value" id="walletDogeBalance">Loading...</span>
        </div>

        <div class="wallet-section">
          <label>Active DOGE Address</label>
          <div class="address-box" onclick="copyText(this)" title="Click to copy">
            ${activeDoge || 'Not set'}
          </div>
          ${dogeSelectHTML}
        </div>

        <div class="wallet-actions" style="margin:10px 0; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="walletGenerateDoge()">🔑 New Wallet</button>
          <button class="btn btn-sm btn-outline" onclick="walletToggleDogeImport()">📥 Import Key</button>
          <button class="btn btn-sm btn-outline ${!hasDogeWif ? 'hidden' : ''}" onclick="walletExportDogeKey()">🔓 Export Key</button>
          <button class="btn btn-sm btn-outline btn-danger ${dogeAddrs.length === 0 ? 'hidden' : ''}" onclick="walletDeleteDoge()">🗑 Delete</button>
        </div>

        <div id="walletDogeImportSection" class="hidden">
          <hr class="divider">
          <h4>Import Private Key</h4>
          <p class="small">Already have a DOGE wallet? Import your WIF private key.</p>
          <label>Private Key (WIF)</label>
          <input type="password" id="walletDogeImportWif" placeholder="Q..." autocomplete="off">
          <button class="btn btn-full" onclick="walletImportDogeKey()" style="margin-top:8px;">Import</button>
        </div>

        <div id="walletDogeBackup" class="hidden">
          <div class="wallet-backup-box">
            <h4>⚠ IMPORTANT — Save your private key!</h4>
            <p class="small">Lost if you clear browser data!</p>
            <label>Private Key (WIF)</label>
            <div class="info-box mono wif-display" id="walletGeneratedWif"></div>
            <button class="btn btn-sm" onclick="copyText(document.getElementById('walletGeneratedWif'))">📋 Copy Key</button>
          </div>
        </div>

        <div id="walletDogeSendSection" class="${!hasDogeWif ? 'hidden' : ''}">
          <hr class="divider">
          <h4>Send DOGE</h4>
          <label>Recipient Address</label>
          <input type="text" id="walletDogeSendTo" placeholder="D...">
          <label>Amount (DOGE)</label>
          <input type="number" id="walletDogeSendAmount" step="0.01" placeholder="0.00">
          <p class="small fee-notice">Network fee: ~0.01 DOGE</p>
          <button class="btn btn-full" onclick="walletSendDoge()">Send DOGE</button>
        </div>

        <hr class="divider">
        <details>
          <summary class="small">Add address without private key (receive only)</summary>
          <div class="help-box">
            <p><strong>What is this?</strong></p>
            <p>Register a DOGE address for receiving only, without storing the private key in your browser.</p>
            <p><strong>Use case:</strong></p>
            <ul>
              <li>You have a hardware wallet or external wallet</li>
              <li>You want to receive DOGE directly to that wallet</li>
              <li>You'll manage sending from the external wallet</li>
            </ul>
            <p class="small" style="color:#f0ad4e;">⚠ You cannot send from this address via this page. Receive only.</p>
          </div>
          <input type="text" id="walletDogeManualAddr" placeholder="D..." style="margin-top:6px;">
          <button class="btn btn-sm" onclick="walletSaveDogeAddr()" style="margin-top:6px;">Add Address</button>
        </details>

        <div id="walletDogeError" class="error hidden"></div>
        <div id="walletDogeSuccess" class="success-text hidden"></div>
      </div>
    </div>
  `;

  // Fetch balances
  if (activeBtct) {
    try {
      const bal = await api(`/btct/balance/${activeBtct}`);
      document.getElementById('walletBtctBalance').textContent = satToBTCT(bal.balance) + ' BTCT';
    } catch (e) {
      document.getElementById('walletBtctBalance').textContent = 'Error';
    }
  } else {
    document.getElementById('walletBtctBalance').textContent = '0 BTCT';
  }

  if (activeDoge) {
    try {
      const bal = await api(`/doge/balance/${activeDoge}`);
      document.getElementById('walletDogeBalance').textContent = satToDOGE(bal.balance) + ' DOGE';
    } catch (e) {
      document.getElementById('walletDogeBalance').textContent = 'Error';
    }
  } else {
    document.getElementById('walletDogeBalance').textContent = '0 DOGE';
  }
}

// ===================== WALLET ACTIONS =====================

function showWalletMsg(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

function switchBtctWallet(addr) {
  setActiveBtctAddr(addr);
  syncCurrentUser();
  updateUI();
  navigateTo('wallet');
}

function switchDogeWallet(addr) {
  setActiveDogeAddr(addr);
  syncCurrentUser();
  updateUI();
  navigateTo('wallet');
}

async function walletGenerateBtct() {
  try {
    await ensureKrypton();
    const wallet = Krypton.Wallet.generate();
    const address = wallet.address.toHex().toLowerCase();
    const privateKeyHex = wallet.keyPair.privateKey.toHex();

    saveBtctWallet(address, privateKeyHex);
    setActiveBtctAddr(address);
    syncCurrentUser();
    updateUI();
    navigateTo('wallet');

    setTimeout(() => {
      const keyEl = document.getElementById('walletBtctGeneratedKey');
      const backupEl = document.getElementById('walletBtctBackup');
      if (keyEl) keyEl.textContent = privateKeyHex;
      if (backupEl) backupEl.classList.remove('hidden');
      showWalletMsg('btctSendSuccess', `✓ New wallet created: 0x${address}`);
    }, 100);
  } catch (err) {
    showWalletMsg('btctSendError', err.message);
  }
}

function walletToggleBtctImport() {
  const el = document.getElementById('walletBtctImportSection');
  if (el) el.classList.toggle('hidden');
}

async function walletImportBtctKey() {
  let keyInput = document.getElementById('walletBtctImportKey').value.trim();
  if (!keyInput) return showWalletMsg('btctSendError', 'Enter your private key (64-char hex)');
  if (keyInput.startsWith('0x') || keyInput.startsWith('0X')) keyInput = keyInput.slice(2);
  if (keyInput.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyInput)) {
    return showWalletMsg('btctSendError', 'Invalid private key format. Must be 64 hex characters.');
  }

  try {
    await ensureKrypton();
    const wallet = Krypton.Wallet.importPrivateKey(keyInput);
    if (!wallet) return showWalletMsg('btctSendError', 'Failed to import private key');
    const address = wallet.address.toHex().toLowerCase();

    saveBtctWallet(address, keyInput);
    setActiveBtctAddr(address);
    syncCurrentUser();
    updateUI();
    navigateTo('wallet');

    setTimeout(() => {
      showWalletMsg('btctSendSuccess', `✓ Imported: 0x${address}`);
    }, 100);
  } catch (err) {
    showWalletMsg('btctSendError', err.message || 'Import failed');
  }
}

function walletExportBtctKey() {
  const activeBtct = getActiveBtctAddr();
  if (!activeBtct) return;
  const key = getBtctKeyForAddr(activeBtct);
  if (!key) return showWalletMsg('btctSendError', 'No private key for active address');

  const backupEl = document.getElementById('walletBtctBackup');
  if (!backupEl.classList.contains('hidden')) {
    backupEl.classList.add('hidden');
    return;
  }
  document.getElementById('walletBtctGeneratedKey').textContent = key;
  backupEl.classList.remove('hidden');
}

function walletDeleteBtct() {
  const activeBtct = getActiveBtctAddr();
  if (!activeBtct) return;

  if (!confirm(`Delete wallet 0x${activeBtct}?\n\n⚠ WARNING: The private key will be permanently removed!`)) return;

  const wallets = getStoredBtctWallets();
  delete wallets[activeBtct];
  localStorage.setItem('dex_btct_wallets', JSON.stringify(wallets));

  const remaining = Object.keys(wallets);
  if (remaining.length > 0) {
    setActiveBtctAddr(remaining[0]);
  } else {
    localStorage.removeItem('dex_active_btct');
  }
  syncCurrentUser();
  updateUI();
  if (!currentUser) { navigateTo('market'); return; }
  navigateTo('wallet');
}

function walletSaveBtctAddr() {
  let addr = (document.getElementById('walletBtctManualAddr').value || '').trim();
  if (!addr) return showWalletMsg('btctSendError', 'Enter a BTCT address');
  addr = addr.replace(/^0x/, '').toLowerCase();

  const wallets = getStoredBtctWallets();
  if (!wallets[addr]) wallets[addr] = '';
  localStorage.setItem('dex_btct_wallets', JSON.stringify(wallets));
  setActiveBtctAddr(addr);
  syncCurrentUser();
  updateUI();
  navigateTo('wallet');
  setTimeout(() => showWalletMsg('btctSendSuccess', '✓ Address added (receive only)'), 100);
}

async function walletSendBtct() {
  if (!currentUser) return;
  const activeBtct = getActiveBtctAddr();
  const key = getBtctKeyForAddr(activeBtct);
  if (!key) return showWalletMsg('btctSendError', 'No private key for active wallet');

  const toAddr = document.getElementById('btctSendTo').value.trim();
  const amount = document.getElementById('btctSendAmount').value.trim();
  if (!toAddr) return showWalletMsg('btctSendError', 'Enter recipient address');
  if (!amount || Number(amount) <= 0) return showWalletMsg('btctSendError', 'Enter valid amount');

  if (!confirm(`Send ${amount} BTCT to ${toAddr}?\n\nNetwork fee: 0.00001 BTCT`)) return;

  document.getElementById('btctSendError').classList.add('hidden');
  document.getElementById('btctSendSuccess').classList.add('hidden');

  try {
    const { height: blockNumber } = await api('/btct/block');
    await ensureKrypton();

    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(key));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();
    const recipientAddr = Krypton.Address.fromHex(toAddr.replace(/^0x/, ''));
    const valueSat = btctToSat(amount);

    const tx = new Krypton.ExtendedTransaction(
      senderAddr,
      Krypton.Account.Type.BASIC,
      recipientAddr,
      Krypton.Account.Type.BASIC,
      Number(valueSat),
      blockNumber + 1,
      Krypton.Transaction.Flag.NONE,
      new Uint8Array(0)
    );

    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const proof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();
    tx.proof = proof;

    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    showWalletMsg('btctSendSuccess', `✓ Sent! Tx: ${result.hash}`);
    document.getElementById('btctSendTo').value = '';
    document.getElementById('btctSendAmount').value = '';
    setTimeout(() => navigateTo('wallet'), 3000);
  } catch (err) {
    showWalletMsg('btctSendError', err.message);
  }
}

// DOGE wallet actions
async function walletGenerateDoge() {
  try {
    const result = await api('/doge/generate', { method: 'POST' });
    saveDogeWallet(result.address, result.wif);
    setActiveDogeAddr(result.address);
    syncCurrentUser();
    updateUI();
    navigateTo('wallet');

    setTimeout(() => {
      const wifEl = document.getElementById('walletGeneratedWif');
      const backupEl = document.getElementById('walletDogeBackup');
      if (wifEl) wifEl.textContent = result.wif;
      if (backupEl) backupEl.classList.remove('hidden');
      showWalletMsg('walletDogeSuccess', `✓ New wallet created: ${result.address}`);
    }, 100);
  } catch (err) {
    showWalletMsg('walletDogeError', err.message);
  }
}

function walletToggleDogeImport() {
  const el = document.getElementById('walletDogeImportSection');
  if (el) el.classList.toggle('hidden');
}

async function walletImportDogeKey() {
  const wifInput = document.getElementById('walletDogeImportWif').value.trim();
  if (!wifInput) return showWalletMsg('walletDogeError', 'Enter your private key (WIF)');

  try {
    const result = await api('/doge/import', { body: { wif: wifInput } });
    saveDogeWallet(result.address, wifInput);
    setActiveDogeAddr(result.address);
    syncCurrentUser();
    updateUI();
    navigateTo('wallet');

    setTimeout(() => {
      showWalletMsg('walletDogeSuccess', `✓ Imported: ${result.address}`);
    }, 100);
  } catch (err) {
    showWalletMsg('walletDogeError', err.message || 'Import failed');
  }
}

function walletExportDogeKey() {
  const activeDoge = getActiveDogeAddr();
  if (!activeDoge) return;
  const wif = getDogeWifForAddr(activeDoge);
  if (!wif) return showWalletMsg('walletDogeError', 'No private key for active address');

  const backupEl = document.getElementById('walletDogeBackup');
  if (!backupEl.classList.contains('hidden')) {
    backupEl.classList.add('hidden');
    return;
  }
  document.getElementById('walletGeneratedWif').textContent = wif;
  backupEl.classList.remove('hidden');
}

function walletDeleteDoge() {
  const activeDoge = getActiveDogeAddr();
  if (!activeDoge) return;

  if (!confirm(`Delete wallet ${activeDoge}?\n\n⚠ WARNING: The private key will be permanently removed!`)) return;

  const wallets = getStoredDogeWallets();
  delete wallets[activeDoge];
  localStorage.setItem('dex_doge_wallets', JSON.stringify(wallets));

  const remaining = Object.keys(wallets);
  if (remaining.length > 0) {
    setActiveDogeAddr(remaining[0]);
  } else {
    localStorage.removeItem('dex_active_doge');
  }
  syncCurrentUser();
  updateUI();
  navigateTo('wallet');
}

function walletSaveDogeAddr() {
  const addr = (document.getElementById('walletDogeManualAddr').value || '').trim();
  if (!addr) return showWalletMsg('walletDogeError', 'Enter a DOGE address');

  const wallets = getStoredDogeWallets();
  if (!wallets[addr]) wallets[addr] = '';
  localStorage.setItem('dex_doge_wallets', JSON.stringify(wallets));
  setActiveDogeAddr(addr);
  syncCurrentUser();
  updateUI();
  navigateTo('wallet');
  setTimeout(() => showWalletMsg('walletDogeSuccess', '✓ Address added (receive only)'), 100);
}

// Sign & broadcast DOGE transaction entirely client-side (non-custodial)
async function signAndSendDoge(wif, toAddress, amountDoge) {
  const bitcore = window.bitcoreDoge;
  if (!bitcore) throw new Error('bitcore-doge not loaded');

  const privateKey = new bitcore.PrivateKey(wif);
  const fromAddress = privateKey.toAddress().toString();
  const amountSat = Math.round(Number(amountDoge) * 1e8);
  const feeSat = 1000000; // 0.01 DOGE

  // Get UTXOs from server (no private key sent)
  const utxos = await api(`/doge/utxos/${fromAddress}`);
  if (!utxos || utxos.length === 0) throw new Error('No UTXOs (balance is 0)');

  const totalSat = utxos.reduce((sum, u) => sum + u.satoshis, 0);
  if (totalSat < amountSat + feeSat) {
    throw new Error(`Insufficient balance. Have: ${(totalSat / 1e8).toFixed(8)} DOGE, need: ${((amountSat + feeSat) / 1e8).toFixed(8)} DOGE`);
  }

  // Build & sign transaction client-side
  const tx = new bitcore.Transaction()
    .from(utxos)
    .to(toAddress, amountSat)
    .fee(feeSat)
    .change(fromAddress)
    .sign(privateKey);

  const rawTx = tx.serialize();

  // Broadcast signed TX (server only sees raw hex, never private key)
  const result = await api('/doge/broadcast', { body: { rawTx } });
  return { txid: result.txid, fee: 0.01 };
}

async function walletSendDoge() {
  if (!currentUser || !currentUser.dogeAddress) return;
  const wif = getDogeWifForAddr(currentUser.dogeAddress);
  if (!wif) return showWalletMsg('walletDogeError', 'No private key for active address');

  const toAddr = document.getElementById('walletDogeSendTo').value.trim();
  const amount = document.getElementById('walletDogeSendAmount').value.trim();
  if (!toAddr) return showWalletMsg('walletDogeError', 'Enter recipient address');
  if (!amount || Number(amount) <= 0) return showWalletMsg('walletDogeError', 'Enter valid amount');

  if (!confirm(`Send ${amount} DOGE to ${toAddr}?\n\nNetwork fee: ~0.01 DOGE`)) return;

  document.getElementById('walletDogeError').classList.add('hidden');
  document.getElementById('walletDogeSuccess').classList.add('hidden');

  try {
    const result = await signAndSendDoge(wif, toAddr, Number(amount));

    showWalletMsg('walletDogeSuccess', `✓ Sent! Tx: ${result.txid}`);
    document.getElementById('walletDogeSendTo').value = '';
    document.getElementById('walletDogeSendAmount').value = '';
    setTimeout(() => navigateTo('wallet'), 3000);
  } catch (err) {
    showWalletMsg('walletDogeError', err.message);
  }
}

// ===================== CREATE AD =====================

async function submitAd() {
  if (!currentUser) return alert('Connect wallet first');

  const type = document.getElementById('adType').value;
  const price = document.getElementById('adPrice').value;
  const minBtct = btctToSat(document.getElementById('adMin').value);
  const maxBtct = btctToSat(document.getElementById('adMax').value);

  if (!price || !minBtct || !maxBtct) return alert('Fill all fields');

  try {
    await api('/ads', {
      body: { btctAddress: currentUser.btctAddress, type, price, minBtct, maxBtct }
    });
    closeModal('createAdModal');
    navigateTo('market');
  } catch (e) { alert(e.message); }
}

// ===================== TRADE INITIATION =====================

let pendingAd = null;

async function openTradeModal(adId) {
  if (!currentUser) return;
  try {
    const ads = await api('/ads');
    pendingAd = ads.find(a => a.id === adId);
    if (!pendingAd) return alert('Ad not found');

    document.getElementById('tradeModalInfo').innerHTML = `
      <div class="info-box">
        <span class="type-badge ${pendingAd.type}">${pendingAd.type === 'sell' ? 'SELL' : 'BUY'}</span>
        <strong> 1 BTCT = ${Number(pendingAd.price).toFixed(4)} DOGE</strong>
        <p class="dim small" style="margin-top:4px;">Range: ${satToBTCT(pendingAd.min_btct)} – ${satToBTCT(pendingAd.remaining)} BTCT</p>
      </div>
    `;
    document.getElementById('tradeAmount').value = '';
    document.getElementById('tradeSummary').innerHTML = '';

    document.getElementById('tradeAmount').oninput = () => {
      const amt = Number(document.getElementById('tradeAmount').value);
      if (amt > 0) {
        const dogeAmt = amt * Number(pendingAd.price);
        document.getElementById('tradeSummary').innerHTML = `
          <strong>${amt.toFixed(5)} BTCT</strong> ↔ <strong>${dogeAmt.toFixed(4)} DOGE</strong>
          <br><span class="dim small">Atomic swap via HTLC — trustless, no middleman</span>
        `;
      }
    };

    showModal('tradeModal');
  } catch (e) { alert(e.message); }
}

async function submitTrade() {
  if (!currentUser || !pendingAd) return;
  const amount = Number(document.getElementById('tradeAmount').value);
  if (amount <= 0) return alert('Enter a valid amount');

  try {
    const trade = await api('/trades', {
      body: {
        adId: pendingAd.id,
        buyerAddress: currentUser.btctAddress,
        btctAmount: btctToSat(amount)
      }
    });

    closeModal('tradeModal');
    pendingAd = null;
    currentTradeId = trade.id;
    navigateTo('trade');
  } catch (e) { alert(e.message); }
}

// ===================== TRADE DETAIL (Atomic Swap Flow) =====================

async function loadTradeDetail(el, tradeId) {
  if (!tradeId) { navigateTo('myTrades'); return; }

  try {
    const trade = await api(`/trades/${tradeId}`);
    currentTradeId = trade.id;
    socket.emit('joinTrade', trade.id);

    const isSeller = currentUser && currentUser.btctAddress.toLowerCase() === trade.seller_address.toLowerCase();
    const isBuyer = currentUser && currentUser.btctAddress.toLowerCase() === trade.buyer_address.toLowerCase();

    const steps = ['Hash Published', 'BTCT Locked', 'DOGE Locked', 'Seller Redeems', 'Buyer Redeems'];
    const stepStates = getStepStates(trade.status);

    let actionHTML = getActionHTML(trade, isSeller, isBuyer);

    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Trade #${trade.id}</h2>
          <span class="trade-status ${trade.status}">${tradeStatusLabel(trade.status)}</span>
        </div>

        <div class="info-box">
          <strong>${satToBTCT(trade.btct_amount)} BTCT</strong> ↔ <strong>${satToDOGE(trade.doge_amount)} DOGE</strong>
          &nbsp;(1 BTCT = ${Number(trade.price).toFixed(4)} DOGE)<br>
          <span class="small dim">Seller: ${shortAddr(trade.seller_address)} · Buyer: ${shortAddr(trade.buyer_address)}</span>
        </div>

        <div class="swap-steps">
          ${steps.map((s, i) => `<div class="swap-step ${stepStates[i]}"><span class="step-num">${i + 1}</span>${s}</div>`).join('')}
        </div>

        ${actionHTML}

        ${trade.status === 'completed' ? `
          <div class="info-box success-text">
            ✓ Atomic swap completed!
            ${trade.doge_redeem_tx ? `<br>DOGE TX: ${trade.doge_redeem_tx}` : ''}
            ${trade.btct_redeem_tx ? `<br>BTCT TX: ${trade.btct_redeem_tx}` : ''}
          </div>
        ` : ''}

        ${['negotiating', 'hash_published'].includes(trade.status) ? `
          <button class="btn btn-red btn-sm" style="margin-top:16px;" onclick="cancelTrade(${trade.id})">Cancel Trade</button>
        ` : ''}

        <div class="chat-section">
          <h4>Chat</h4>
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-input">
            <input type="text" id="chatInput" placeholder="Type a message..." maxlength="500" onkeypress="if(event.key==='Enter') sendChat()">
            <button class="btn btn-sm" onclick="sendChat()">Send</button>
          </div>
        </div>
      </div>
    `;

    loadChatMessages(trade.id);
  } catch (e) {
    el.innerHTML = `<div class="empty error-text">${e.message}</div>`;
  }
}

function getStepStates(status) {
  const order = ['hash_published', 'btct_locked', 'doge_locked', 'seller_redeemed', 'completed'];
  const idx = order.indexOf(status);
  return order.map((_, i) => {
    if (status === 'negotiating') return i === 0 ? 'active' : '';
    if (i < idx) return 'done';
    if (i === idx) return 'active';
    return '';
  });
}

function getActionHTML(trade, isSeller, isBuyer) {
  if (trade.status === 'completed' || trade.status === 'cancelled' || trade.status === 'expired') return '';

  // Step 1: Seller publishes hash
  if (trade.status === 'negotiating' && isSeller) {
    return `
      <div class="action-box">
        <h4>Step 1: Generate Secret & Publish Hash</h4>
        <p>Generate a cryptographic secret. Its hash will be used to lock both sides of the trade.</p>
        <button class="btn btn-purple" onclick="publishHash(${trade.id})">Generate Secret & Publish Hash</button>
      </div>
    `;
  }

  if (trade.status === 'negotiating' && isBuyer) {
    return `<div class="action-box"><h4>Waiting for seller to publish hash...</h4><p>The seller needs to generate a secret and publish its hash.</p></div>`;
  }

  // Step 2: Seller locks BTCT in HTLC
  if (trade.status === 'hash_published' && isSeller) {
    return `
      <div class="action-box">
        <h4>Step 2: Lock BTCT in HTLC</h4>
        <p>Create an HTLC contract locking your BTCT. The buyer can claim with the secret, or you get a refund after timeout.</p>
        <p class="dim small">Hash: <span class="mono">${trade.hash_lock}</span></p>
        <p class="dim small">Amount: ${satToBTCT(trade.btct_amount)} BTCT</p>
        <button class="btn" onclick="lockBTCT(${trade.id})">Lock BTCT in HTLC</button>
      </div>
    `;
  }

  if (trade.status === 'hash_published' && isBuyer) {
    return `<div class="action-box"><h4>Waiting for seller to lock BTCT...</h4><p>Hash: <span class="mono">${trade.hash_lock}</span></p></div>`;
  }

  // Step 3: Buyer locks DOGE
  if (trade.status === 'btct_locked' && isBuyer) {
    return `
      <div class="action-box">
        <h4>Step 3: Send DOGE</h4>
        <p>Send ${satToDOGE(trade.doge_amount)} DOGE to the seller's address.</p>
        <p class="dim small">Seller DOGE Address: <span class="mono">${trade.seller_doge_address}</span></p>
        <p class="dim small">BTCT HTLC: <span class="mono">0x${trade.btct_htlc_address}</span></p>
        <p class="dim small">Hash: <span class="mono">${trade.hash_lock}</span></p>
        <button class="btn btn-green" onclick="sendDogeAutomatically(${trade.id})">Send ${satToDOGE(trade.doge_amount)} DOGE</button>
      </div>
    `;
  }

  if (trade.status === 'btct_locked' && isSeller) {
    return `
      <div class="action-box">
        <h4>Waiting for buyer to lock DOGE...</h4>
        <p>Your BTCT is locked in HTLC: <span class="mono">0x${trade.btct_htlc_address}</span></p>
        <p class="dim small">Timeout: block ${trade.btct_timeout}</p>
      </div>
    `;
  }

  // Step 4: Seller redeems DOGE (reveals secret)
  if (trade.status === 'doge_locked' && isSeller) {
    const secret = localStorage.getItem(`dex_secret_${trade.id}`);
    return `
      <div class="action-box">
        <h4>Step 4: Redeem DOGE (Reveals Secret)</h4>
        <p>Claim the DOGE by revealing your secret. This will allow the buyer to also redeem the BTCT.</p>
        <p class="dim small">Your Secret: <span class="mono">${secret || 'NOT FOUND — check localStorage!'}</span></p>
        <button class="btn btn-green" onclick="sellerRedeem(${trade.id})">Reveal Secret & Redeem DOGE</button>
      </div>
    `;
  }

  if (trade.status === 'doge_locked' && isBuyer) {
    return `<div class="action-box"><h4>Waiting for seller to redeem DOGE...</h4><p>Once redeemed, the secret will be revealed and you can claim your BTCT.</p></div>`;
  }

  // Step 5: Buyer redeems BTCT with revealed secret
  if (trade.status === 'seller_redeemed' && isBuyer) {
    return `
      <div class="action-box">
        <h4>Step 5: Redeem BTCT</h4>
        <p class="success-text">Secret revealed! Use it to claim your BTCT from the HTLC.</p>
        <p class="dim small">Secret: <span class="mono">${trade.secret_revealed}</span></p>
        <p class="dim small">BTCT HTLC: <span class="mono">0x${trade.btct_htlc_address}</span></p>
        <button class="btn btn-green" onclick="buyerRedeem(${trade.id})">Redeem BTCT</button>
      </div>
    `;
  }

  if (trade.status === 'seller_redeemed' && isSeller) {
    return `<div class="action-box"><h4>Waiting for buyer to redeem BTCT...</h4><p class="success-text">✓ You've claimed your DOGE!</p></div>`;
  }

  return '';
}

// ===================== ATOMIC SWAP ACTIONS =====================

// Step 1: Seller generates secret and publishes hash
async function publishHash(tradeId) {
  if (!currentUser) return;
  await ensureKrypton();

  try {
    // Generate random secret (32 bytes)
    const secretBytes = Krypton.PrivateKey.generate().serialize();
    const secretHex = Krypton.BufferUtils.toHex(secretBytes);

    // Hash with SHA256
    const hashBytes = await Krypton.Hash.computeSha256(secretBytes);
    const hashHex = Krypton.BufferUtils.toHex(hashBytes);

    // Save secret locally (NEVER sent to server!)
    localStorage.setItem(`dex_secret_${tradeId}`, secretHex);

    // Publish hash to server
    await api(`/trades/${tradeId}/hash`, {
      body: { sellerAddress: currentUser.btctAddress, hashLock: hashHex }
    });

    alert('✓ Hash published! Your secret is saved locally.\n\nSECRET (backup!): ' + secretHex);
    socket.emit('tradeUpdate', { tradeId, status: 'hash_published' });
    navigateTo('trade');
  } catch (e) { alert(e.message); }
}

// Step 2: Seller locks BTCT in HTLC
async function lockBTCT(tradeId) {
  if (!currentUser) return;
  await ensureKrypton();

  try {
    const trade = await api(`/trades/${tradeId}`);
    const blockHeight = (await api('/btct/block')).height;

    // Build HTLC transaction client-side
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();

    const htlcSender = senderAddr; // Seller (can refund after timeout)
    const htlcRecipient = Krypton.Address.fromHex(trade.buyer_address); // Buyer (can claim with secret)
    const hashAlgo = Krypton.Hash.Algorithm.SHA256;
    const hashRoot = Krypton.BufferUtils.fromHex(trade.hash_lock);
    const hashCount = 1;
    const timeout = blockHeight + 1440; // ~24 hours

    // Serialize HTLC data
    const bufSize = htlcSender.serializedSize + htlcRecipient.serializedSize + 1 + hashRoot.byteLength + 1 + 4;
    const data = new Krypton.SerialBuffer(bufSize);
    htlcSender.serialize(data);
    htlcRecipient.serialize(data);
    data.writeUint8(hashAlgo);
    data.write(hashRoot);
    data.writeUint8(hashCount);
    data.writeUint32(timeout);

    // Create ExtendedTransaction (CONTRACT_CREATION)
    const value = Number(trade.btct_amount);
    const tx = new Krypton.ExtendedTransaction(
      senderAddr,
      Krypton.Account.Type.BASIC,
      Krypton.Address.CONTRACT_CREATION,
      Krypton.Account.Type.HTLC,
      value,
      blockHeight + 1,
      Krypton.Transaction.Flag.CONTRACT_CREATION,
      data
    );

    // Sign
    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const proof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();
    tx.proof = proof;

    // Get contract address
    const htlcAddress = tx.getContractCreationAddress();

    // Broadcast
    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    // Report to server
    await api(`/trades/${tradeId}/btct-locked`, {
      body: {
        sellerAddress: currentUser.btctAddress,
        htlcTx: result.hash,
        htlcAddress: htlcAddress.toHex(),
        timeout: timeout
      }
    });

    alert('✓ BTCT locked in HTLC!\nContract: 0x' + htlcAddress.toHex() + '\nTimeout: block ' + timeout);
    socket.emit('tradeUpdate', { tradeId, status: 'btct_locked' });
    navigateTo('trade');
  } catch (e) {
    alert('HTLC creation failed: ' + e.message);
    console.error(e);
  }
}

// Step 3: Buyer sends DOGE automatically
async function sendDogeAutomatically(tradeId) {
  if (!currentUser || !currentUser.dogeKey) return alert('DOGE wallet not connected');

  try {
    const trade = await api(`/trades/${tradeId}`);
    const dogeAmount = satToDOGE(trade.doge_amount);
    const toAddress = trade.seller_doge_address;

    if (!toAddress) return alert('Seller DOGE address not found');

    const confirmed = confirm(`Send ${dogeAmount} DOGE to ${toAddress}?`);
    if (!confirmed) return;

    // Sign & send DOGE client-side (private key never leaves browser)
    const result = await signAndSendDoge(currentUser.dogeKey, toAddress, dogeAmount);

    alert(`✓ DOGE sent!\nTX: ${result.txid}`);

    // Report to server
    await reportDogeLocked(tradeId, result.txid);
  } catch (e) {
    alert('DOGE send failed: ' + e.message);
    console.error(e);
  }
}

// Step 3: Report DOGE locked (called by sendDogeAutomatically or manually)
async function reportDogeLocked(tradeId, dogeTxHash) {
  if (!currentUser) return;
  if (!dogeTxHash) {
    dogeTxHash = document.getElementById('dogeTxHash')?.value.trim();
    if (!dogeTxHash) return alert('Enter DOGE TX hash');
  }

  try {
    await api(`/trades/${tradeId}/doge-locked`, {
      body: {
        buyerAddress: currentUser.btctAddress,
        htlcTx: dogeTxHash,
        htlcAddress: 'auto', // Auto-sent via DEX wallet
        timeout: 0
      }
    });
    socket.emit('tradeUpdate', { tradeId, status: 'doge_locked' });
    navigateTo('trade');
  } catch (e) { alert(e.message); }
}

// Step 4: Seller redeems DOGE (reveals secret)
async function sellerRedeem(tradeId) {
  if (!currentUser) return;
  const secret = localStorage.getItem(`dex_secret_${tradeId}`);
  if (!secret) return alert('Secret not found in localStorage!');

  try {
    // TODO: Actually redeem DOGE from P2SH using secret
    // For now, manually mark as redeemed
    await api(`/trades/${tradeId}/seller-redeemed`, {
      body: {
        sellerAddress: currentUser.btctAddress,
        redeemTx: 'manual-' + Date.now(),
        secret: secret
      }
    });
    socket.emit('tradeUpdate', { tradeId, status: 'seller_redeemed', detail: { secret } });
    navigateTo('trade');
  } catch (e) { alert(e.message); }
}

// Step 5: Buyer redeems BTCT with revealed secret
async function buyerRedeem(tradeId) {
  if (!currentUser) return;
  await ensureKrypton();

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.secret_revealed) return alert('Secret not yet revealed');

    const blockHeight = (await api('/btct/block')).height;
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const recipientAddr = keyPair.publicKey.toAddress();

    // Get HTLC balance
    const htlcAddr = trade.btct_htlc_address;
    const htlcAccount = await api(`/btct/account/${htlcAddr}`);
    const htlcBalance = Number(htlcAccount.balance);
    if (htlcBalance <= 0) return alert('HTLC balance is 0');

    // Build redeem transaction
    const htlcAddress = Krypton.Address.fromHex(htlcAddr);
    const tx = new Krypton.ExtendedTransaction(
      htlcAddress,
      Krypton.Account.Type.HTLC,
      recipientAddr,
      Krypton.Account.Type.BASIC,
      htlcBalance,
      blockHeight + 1,
      Krypton.Transaction.Flag.NONE,
      new Uint8Array(0)
    );

    // Build HTLC proof (REGULAR_TRANSFER with preImage)
    const hashAlgo = Krypton.Hash.Algorithm.SHA256;
    const hashSize = 32; // SHA256
    const secretBytes = Krypton.BufferUtils.fromHex(trade.secret_revealed);
    const hashRoot = Krypton.BufferUtils.fromHex(trade.hash_lock);

    // Proof: type(1) + algo(1) + depth(1) + hashRoot(32) + preImage(32) + signatureProof(~68)
    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const sigProof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();

    const proof = new Krypton.SerialBuffer(1 + 1 + 1 + hashSize + hashSize + sigProof.byteLength);
    proof.writeUint8(Krypton.HashedTimeLockedContract.ProofType.REGULAR_TRANSFER);
    proof.writeUint8(hashAlgo);
    proof.writeUint8(1); // hashDepth
    proof.write(hashRoot);
    proof.write(secretBytes);
    proof.write(sigProof);

    tx.proof = proof;

    // Broadcast
    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    // Report completion
    await api(`/trades/${tradeId}/buyer-redeemed`, {
      body: { buyerAddress: currentUser.btctAddress, redeemTx: result.hash }
    });

    alert('✓ BTCT redeemed! Trade complete!\nTX: ' + result.hash);
    socket.emit('tradeUpdate', { tradeId, status: 'completed' });
    navigateTo('trade');
  } catch (e) {
    alert('BTCT redeem failed: ' + e.message);
    console.error(e);
  }
}

// ===================== CANCEL TRADE =====================

async function cancelTrade(tradeId) {
  if (!currentUser) return;
  if (!confirm('Cancel this trade?')) return;
  try {
    await api(`/trades/${tradeId}/cancel`, {
      body: { address: currentUser.btctAddress }
    });
    navigateTo('myTrades');
  } catch (e) { alert(e.message); }
}

// ===================== CHAT =====================

async function loadChatMessages(tradeId) {
  try {
    const msgs = await api(`/trades/${tradeId}/messages`);
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = msgs.map(m => renderChatMsg(m)).join('');
    container.scrollTop = container.scrollHeight;
  } catch (e) { /* ignore */ }
}

function renderChatMsg(msg) {
  const t = new Date(msg.created_at).toLocaleTimeString();
  return `<div class="chat-msg"><span class="sender">${shortAddr(msg.sender_address)}</span> <span class="time">${t}</span><br>${escapeHtml(msg.content)}</div>`;
}

function sendChat() {
  if (!currentUser || !currentTradeId) return;
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content) return;

  socket.emit('chatMessage', {
    tradeId: currentTradeId,
    senderAddress: currentUser.btctAddress,
    content
  });
  input.value = '';
}

socket.on('newMessage', (msg) => {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  container.innerHTML += renderChatMsg(msg);
  container.scrollTop = container.scrollHeight;
});

socket.on('tradeStatusUpdate', (data) => {
  if (data.tradeId === currentTradeId && currentPage === 'trade') {
    loadTradeDetail(document.getElementById('app'), currentTradeId);
  }
});

// ===================== UTILS =====================

function tradeStatusLabel(status) {
  const map = {
    negotiating: 'Negotiating',
    hash_published: 'Hash Published',
    btct_locked: 'BTCT Locked',
    doge_locked: 'DOGE Locked',
    seller_redeemed: 'Seller Redeemed',
    completed: 'Completed',
    expired: 'Expired',
    cancelled: 'Cancelled'
  };
  return map[status] || status;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
window.showModal = showModal;
window.closeModal = closeModal;

function copyText(el) {
  navigator.clipboard.writeText(el.textContent);
}

// ===================== INIT =====================

// Restore session (migrate from old single-wallet format if needed)
(function restoreSession() {
  const saved = localStorage.getItem('dex_wallet');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      // Migrate old single-wallet to multi-wallet if needed
      if (data.btctAddress && data.btctKey) {
        const addr = data.btctAddress.replace(/^0x/, '').toLowerCase();
        const btctWallets = getStoredBtctWallets();
        if (!btctWallets[addr]) {
          saveBtctWallet(addr, data.btctKey);
        }
        if (!getActiveBtctAddr()) setActiveBtctAddr(addr);
      }
      if (data.dogeAddress && data.dogeWif) {
        const dogeWallets = getStoredDogeWallets();
        if (!dogeWallets[data.dogeAddress]) {
          saveDogeWallet(data.dogeAddress, data.dogeWif);
        }
        if (!getActiveDogeAddr()) setActiveDogeAddr(data.dogeAddress);
      }
    } catch (e) { /* ignore */ }
  }
  syncCurrentUser();
  updateUI();
})();

// ===================== ADMIN =====================

async function adminApi(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}), 'Authorization': 'Bearer ' + adminToken };
  return api(path, opts);
}

async function adminLogin() {
  const id = document.getElementById('adminId').value.trim();
  const pw = document.getElementById('adminPw').value;
  if (!id || !pw) return alert('Enter ID and Password');

  try {
    const res = await api('/admin/login', {
      method: 'POST',
      body: { id, password: pw }
    });
    console.log('Login response:', res);
    if (res.error) return alert('Login failed: ' + res.error);
    if (!res.token) return alert('Login failed: No token received');
    adminToken = res.token;
    localStorage.setItem('dex_admin_token', adminToken);
    loadAdminPage(document.getElementById('app'));
  } catch (e) {
    console.error('Login error:', e);
    alert('Login failed: ' + e.message);
  }
}

function adminLogout() {
  adminToken = null;
  localStorage.removeItem('dex_admin_token');
  navigateTo('market');
}

async function loadAdminPage(el) {
  if (!adminToken) {
    el.innerHTML = `
      <div class="admin-login-box">
        <h2>Admin Login</h2>
        <form onsubmit="adminLogin(); return false;">
          <label>ID<input type="text" id="adminId" autocomplete="username" required></label>
          <label>Password<input type="password" id="adminPw" autocomplete="current-password" required></label>
          <button type="submit" class="btn">Login</button>
        </form>
      </div>`;
    return;
  }

  // Verify token still valid
  try {
    const stats = await adminApi('/admin/stats');
    if (stats.error) {
      adminToken = null;
      localStorage.removeItem('dex_admin_token');
      return loadAdminPage(el);
    }
    renderAdminDashboard(el, stats);
  } catch (e) {
    adminToken = null;
    localStorage.removeItem('dex_admin_token');
    loadAdminPage(el);
  }
}

function renderAdminDashboard(el, stats) {
  const completionRate = stats.trades.total_trades > 0
    ? ((stats.trades.completed / stats.trades.total_trades) * 100).toFixed(1)
    : '0.0';

  el.innerHTML = `
    <div class="admin-header">
      <h2>Admin Dashboard</h2>
      <button class="btn btn-sm btn-outline" onclick="adminLogout()">Logout</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${stats.ads.active_ads}</div>
        <div class="stat-label">Active Ads</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.ads.total_ads}</div>
        <div class="stat-label">Total Ads</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.trades.total_trades}</div>
        <div class="stat-label">Total Trades</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.trades.completed}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.trades.active}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${completionRate}%</div>
        <div class="stat-label">Completion Rate</div>
      </div>
      <div class="stat-card wide">
        <div class="stat-value">${Number(stats.volume.total_btct_volume).toFixed(5)} BTCT</div>
        <div class="stat-label">Total BTCT Volume</div>
      </div>
      <div class="stat-card wide">
        <div class="stat-value">${Number(stats.volume.total_doge_volume).toFixed(4)} DOGE</div>
        <div class="stat-label">Total DOGE Volume</div>
      </div>
    </div>

    <div class="admin-tabs">
      <button class="admin-tab active" onclick="switchAdminTab('ads', this)">Ads Management</button>
      <button class="admin-tab" onclick="switchAdminTab('trades', this)">Trades Monitor</button>
    </div>
    <div id="adminTabContent"></div>`;

  loadAdminAds();
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'ads') loadAdminAds();
  else loadAdminTrades();
}

async function loadAdminAds() {
  const container = document.getElementById('adminTabContent');
  container.innerHTML = '<p class="dim">Loading...</p>';
  try {
    const ads = await adminApi('/admin/ads');
    if (!ads.length) { container.innerHTML = '<p class="empty">No ads</p>'; return; }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr>
          <th>ID</th><th>Type</th><th>Address</th><th>Price</th>
          <th>Min</th><th>Max</th><th>Remaining</th><th>Status</th><th>Created</th><th></th>
        </tr></thead>
        <tbody>
          ${ads.map(a => `<tr class="${a.status === 'deleted' ? 'row-deleted' : ''}">
            <td>${a.id}</td>
            <td><span class="badge badge-${a.type}">${a.type.toUpperCase()}</span></td>
            <td class="mono">${shortAddr(a.btct_address)}</td>
            <td>${Number(a.price).toFixed(4)}</td>
            <td>${Number(a.min_btct).toFixed(5)}</td>
            <td>${Number(a.max_btct).toFixed(5)}</td>
            <td>${Number(a.remaining).toFixed(5)}</td>
            <td><span class="badge badge-${a.status}">${a.status}</span></td>
            <td class="small">${new Date(a.created_at).toLocaleDateString()}</td>
            <td>${a.status !== 'deleted' ? `<button class="btn btn-sm btn-red" onclick="deleteAd(${a.id})">Delete</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = '<p class="error-text">Failed to load ads</p>';
  }
}

async function loadAdminTrades() {
  const container = document.getElementById('adminTabContent');
  container.innerHTML = '<p class="dim">Loading...</p>';
  try {
    const trades = await adminApi('/admin/trades');
    if (!trades.length) { container.innerHTML = '<p class="empty">No trades</p>'; return; }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr>
          <th>ID</th><th>Type</th><th>Seller</th><th>Buyer</th>
          <th>BTCT</th><th>DOGE</th><th>Status</th><th>Created</th>
        </tr></thead>
        <tbody>
          ${trades.map(t => `<tr>
            <td>${t.id}</td>
            <td><span class="badge badge-${t.ad_type || 'unknown'}">${(t.ad_type || '?').toUpperCase()}</span></td>
            <td class="mono">${shortAddr(t.seller_address || '-')}</td>
            <td class="mono">${shortAddr(t.buyer_address || '-')}</td>
            <td>${Number(t.btct_amount || 0).toFixed(5)}</td>
            <td>${Number(t.doge_amount || 0).toFixed(4)}</td>
            <td><span class="badge badge-${t.status}">${t.status}</span></td>
            <td class="small">${new Date(t.created_at).toLocaleDateString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    container.innerHTML = '<p class="error-text">Failed to load trades</p>';
  }
}

async function deleteAd(adId) {
  if (!confirm('Delete this ad? (spam removal)')) return;
  try {
    const res = await adminApi('/admin/ads/' + adId + '/delete', {
      method: 'POST',
      body: {}
    });
    if (res.success) loadAdminAds();
    else alert('Failed: ' + (res.error || 'Unknown'));
  } catch (e) {
    alert('Failed to delete ad');
  }
}

// ===================== HASH ROUTING =====================

function restoreFromHash() {
  const hash = location.hash.slice(1);
  if (!hash) return false;

  if (hash.startsWith('trade/')) {
    const id = parseInt(hash.split('/')[1]);
    if (id) { navigateTo('trade', id, false); return true; }
  }

  const validPages = ['market', 'myAds', 'myTrades', 'wallet', 'krypton'];
  if (validPages.includes(hash)) {
    navigateTo(hash, null, false);
    return true;
  }
  return false;
}

window.addEventListener('popstate', () => {
  const hash = location.hash.slice(1);
  if (!hash) return navigateTo('market', null, false);

  if (hash.startsWith('trade/')) {
    const id = parseInt(hash.split('/')[1]);
    if (id) return navigateTo('trade', id, false);
  }

  const validPages = ['market', 'myAds', 'myTrades', 'wallet', 'krypton'];
  if (validPages.includes(hash)) {
    return navigateTo(hash, null, false);
  }
  navigateTo('market', null, false);
});

// ===================== DISCLAIMER =====================

function toggleDisclaimerBtn() {
  const check = document.getElementById('disclaimerCheck');
  const btn = document.getElementById('disclaimerEnterBtn');
  if (check && btn) btn.disabled = !check.checked;
}

function acceptDisclaimer() {
  const check = document.getElementById('disclaimerCheck');
  if (!check || !check.checked) return;
  const modal = document.getElementById('disclaimerModal');
  if (modal) {
    modal.style.animation = 'fadeOut 0.3s ease-out';
    setTimeout(() => {
      modal.style.display = 'none';
      localStorage.setItem('dex_disclaimer_accepted', 'true');
    }, 300);
  }
}

// Check if disclaimer was already accepted
if (localStorage.getItem('dex_disclaimer_accepted') === 'true') {
  const modal = document.getElementById('disclaimerModal');
  if (modal) modal.style.display = 'none';
}

// ===================== INIT =====================

if (!restoreFromHash()) navigateTo('market');
