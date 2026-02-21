// ===================== DEX CLIENT (Atomic Swap via HTLC) =====================
// Server holds NO private keys. All signing happens client-side.
const socket = io();

// ---- Socket: New trade alert ----
// Bulletin board realtime refresh
socket.on('adListUpdate', () => {
  if (currentPage === 'market') loadMarket(document.getElementById('app'));
});

socket.on('newTradeAlert', (data) => {
  if (!currentUser) return;
  const count = parseInt(localStorage.getItem(`dex_unread_${currentUser.btctAddress}`) || '0') + 1;
  localStorage.setItem(`dex_unread_${currentUser.btctAddress}`, count);
  setTradeBadge(count);
  const price = Number(data.btctAmount) / 1e11;
  showToast(`🔔 New swap started on your listing! ${price.toFixed(3)} BTCT`, 7000);
});

let currentUser = null;  // { btctAddress, btctKey, dogeAddress, dogeWif }

function showToast(msg, duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}
let currentPage = 'market';
let currentTradeId = null;
let currentTrade = null;  // loaded trade object for chat color
let kryptonReady = false;
let adminToken = localStorage.getItem('dex_admin_token') || null;

// ===================== KRYPTON WASM INIT =====================

(async function initWasm() {
  try {
    await Krypton.WasmHelper.doImport();
    try { Krypton.GenesisConfig.main(); } catch (e) { /* already initialized */ }
    kryptonReady = true;
    console.log('[WASM] Krypton initialized');
  } catch (e) {
    console.error('[WASM] Init failed:', e);
  }
})();

async function ensureKrypton() {
  if (kryptonReady) return;
  await Krypton.WasmHelper.doImport();
  try { Krypton.GenesisConfig.main(); } catch (e) { /* already initialized */ }
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

function fmtDuration(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
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
    // Register address room for personal notifications
    socket.emit('registerAddress', { address: currentUser.btctAddress });
    // Restore unread badge from localStorage
    const count = parseInt(localStorage.getItem(`dex_unread_${currentUser.btctAddress}`) || '0');
    setTradeBadge(count);
  } else {
    userInfo.textContent = '';
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
    setTradeBadge(0);
  }
}

// ===================== TRADE BADGE (unread notification) =====================

function setTradeBadge(count) {
  const badge = document.getElementById('trade-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function clearTradeBadge() {
  if (currentUser) localStorage.setItem(`dex_unread_${currentUser.btctAddress}`, '0');
  setTradeBadge(0);
}

// ===================== DOGE PRICE (Binance) =====================

let dogePriceInterval = null;
let walletInterval = null;
let lastDogeUsdt = 0; // DOGE/USDT 실시간가 (loadDogePrice에서 갱신)

async function loadDogePrice() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=DOGEUSDT');
    const d = await res.json();
    const price = parseFloat(d.lastPrice);
    const change = parseFloat(d.priceChangePercent);
    const high = parseFloat(d.highPrice);
    const low = parseFloat(d.lowPrice);
    const vol = parseFloat(d.volume);

    lastDogeUsdt = price; // BTCT USD 환산에 사용

    const priceEl = document.getElementById('dogePrice');
    const changeEl = document.getElementById('dogeChange');
    const highEl = document.getElementById('dogeHigh');
    const lowEl = document.getElementById('dogeLow');
    const volEl = document.getElementById('dogeVol');

    if (priceEl) priceEl.textContent = '$' + price.toFixed(5);
    if (changeEl) {
      changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    }
    if (highEl) highEl.textContent = '$' + high.toFixed(5);
    if (lowEl) lowEl.textContent = '$' + low.toFixed(5);
    if (volEl) volEl.textContent = (vol / 1e6).toFixed(1) + 'M';

    // Mini chart
    loadDogeChart(change >= 0);
  } catch (e) {
    const priceEl = document.getElementById('dogePrice');
    if (priceEl) priceEl.textContent = 'N/A';
  }

  // Auto-refresh every 30s while on market page
  if (dogePriceInterval) clearInterval(dogePriceInterval);
  dogePriceInterval = setInterval(() => {
    if (currentPage === 'market') loadDogePrice();
    else { clearInterval(dogePriceInterval); dogePriceInterval = null; }
  }, 30000);
}

async function loadDogeChart(isUp) {
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=DOGEUSDT&interval=1h&limit=24');
    const klines = await res.json();
    const closes = klines.map(k => parseFloat(k[4]));
    const canvas = document.getElementById('dogeChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const pad = 4;

    const color = isUp ? '#4ecca3' : '#e94560';
    const fillColor = isUp ? 'rgba(78,204,163,0.12)' : 'rgba(233,69,96,0.12)';

    // Draw filled area
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    closes.forEach((c, i) => {
      const x = pad + (i / (closes.length - 1)) * (w - pad * 2);
      const y = h - pad - ((c - min) / range) * (h - pad * 2);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w - pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Draw line
    ctx.beginPath();
    closes.forEach((c, i) => {
      const x = pad + (i / (closes.length - 1)) * (w - pad * 2);
      const y = h - pad - ((c - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Last point dot
    const lastX = w - pad;
    const lastY = h - pad - ((closes[closes.length - 1] - min) / range) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } catch (e) { /* ignore chart errors */ }
}

async function loadBtctChart() {
  try {
    const trades = await api('/btct-chart');
    const priceEl = document.getElementById('btctPrice');
    const changeEl = document.getElementById('btctChange');
    const tradesEl = document.getElementById('btctTrades');
    const highEl = document.getElementById('btctHigh');
    const lowEl = document.getElementById('btctLow');

    if (!trades || trades.length === 0) {
      if (priceEl) priceEl.textContent = 'No trades yet';
      if (priceEl) priceEl.style.fontSize = '14px';
      if (changeEl) changeEl.textContent = '';
      if (tradesEl) tradesEl.textContent = '0';
      if (highEl) highEl.textContent = '--';
      if (lowEl) lowEl.textContent = '--';
      // Draw empty chart placeholder
      const canvas = document.getElementById('btctChart');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for trades...', w / 2, h / 2 + 4);
      }
      return;
    }

    const prices = trades.map(t => parseFloat(t.price));
    const lastPrice = prices[prices.length - 1];
    const firstPrice = prices[0];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    if (priceEl) { priceEl.textContent = lastPrice.toFixed(4) + ' DOGE'; priceEl.style.fontSize = ''; }
    if (changeEl) {
      changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    }
    if (tradesEl) tradesEl.textContent = trades.length;
    if (highEl) highEl.textContent = high.toFixed(4) + ' DOGE';
    if (lowEl) lowEl.textContent = low.toFixed(4) + ' DOGE';

    // USD 환산 (DOGE/USDT 최신가 있을 때만)
    const usdEl = document.getElementById('btctPriceUsd');
    const highUsdEl = document.getElementById('btctHighUsd');
    const lowUsdEl = document.getElementById('btctLowUsd');
    if (lastDogeUsdt > 0) {
      if (usdEl) usdEl.textContent = '≈ $' + (lastPrice * lastDogeUsdt).toFixed(4);
      if (highUsdEl) highUsdEl.textContent = '≈ $' + (high * lastDogeUsdt).toFixed(4);
      if (lowUsdEl) lowUsdEl.textContent = '≈ $' + (low * lastDogeUsdt).toFixed(4);
    } else {
      if (usdEl) usdEl.textContent = '≈ $-- (DOGE가 로드되면 표시)';
    }

    // Draw chart
    const canvas = document.getElementById('btctChart');
    if (!canvas || prices.length < 2) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const pad = 4;
    const isUp = change >= 0;
    const color = isUp ? '#4ecca3' : '#e94560';
    const fillColor = isUp ? 'rgba(78,204,163,0.12)' : 'rgba(233,69,96,0.12)';

    // Filled area
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    prices.forEach((p, i) => {
      const x = pad + (i / (prices.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p - min) / range) * (h - pad * 2);
      ctx.lineTo(x, y);
    });
    ctx.lineTo(w - pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Line
    ctx.beginPath();
    prices.forEach((p, i) => {
      const x = pad + (i / (prices.length - 1)) * (w - pad * 2);
      const y = h - pad - ((p - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Last dot
    const lastX = w - pad;
    const lastY = h - pad - ((prices[prices.length - 1] - min) / range) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } catch (e) { /* ignore */ }
}

// ===================== NAVIGATION =====================

function navigateTo(page, param, pushHash = true) {
  if (window._tradeTimerInterval) { clearInterval(window._tradeTimerInterval); window._tradeTimerInterval = null; }
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
    const pages = ['market', 'myTrades', 'myAds', 'wallet'];
    el.classList.toggle('active', pages[i] === page);
  });

  const container = document.getElementById('app');

  switch (page) {
    case 'market': loadMarket(container); break;
    case 'myAds': loadMyAds(container); break;
    case 'myTrades':
      clearTradeBadge();
      loadMyTrades(container);
      break;
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
    <div class="market-layout">
      <div class="market-main">
        <div id="listingList"><div class="empty">Loading...</div></div>
      </div>
      <div class="price-panel" id="pricePanel">
        <h3>🐕 DOGE / USDT</h3>
        <div class="price-main" id="dogePrice">--</div>
        <div class="price-change" id="dogeChange">--</div>
        <canvas id="dogeChart" width="268" height="80" style="width:100%;height:80px;margin:8px 0;border-radius:6px;"></canvas>
        <div class="price-row"><span class="label">24h High</span><span class="value" id="dogeHigh">--</span></div>
        <div class="price-row"><span class="label">24h Low</span><span class="value" id="dogeLow">--</span></div>
        <div class="price-row"><span class="label">24h Volume</span><span class="value" id="dogeVol">--</span></div>
        <div class="source">via Binance</div>
        <div class="chart-divider"></div>
        <h3>⚡ BTCT / DOGE</h3>
        <div class="price-main" id="btctPrice">--</div>
        <div id="btctPriceUsd" style="color:#888;font-size:12px;margin-top:-6px;margin-bottom:4px;">≈ $--</div>
        <div class="price-change" id="btctChange">--</div>
        <canvas id="btctChart" width="268" height="80" style="width:100%;height:80px;margin:8px 0;border-radius:6px;"></canvas>
        <div class="price-row"><span class="label">Trades</span><span class="value" id="btctTrades">--</span></div>
        <div class="price-row"><span class="label">24h High</span><span class="value" id="btctHigh">--</span><span id="btctHighUsd" style="color:#666;font-size:10px;margin-left:4px;"></span></div>
        <div class="price-row"><span class="label">24h Low</span><span class="value" id="btctLow">--</span><span id="btctLowUsd" style="color:#666;font-size:10px;margin-left:4px;"></span></div>
        <div class="source">DEX trades</div>
      </div>
    </div>
  `;

  loadDogePrice();
  loadBtctChart();

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

  // Auto-refresh every 30s while on wallet page (server cache is 90s, so Blockcypher call ~every 90s)
  if (walletInterval) clearInterval(walletInterval);
  walletInterval = setInterval(() => {
    if (currentPage === 'wallet') loadWallet(document.getElementById('app'));
    else { clearInterval(walletInterval); walletInterval = null; }
  }, 30000);

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
          <p class="small fee-notice">Network fee: ~0.02 DOGE</p>
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
  if (typeof DogeHTLC === 'undefined') throw new Error('doge-htlc not loaded');

  const amountSat = Math.round(Number(amountDoge) * 1e8);
  const fromAddress = DogeHTLC.wifToAddress(wif);

  // Get UTXOs from server (no private key sent)
  const utxos = await api(`/doge/utxos/${fromAddress}`);
  if (!utxos || utxos.length === 0) throw new Error('No UTXOs (balance is 0)');

  // Build & sign transaction via DogeHTLC (uses verified getBitcore() pattern)
  const rawTx = DogeHTLC.buildSimpleTx(wif, toAddress, amountSat, utxos);

  // Broadcast signed TX (server only sees raw hex, never private key)
  const result = await api('/doge/broadcast', { body: { rawTx } });
  return { txid: result.txid, fee: 0.02 };
}

async function walletSendDoge() {
  if (!currentUser || !currentUser.dogeAddress) return;
  const wif = getDogeWifForAddr(currentUser.dogeAddress);
  if (!wif) return showWalletMsg('walletDogeError', 'No private key for active address');

  const toAddr = document.getElementById('walletDogeSendTo').value.trim();
  const amount = document.getElementById('walletDogeSendAmount').value.trim();
  if (!toAddr) return showWalletMsg('walletDogeError', 'Enter recipient address');
  if (!amount || Number(amount) <= 0) return showWalletMsg('walletDogeError', 'Enter valid amount');

  if (!confirm(`Send ${amount} DOGE to ${toAddr}?\n\nNetwork fee: ~0.02 DOGE`)) return;

  document.getElementById('walletDogeError').classList.add('hidden');
  document.getElementById('walletDogeSuccess').classList.add('hidden');

  try {
    const result = await signAndSendDoge(wif, toAddr, Number(amount));

    showWalletMsg('walletDogeSuccess', `✓ Sent! Tx: ${result.txid}`);
    document.getElementById('walletDogeSendTo').value = '';
    document.getElementById('walletDogeSendAmount').value = '';
    setTimeout(() => navigateTo('wallet'), 3000);
  } catch (err) {
    console.error('[DOGE Send]', err);
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
    currentTrade = trade;
    socket.emit('joinTrade', trade.id);

    const isSeller = currentUser && currentUser.btctAddress.toLowerCase() === trade.seller_address.toLowerCase();
    const isBuyer = currentUser && currentUser.btctAddress.toLowerCase() === trade.buyer_address.toLowerCase();

    // Fetch current block height for timeout countdown
    try {
      const blockInfo = await api('/btct/block');
      window._currentBlock = blockInfo.height;
      window._blockFetchTime = Date.now();
    } catch (e) { /* ignore */ }

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
          ${steps.map((s, i) => `<div class="swap-step ${stepStates[i]}"><span class="step-num">${i + 1}</span>${s}<span class="step-timer" id="step-timer-${i}"></span></div>`).join('')}
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

        ${trade.status !== 'completed' && trade.status !== 'cancelled' ? `
          <div class="swap-notice">
            ⚠ Verify each transaction on the explorer before proceeding to the next step.
            Funds are locked by smart contract — if the swap fails, refund is only possible after the timeout expires
            (BTCT: ~24h / DOGE: ~12h).
            <span style="display:block;margin-top:6px;">
              🔍 BTCT Explorer: <a href="https://explorer.btc-time.com" target="_blank">explorer.btc-time.com</a>
              &nbsp;·&nbsp;
              DOGE: <a href="https://chain.so/DOGE" target="_blank">chain.so/DOGE</a>
            </span>
          </div>
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
    startTradeTimers(trade);
  } catch (e) {
    el.innerHTML = `<div class="empty error-text">${e.message}</div>`;
  }
}

function startTradeTimers(trade) {
  if (window._tradeTimerInterval) { clearInterval(window._tradeTimerInterval); window._tradeTimerInterval = null; }
  if (!trade || trade.status === 'completed' || trade.status === 'cancelled' || trade.status === 'expired') return;

  const BLOCK_MS = 60000; // ~60s per BTCT block

  const update = () => {
    const now = Date.now();
    const blockAge = window._blockFetchTime ? (now - window._blockFetchTime) : 0;
    const estimatedBlock = (window._currentBlock || 0) + (blockAge / BLOCK_MS);

    // Step 0: Hash Published — 거래 개설 후 경과 시간
    const el0 = document.getElementById('step-timer-0');
    if (el0) {
      const elapsed = now - new Date(trade.created_at).getTime();
      el0.textContent = fmtElapsed(elapsed) + ' elapsed';
    }

    // Step 1: BTCT Locked — BTCT HTLC 만료까지
    const el1 = document.getElementById('step-timer-1');
    if (el1 && trade.btct_timeout && estimatedBlock > 0) {
      const blocksLeft = trade.btct_timeout - estimatedBlock;
      const msLeft = blocksLeft * BLOCK_MS;
      if (blocksLeft > 0) {
        el1.textContent = '⏳ ' + fmtDuration(msLeft);
        el1.className = 'step-timer' + (blocksLeft < 60 ? ' urgent' : '');
      } else {
        el1.textContent = '⏰ expired';
        el1.className = 'step-timer expired';
      }
    }

    // Step 2: DOGE Locked — DOGE HTLC 만료까지
    const el2 = document.getElementById('step-timer-2');
    if (el2 && trade.doge_timeout) {
      const msLeft = trade.doge_timeout * 1000 - now;
      if (msLeft > 0) {
        el2.textContent = '⏳ ' + fmtDuration(msLeft);
        el2.className = 'step-timer' + (msLeft < 1800000 ? ' urgent' : '');
      } else {
        el2.textContent = '⏰ expired';
        el2.className = 'step-timer expired';
      }
    }

    // Step 3: Seller Redeems — DOGE 만료까지 (Seller가 인출해야 하는 시간)
    const el3 = document.getElementById('step-timer-3');
    if (el3 && trade.doge_timeout) {
      const msLeft = trade.doge_timeout * 1000 - now;
      if (msLeft > 0) {
        el3.textContent = '⏳ ' + fmtDuration(msLeft);
        el3.className = 'step-timer' + (msLeft < 1800000 ? ' urgent' : '');
      } else {
        el3.textContent = '⏰ expired';
        el3.className = 'step-timer expired';
      }
    }

    // Step 4: Buyer Redeems — BTCT HTLC 만료까지 (Buyer가 인출해야 하는 시간)
    const el4 = document.getElementById('step-timer-4');
    if (el4 && trade.btct_timeout && estimatedBlock > 0) {
      const blocksLeft = trade.btct_timeout - estimatedBlock;
      const msLeft = blocksLeft * BLOCK_MS;
      if (blocksLeft > 0) {
        el4.textContent = '⏳ ' + fmtDuration(msLeft);
        el4.className = 'step-timer' + (blocksLeft < 60 ? ' urgent' : '');
      } else {
        el4.textContent = '⏰ expired';
        el4.className = 'step-timer expired';
      }
    }
  };

  update();
  window._tradeTimerInterval = setInterval(update, 1000);
}

function getStepStates(status) {
  const order = ['hash_published', 'btct_locked', 'doge_locked', 'seller_redeemed', 'completed'];
  const idx = order.indexOf(status);
  return order.map((_, i) => {
    if (status === 'negotiating') return i === 0 ? 'active' : '';
    if (status === 'completed') return 'done';
    if (i < idx) return 'done';
    if (i === idx) return 'active';
    return '';
  });
}

function getActionHTML(trade, isSeller, isBuyer) {
  if (trade.status === 'completed' || trade.status === 'cancelled') return '';

  // Expired: show refund buttons depending on how far the swap got
  if (trade.status === 'expired') {
    const hasDogeLock = !!trade.doge_redeem_script; // doge_locked stage expired
    if (!isSeller && !isBuyer) return '';
    return `
      <div class="action-box" style="border-color:#e74c3c;">
        <h4 style="color:#e74c3c;">⏰ Trade Expired</h4>
        <p class="dim small">This trade timed out. Please reclaim your funds.</p>
        ${isSeller ? `<button class="btn btn-red" onclick="btctRefund(${trade.id})">Refund BTCT (Timeout)</button>` : ''}
        ${isBuyer && hasDogeLock ? `<button class="btn btn-red" onclick="refundDoge(${trade.id})">Refund DOGE (Timeout)</button>` : ''}
      </div>
    `;
  }

  // Step 1: Seller publishes hash
  if (trade.status === 'negotiating' && isSeller) {
    const hasDogeWallet = currentUser && currentUser.dogeAddress;
    return `
      <div class="action-box">
        <h4>Step 1: Generate Secret & Publish Hash</h4>
        <p>Generate a cryptographic secret. Its hash will be used to lock both sides of the trade.</p>
        ${!hasDogeWallet ? '<p class="warn small">⚠ DOGE wallet required — add one in Wallet tab first</p>' : ''}
        <button class="btn btn-purple" onclick="publishHash(${trade.id})" ${!hasDogeWallet ? 'disabled' : ''}>Generate Secret & Publish Hash</button>
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

  // Step 3: Buyer locks DOGE in P2SH HTLC
  if (trade.status === 'btct_locked' && isBuyer) {
    return `
      <div class="action-box">
        <h4>Step 3: Lock DOGE in HTLC</h4>
        <p>Lock ${satToDOGE(trade.doge_amount)} DOGE in an HTLC P2SH address. The seller can only claim by revealing the secret.</p>
        <p class="dim small">BTCT HTLC: <span class="mono">0x${trade.btct_htlc_address}</span></p>
        <p class="dim small">Hash: <span class="mono">${trade.hash_lock}</span></p>
        <p class="dim small">Seller DOGE: <span class="mono">${trade.seller_doge_address || 'N/A'}</span></p>
        <button class="btn btn-green" onclick="sendDogeAutomatically(${trade.id})">Lock ${satToDOGE(trade.doge_amount)} DOGE in HTLC</button>
      </div>
    `;
  }

  if (trade.status === 'btct_locked' && isSeller) {
    const currentBlock = window._currentBlock || 0;
    const timedOut = currentBlock > 0 && trade.btct_timeout && currentBlock >= trade.btct_timeout;
    const blocksLeft = trade.btct_timeout ? (trade.btct_timeout - currentBlock) : '?';
    const timeLeft = (typeof blocksLeft === 'number' && blocksLeft > 0)
      ? `~${Math.ceil(blocksLeft / 60)}h ${blocksLeft % 60}m (${blocksLeft} blocks)`
      : (timedOut ? 'Expired' : '?');
    return `
      <div class="action-box">
        <h4>Waiting for buyer to lock DOGE in HTLC...</h4>
        <p>Your BTCT is locked: <span class="mono">0x${trade.btct_htlc_address}</span></p>
        <p class="dim small">Timeout: block ${trade.btct_timeout} ${timedOut ? '<span class="warn">(expired)</span>' : `(${timeLeft} left)`}</p>
        ${timedOut ? `<button class="btn btn-red" onclick="btctRefund(${trade.id})">Refund BTCT (Timeout Expired)</button>` : ''}
      </div>
    `;
  }

  // Step 4: Seller redeems DOGE from P2SH (reveals secret)
  if (trade.status === 'doge_locked' && isSeller) {
    const secret = localStorage.getItem(`dex_secret_${trade.id}`);
    return `
      <div class="action-box">
        <h4>Step 4: Redeem DOGE (Reveals Secret)</h4>
        <p>Claim the DOGE from the HTLC P2SH by revealing your secret. This will allow the buyer to also redeem the BTCT.</p>
        <p class="dim small">DOGE HTLC: <span class="mono">${trade.doge_htlc_address}</span></p>
        <p class="dim small">Timeout: <span class="mono">${trade.doge_timeout ? new Date(trade.doge_timeout * 1000).toLocaleString() : 'N/A'}</span></p>
        <p class="dim small">Your Secret: <span class="mono">${secret || 'NOT FOUND — check localStorage!'}</span></p>
        <button class="btn btn-green" onclick="sellerRedeem(${trade.id})">Reveal Secret & Redeem DOGE</button>
      </div>
    `;
  }

  if (trade.status === 'doge_locked' && isBuyer) {
    const timedOut = trade.doge_timeout && DogeHTLC.isTimedOut(trade.doge_timeout);
    const timeStr = trade.doge_timeout ? DogeHTLC.formatTimeRemaining(trade.doge_timeout) : '';
    return `<div class="action-box"><h4>Waiting for seller to redeem DOGE...</h4>
      <p>Once redeemed, the secret will be revealed and you can claim your BTCT.</p>
      <p class="dim small">DOGE HTLC: ${trade.doge_htlc_address} · Timeout: ${timeStr}</p>
      ${timedOut ? `<button class="btn btn-red" onclick="refundDoge(${trade.id})">Refund DOGE (Timeout Expired)</button>` : ''}
    </div>`;
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
  if (!currentUser.dogeAddress) return alert('DOGE wallet required. Add a DOGE wallet first.');
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

    // Publish hash + seller DOGE address to server
    await api(`/trades/${tradeId}/hash`, {
      body: {
        sellerAddress: currentUser.btctAddress,
        hashLock: hashHex,
        sellerDogeAddress: currentUser.dogeAddress
      }
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
      blockHeight,  // validityStartHeight (fee auto-calculated by Policy)
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

// Step 3: Buyer locks DOGE in HTLC P2SH
async function sendDogeAutomatically(tradeId) {
  if (!currentUser || !currentUser.dogeWif) return alert('DOGE wallet not connected');

  try {
    const trade = await api(`/trades/${tradeId}`);
    const dogeAmountSat = Number(trade.doge_amount);
    const sellerDogeAddr = trade.seller_doge_address;
    const buyerDogeAddr = currentUser.dogeAddress;

    if (!sellerDogeAddr) return alert('Seller DOGE address not found. Seller must publish hash first.');
    if (!buyerDogeAddr) return alert('Your DOGE address not found');

    // Create HTLC P2SH
    const locktime = DogeHTLC.getDefaultLocktime();
    const htlc = DogeHTLC.createHTLC(trade.hash_lock, sellerDogeAddr, buyerDogeAddr, locktime);

    const confirmed = confirm(
      `Lock ${satToDOGE(dogeAmountSat)} DOGE in HTLC P2SH?\n\n` +
      `P2SH Address: ${htlc.p2shAddress}\n` +
      `Timeout: ${new Date(locktime * 1000).toLocaleString()}\n` +
      `Fee: 0.02 DOGE\n\n` +
      `The seller can claim only by revealing the secret.\n` +
      `If unclaimed, you can refund after timeout.`
    );
    if (!confirmed) return;

    // Get UTXOs and build funding TX
    const utxos = await api(`/doge/utxos/${buyerDogeAddr}`);
    const rawTx = DogeHTLC.buildFundingTx(currentUser.dogeWif, htlc.p2shAddress, dogeAmountSat, utxos);

    // Broadcast
    const result = await api('/doge/broadcast', { body: { rawTx } });

    alert(`✓ DOGE locked in HTLC P2SH!\nP2SH: ${htlc.p2shAddress}\nTX: ${result.txid}`);

    // Save HTLC info locally for refund
    localStorage.setItem(`doge_htlc_${tradeId}`, JSON.stringify({
      redeemScriptHex: htlc.redeemScriptHex,
      p2shAddress: htlc.p2shAddress,
      locktime: locktime,
      amountSat: dogeAmountSat
    }));

    // Report to server
    await api(`/trades/${tradeId}/doge-locked`, {
      body: {
        buyerAddress: currentUser.btctAddress,
        htlcTx: result.txid,
        htlcAddress: htlc.p2shAddress,
        timeout: locktime,
        buyerDogeAddress: buyerDogeAddr,
        dogeRedeemScript: htlc.redeemScriptHex
      }
    });
    socket.emit('tradeUpdate', { tradeId, status: 'doge_locked' });
    navigateTo('trade');
  } catch (e) {
    alert('DOGE HTLC creation failed: ' + e.message);
    console.error(e);
  }
}

// Step 4: Seller redeems DOGE from P2SH (reveals secret)
async function sellerRedeem(tradeId) {
  if (!currentUser) return;
  if (!currentUser.dogeWif) return alert('DOGE wallet required to redeem DOGE from HTLC');

  const secret = localStorage.getItem(`dex_secret_${tradeId}`);
  if (!secret) return alert('Secret not found in localStorage!');

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.doge_redeem_script) return alert('DOGE redeem script not found');
    if (!trade.doge_htlc_address) return alert('DOGE HTLC address not found');

    // Get UTXOs on the P2SH address
    const utxos = await api(`/doge/utxos/${trade.doge_htlc_address}`);
    if (!utxos || utxos.length === 0) return alert('No DOGE found in HTLC P2SH. Wait for confirmation.');

    const rawTx = DogeHTLC.buildRedeemTx(currentUser.dogeWif, trade.doge_redeem_script, secret, utxos);

    // Broadcast redeem TX
    const result = await api('/doge/broadcast', { body: { rawTx } });

    alert(`✓ DOGE redeemed!\nTX: ${result.txid}\nSecret is now public.`);

    // Report to server
    await api(`/trades/${tradeId}/seller-redeemed`, {
      body: {
        sellerAddress: currentUser.btctAddress,
        redeemTx: result.txid,
        secret: secret
      }
    });
    socket.emit('tradeUpdate', { tradeId, status: 'seller_redeemed', detail: { secret } });
    navigateTo('trade');
  } catch (e) { alert('DOGE redeem failed: ' + e.message); console.error(e); }
}

// DOGE HTLC Refund (buyer reclaims after timeout)
async function refundDoge(tradeId) {
  if (!currentUser || !currentUser.dogeWif) return alert('DOGE wallet required');

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.doge_redeem_script || !trade.doge_htlc_address) {
      return alert('DOGE HTLC data not found');
    }
    if (!DogeHTLC.isTimedOut(trade.doge_timeout)) {
      return alert('Timeout has not expired yet. Remaining: ' + DogeHTLC.formatTimeRemaining(trade.doge_timeout));
    }

    // Get UTXOs on P2SH
    const utxos = await api(`/doge/utxos/${trade.doge_htlc_address}`);
    if (!utxos || utxos.length === 0) return alert('No DOGE in HTLC (already claimed or refunded)');

    const rawTx = DogeHTLC.buildRefundTx(currentUser.dogeWif, trade.doge_redeem_script, trade.doge_timeout, utxos);
    const result = await api('/doge/broadcast', { body: { rawTx } });

    alert(`✓ DOGE refunded!\nTX: ${result.txid}`);

    // Cancel the trade
    await api(`/trades/${tradeId}/cancel`, {
      body: { address: currentUser.btctAddress }
    });
    socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
    navigateTo('trade');
  } catch (e) { alert('DOGE refund failed: ' + e.message); console.error(e); }
}

// Step 5: Buyer redeems BTCT with revealed secret
async function btctRefund(tradeId) {
  if (!currentUser) return;
  await ensureKrypton();

  try {
    const trade = await api(`/trades/${tradeId}`);
    const blockHeight = (await api('/btct/block')).height;

    if (blockHeight < trade.btct_timeout) {
      return alert(`BTCT HTLC timeout not yet reached.\nCurrent block: ${blockHeight}\nTimeout block: ${trade.btct_timeout}\nBlocks remaining: ${trade.btct_timeout - blockHeight}`);
    }

    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();

    // Seller must be the htlcSender (the one who locked BTCT)
    if (senderAddr.toHex().toLowerCase() !== trade.seller_address.toLowerCase()) {
      return alert('Only the seller (HTLC creator) can refund after timeout.');
    }

    // Get HTLC balance
    const htlcAddr = trade.btct_htlc_address;
    const htlcAccount = await api(`/btct/account/${htlcAddr}`);
    const htlcBalance = Number(htlcAccount.balance);
    if (htlcBalance <= 0) {
      // Already refunded/redeemed on-chain — just mark trade as cancelled in DB
      await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });
      alert('HTLC balance is already 0 — BTCT was refunded previously.\nTrade marked as cancelled.');
      socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
      navigateTo('trade');
      return;
    }

    const htlcAddress = Krypton.Address.fromHex(htlcAddr);
    const networkFee = Number(Krypton.Policy.txFee(blockHeight));
    const refundValue = htlcBalance - networkFee;
    if (refundValue <= 0) return alert('HTLC balance too low to cover network fee');

    const tx = new Krypton.ExtendedTransaction(
      htlcAddress,
      Krypton.Account.Type.HTLC,
      senderAddr,
      Krypton.Account.Type.BASIC,
      refundValue,
      blockHeight,
      Krypton.Transaction.Flag.NONE,
      new Uint8Array(0)
    );

    // TIMEOUT_RESOLVE proof: [u8:3] + SignatureProof (sender)
    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const sigProof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();
    const proof = new Krypton.SerialBuffer(1 + sigProof.byteLength);
    proof.writeUint8(Krypton.HashedTimeLockedContract.ProofType.TIMEOUT_RESOLVE);
    proof.write(sigProof);
    tx.proof = proof;

    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    // Mark trade as cancelled on server
    await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });

    alert('✓ BTCT refunded!\nTX: ' + result.hash + '\nTrade marked as cancelled.');
    socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
    navigateTo('trade');
  } catch (e) {
    alert('BTCT refund failed: ' + e.message);
    console.error(e);
  }
}

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

    // Build redeem transaction — subtract network fee from value
    const htlcAddress = Krypton.Address.fromHex(htlcAddr);
    const networkFee = Number(Krypton.Policy.txFee(blockHeight));
    const redeemValue = htlcBalance - networkFee;
    if (redeemValue <= 0) return alert('HTLC balance too low to cover network fee');
    const tx = new Krypton.ExtendedTransaction(
      htlcAddress,
      Krypton.Account.Type.HTLC,
      recipientAddr,
      Krypton.Account.Type.BASIC,
      redeemValue,  // value minus network fee
      blockHeight,  // validityStartHeight (fee auto-calculated by Policy)
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
  let role = '';
  if (currentTrade) {
    const addr = msg.sender_address.toLowerCase();
    if (addr === currentTrade.seller_address.toLowerCase()) role = 'seller';
    else if (addr === currentTrade.buyer_address.toLowerCase()) role = 'buyer';
  }
  return `<div class="chat-msg"><span class="sender ${role}">${shortAddr(msg.sender_address)}</span> <span class="time">${t}</span><br>${escapeHtml(msg.content)}</div>`;
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
