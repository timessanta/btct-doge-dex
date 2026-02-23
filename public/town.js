// ======================== BTCT Town — RPG-style DEX ========================
// Phaser 3 game with multiplayer via Socket.IO
// Uses same wallet system as DEX (localStorage keys: dex_active_btct, dex_btct_wallets)

const TILE = 32;
const MAP_W = 30;
const MAP_H = 22;
const SPEED = 120;

// ---- Wallet helpers (shared with DEX) ----
function getActiveBtctAddr() { return localStorage.getItem('dex_active_btct') || ''; }
function getActiveDogeAddr() {
  const active = localStorage.getItem('dex_active_doge') || '';
  if (active) return active;
  // fallback: dex_doge_wallets에 등록된 첫 번째 주소
  try {
    const wallets = JSON.parse(localStorage.getItem('dex_doge_wallets') || '{}');
    const addrs = Object.keys(wallets);
    return addrs[0] || '';
  } catch { return ''; }
}
function shortAddr(addr) {
  if (!addr) return '???';
  const a = addr.replace(/^0x/, '');
  return '0x' + a.substring(0, 4) + '..' + a.substring(a.length - 4);
}

// ======================== TRADING SYSTEM ========================

const BTCT_SAT = 1e11;
const DOGE_SAT = 1e8;
function satToBTCT(sat) { return (Number(sat) / BTCT_SAT).toFixed(5); }
function btctToSat(btct) { return Math.round(Number(btct) * BTCT_SAT); }
function satToDOGE(sat) { return (Number(sat) / DOGE_SAT).toFixed(4); }
function dogeToSat(doge) { return Math.round(Number(doge) * DOGE_SAT); }

let currentUser = null;
let kryptonReady = false;
let currentTradeId = null;
let pendingAd = null;

// Krypton WASM init (web.js full SDK)
(async function initWasm() {
  try {
    if (typeof Krypton !== 'undefined') {
      await Krypton.WasmHelper.doImport();
      try { Krypton.GenesisConfig.main(); } catch (e) { /* already initialized */ }
      kryptonReady = true;
      console.log('[Town] Krypton WASM ready');
    }
  } catch (e) { console.warn('[Town] WASM init:', e.message); }
})();

async function ensureKrypton() {
  if (kryptonReady) return;
  if (typeof Krypton === 'undefined') throw new Error('Krypton library not loaded');
  await Krypton.WasmHelper.doImport();
  try { Krypton.GenesisConfig.main(); } catch (e) { /* already initialized */ }
  kryptonReady = true;
}

async function api(path, opts = {}) {
  const url = '/api' + path;
  const config = { headers: { ...(opts.headers || {}) } };
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

function getBtctKeyForAddr(addr) {
  try {
    const a = (addr || '').replace(/^0x/, '').toLowerCase();
    const wallets = JSON.parse(localStorage.getItem('dex_btct_wallets') || '{}');
    return wallets[a] || null;
  } catch { return null; }
}

function getDogeWifForAddr(addr) {
  try {
    const wallets = JSON.parse(localStorage.getItem('dex_doge_wallets') || '{}');
    return wallets[addr] || null;
  } catch { return null; }
}

function syncCurrentUser() {
  const btctAddr = getActiveBtctAddr();
  const dogeAddr = getActiveDogeAddr();
  if (!btctAddr) { currentUser = null; return; }
  currentUser = {
    btctAddress: btctAddr,
    btctKey: getBtctKeyForAddr(btctAddr) || '',
    dogeAddress: dogeAddr || '',
    dogeKey: getDogeWifForAddr(dogeAddr) || '',
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Map Data ----
// 0=grass, 1=path, 2=water, 3=tree, 4=wall, 5=roof, 6=door, 7=board_npc, 8=flower, 9=fence
const MAP = [
  [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
  [3,0,0,0,8,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,8,0,0,0,0,0,3],
  [3,0,5,5,5,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,5,5,5,5,0,0,3],
  [3,0,4,4,4,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,4,4,4,4,0,0,3],
  [3,0,4,6,4,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,4,4,6,4,0,0,3],
  [3,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,3],
  [3,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,3],
  [3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3],
  [3,0,0,0,0,0,0,0,0,0,8,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,3],
  [3,0,0,0,0,0,0,0,0,0,0,0,9,9,9,9,0,0,0,0,0,0,0,0,0,0,0,0,0,3],
  [3,1,1,0,0,0,0,0,0,0,0,9,0,0,0,0,9,0,0,0,0,0,0,0,0,0,1,1,1,3],
  [3,0,1,0,0,0,0,0,0,0,0,9,0,7,0,0,9,0,0,0,0,0,0,0,0,0,1,0,0,3],
  [3,0,1,0,0,0,0,0,0,0,0,9,0,0,0,0,9,0,0,0,0,0,0,0,0,0,1,0,0,3],
  [3,0,1,0,0,0,0,0,0,0,0,0,9,9,9,9,0,0,0,0,0,0,0,0,0,0,1,0,0,3],
  [3,0,1,0,0,0,0,0,0,0,8,0,0,0,0,0,0,8,0,0,0,0,0,0,0,0,1,0,0,3],
  [3,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,3],
  [3,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,3],
  [3,0,5,5,5,0,0,1,0,0,2,2,2,2,2,2,2,0,0,0,1,0,0,5,5,5,5,0,0,3],
  [3,0,4,4,4,0,0,1,0,0,2,2,2,2,2,2,2,0,0,0,1,0,0,4,4,4,4,0,0,3],
  [3,0,4,6,4,0,0,1,0,0,2,2,2,2,2,2,2,0,0,0,1,0,0,4,4,6,4,0,0,3],
  [3,0,0,0,8,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,8,0,0,0,0,0,3],
  [3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3],
];

// Collision map (true = blocked)
const BLOCKED = [3, 2, 4, 5, 9]; // tree, water, wall, roof, fence

// NPC location (board_npc = tile 7)
const NPC_POS = { x: 13, y: 11 };

// House door locations (tile 6)
// Bottom-right house door → Character Customizer
const HOUSE_CHAR_POS = { x: 25, y: 19 };
// Top-right house door → Mining House
const HOUSE_MINE_POS = { x: 25, y: 4 };

// ---- Socket ----
let socket = null;
const otherPlayers = {};

// ---- Panel state ----
let panelOpen = false;
let townScene = null;

// ---- Mobile input ----
const mobileInput = { x: 0, y: 0 };
let _isMobile = null;
// Global town toast (no app.js dependency)
function townShowToast(msg, duration = 5000) {
  let container = document.getElementById('town-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'town-toast-container';
    Object.assign(container.style, {
      position: 'fixed', bottom: '70px', right: '16px',
      zIndex: '99999', display: 'flex', flexDirection: 'column', gap: '8px',
      pointerEvents: 'none',
    });
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  Object.assign(toast.style, {
    background: 'rgba(22,33,62,0.97)',
    border: '1px solid #00d4ff',
    color: '#f0f0f0',
    padding: '10px 16px',
    borderRadius: '8px',
    fontSize: '13px',
    maxWidth: '300px',
    opacity: '0',
    transform: 'translateY(10px)',
    transition: 'opacity 0.3s, transform 0.3s',
    pointerEvents: 'auto',
  });
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

function isMobile() {
  if (_isMobile === null) {
    _isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }
  return _isMobile;
}

// ======================== SOUND SYSTEM ========================
const TownSounds = {
  ctx: null,
  enabled: true,
  _lastFootstep: 0,

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { this.enabled = false; }
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  playFootstep() {
    if (!this.enabled || !this.ctx) return;
    const now = Date.now();
    if (now - this._lastFootstep < 280) return;
    this._lastFootstep = now;
    this.resume();
    const ctx = this.ctx;
    const dur = 0.06;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.15));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 + Math.random() * 400;
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  },

  playInteract() {
    if (!this.enabled || !this.ctx) return;
    this.resume();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    gain.connect(ctx.destination);
    [520, 780].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t + i * 0.1);
      osc.stop(t + 0.4);
    });
  },

  playTradeAlert() {
    if (!this.enabled || !this.ctx) return;
    this.resume();
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    gain.connect(ctx.destination);
    [440, 554, 659].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t + i * 0.12);
      osc.stop(t + 0.6);
    });
  }
};

// ======================== CHARACTER TEXTURE (Global Helpers) ========================
// config: { type:0-3, skin:0-5, cloth:0-5, hair:0-4, hat:0-4, glasses:0-2 }
function charTextureKey(config) {
  if (!config) return 'char';
  return `char_${config.type||0}_${config.skin||0}_${config.cloth||0}_${config.hair||0}_${config.hat||0}_${config.glasses||0}`;
}

function generateCharTexture(scene, config, textureKey) {
  config = config || {};
  textureKey = textureKey || 'char';

  // Palettes
  const SKIN_C = ['#f0c987','#fad5c0','#c4885a','#8b5e3c','#5c3d1e','#e8b89a'];
  const SKIN_D = ['#d4a96a','#e4c090','#a96e40','#6e4424','#3d2410','#c8956f'];
  const CLTH_C = ['#3498db','#c0392b','#27ae60','#8e44ad','#e67e22','#7f8c8d'];
  const CLTH_D = ['#2175a9','#962d22','#1e8449','#6e3585','#c05c1a','#626d6d'];
  const HAIR_C = ['#5a3620','#1a1a1a','#f6c90e','#c0392b','#bdc3c7'];

  const skin  = SKIN_C[config.skin  ?? 0] || SKIN_C[0];
  const skinD = SKIN_D[config.skin  ?? 0] || SKIN_D[0];
  const clth  = CLTH_C[config.cloth ?? 0] || CLTH_C[0];
  const clthD = CLTH_D[config.cloth ?? 0] || CLTH_D[0];
  const hair  = HAIR_C[config.hair  ?? 0] || HAIR_C[0];
  const type  = config.type || 0;

  const canvas = document.createElement('canvas');
  const W = 24, H = 32;
  canvas.width = W * 3;
  canvas.height = H * 4;
  const ctx = canvas.getContext('2d');

  for (let dir = 0; dir < 4; dir++) {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * W;
      const oy = dir * H;
      ctx.save();
      ctx.translate(ox, oy);

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(12, 30, 7, 3, 0, 0, Math.PI * 2); ctx.fill();

      // --- Legs ---
      const legC = type===1 ? '#7f8c8d' : type===2 ? '#6c3483' : type===3 ? '#2c3e50' : '#34495e';
      const legD = type===1 ? '#626d6d' : type===2 ? '#4a235a' : type===3 ? '#1a252f' : '#2c3e50';
      ctx.fillStyle = legC;
      if (frame === 0) {
        ctx.fillRect(8, 24, 4, 6); ctx.fillRect(12, 24, 4, 6);
        ctx.fillStyle = legD;
        ctx.fillRect(7, 29, 5, 2); ctx.fillRect(12, 29, 5, 2);
      } else if (frame === 1) {
        ctx.fillRect(6, 24, 4, 6); ctx.fillRect(14, 22, 4, 5);
        ctx.fillStyle = legD;
        ctx.fillRect(5, 29, 5, 2); ctx.fillRect(14, 26, 5, 2);
      } else {
        ctx.fillRect(6, 22, 4, 5); ctx.fillRect(14, 24, 4, 6);
        ctx.fillStyle = legD;
        ctx.fillRect(5, 26, 5, 2); ctx.fillRect(14, 29, 5, 2);
      }

      // --- Body/Torso ---
      if (type === 1) {
        ctx.fillStyle = '#7f8c8d'; ctx.fillRect(7, 14, 10, 11);
        ctx.fillStyle = '#bdc3c7'; ctx.fillRect(8, 15, 8, 2); ctx.fillRect(10, 17, 4, 7);
        ctx.fillStyle = '#626d6d'; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 15, 2, 9);
      } else if (type === 2) {
        ctx.fillStyle = clth; ctx.fillRect(6, 14, 12, 11);
        ctx.fillStyle = clthD; ctx.fillRect(6, 14, 12, 1); ctx.fillRect(11, 15, 2, 9);
        ctx.fillStyle = 'rgba(255,255,200,0.7)';
        ctx.fillRect(8, 17, 1, 1); ctx.fillRect(15, 19, 1, 1); ctx.fillRect(10, 21, 1, 1);
      } else if (type === 3) {
        ctx.fillStyle = '#7d6544'; ctx.fillRect(7, 14, 10, 11);
        ctx.fillStyle = '#5d4a2e'; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 14, 2, 11);
        ctx.fillStyle = '#c0a060'; ctx.fillRect(7, 22, 10, 2);
      } else {
        ctx.fillStyle = clth; ctx.fillRect(7, 14, 10, 11);
        ctx.fillStyle = clthD; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 15, 2, 9);
      }

      // --- Arms ---
      const armC = type===1 ? '#7f8c8d' : type===3 ? '#7d6544' : clth;
      ctx.fillStyle = armC;
      if (frame === 0) {
        ctx.fillRect(4, 15, 3, 8); ctx.fillRect(17, 15, 3, 8);
        ctx.fillStyle = skin; ctx.fillRect(4, 22, 3, 2); ctx.fillRect(17, 22, 3, 2);
      } else if (frame === 1) {
        ctx.fillRect(4, 14, 3, 8); ctx.fillRect(17, 16, 3, 8);
        ctx.fillStyle = skin; ctx.fillRect(4, 21, 3, 2); ctx.fillRect(17, 23, 3, 2);
      } else {
        ctx.fillRect(4, 16, 3, 8); ctx.fillRect(17, 14, 3, 8);
        ctx.fillStyle = skin; ctx.fillRect(4, 23, 3, 2); ctx.fillRect(17, 21, 3, 2);
      }
      if (type === 1) {
        ctx.fillStyle = '#bdc3c7';
        ctx.fillRect(3, 14, 4, 3); ctx.fillRect(17, 14, 4, 3);
      }

      // --- Head ---
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.arc(12, 9, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skinD;
      if (dir === 1) ctx.fillRect(5, 8, 2, 3);
      if (dir === 2) ctx.fillRect(17, 8, 2, 3);

      // --- Hair ---
      ctx.fillStyle = hair;
      ctx.beginPath(); ctx.arc(12, 7, 7, Math.PI, 2 * Math.PI); ctx.fill();
      ctx.fillRect(5, 5, 14, 3);
      if (dir === 0) ctx.fillRect(7, 4, 4, 3);

      // --- Eyes ---
      if (dir === 0) {
        ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 3, 3); ctx.fillRect(13, 8, 3, 3);
        ctx.fillStyle = '#2c3e50'; ctx.fillRect(9, 9, 2, 2); ctx.fillRect(14, 9, 2, 2);
      } else if (dir === 1) {
        ctx.fillStyle = '#fff'; ctx.fillRect(6, 8, 3, 3);
        ctx.fillStyle = '#2c3e50'; ctx.fillRect(6, 9, 2, 2);
      } else if (dir === 2) {
        ctx.fillStyle = '#fff'; ctx.fillRect(15, 8, 3, 3);
        ctx.fillStyle = '#2c3e50'; ctx.fillRect(16, 9, 2, 2);
      }
      if (dir === 3) {
        ctx.fillStyle = hair; ctx.fillRect(5, 4, 14, 8);
      }

      // --- Hat ---
      const hatH = config.hat || 0;
      if (hatH === 1) {
        ctx.fillStyle = clth; ctx.fillRect(5, 3, 14, 3); ctx.fillRect(7, 1, 10, 3);
        ctx.fillStyle = clthD; ctx.fillRect(5, 5, 14, 1);
        if (dir !== 3) { ctx.fillStyle = clth; ctx.fillRect(17, 4, 4, 2); }
      } else if (hatH === 2) {
        ctx.fillStyle = clth;
        ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(7, 4); ctx.lineTo(17, 4); ctx.closePath(); ctx.fill();
        ctx.fillRect(5, 3, 14, 3);
        ctx.fillStyle = '#f6c90e'; ctx.fillRect(6, 5, 12, 1);
      } else if (hatH === 3) {
        ctx.fillStyle = '#c0392b'; ctx.fillRect(5, 3, 14, 4);
        ctx.fillStyle = '#922b21'; ctx.fillRect(5, 6, 14, 1);
        ctx.fillStyle = '#c0392b'; ctx.fillRect(5, 3, 3, 2);
      } else if (hatH === 4) {
        ctx.fillStyle = '#f6c90e'; ctx.fillRect(5, 3, 14, 3);
        ctx.fillRect(6, 1, 2, 3); ctx.fillRect(11, 0, 2, 3); ctx.fillRect(16, 1, 2, 3);
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(7, 3, 2, 2); ctx.fillRect(12, 3, 2, 2); ctx.fillRect(17, 3, 2, 2);
      }

      // --- Glasses ---
      const glassT = config.glasses || 0;
      if (glassT === 1 && dir !== 3) {
        ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 1;
        if (dir === 0) {
          ctx.strokeRect(8, 8, 3, 3); ctx.strokeRect(13, 8, 3, 3);
          ctx.beginPath(); ctx.moveTo(11, 9); ctx.lineTo(13, 9); ctx.stroke();
        } else if (dir === 1) { ctx.strokeRect(6, 8, 3, 3); }
        else if (dir === 2) { ctx.strokeRect(15, 8, 3, 3); }
      } else if (glassT === 2 && dir !== 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        if (dir === 0) {
          ctx.fillRect(8, 8, 3, 2); ctx.fillRect(13, 8, 3, 2);
          ctx.fillStyle = '#1a1a1a'; ctx.fillRect(11, 8, 2, 1);
        } else if (dir === 1) { ctx.fillRect(6, 8, 3, 2); }
        else if (dir === 2) { ctx.fillRect(15, 8, 3, 2); }
      }

      ctx.restore();
    }
  }

  scene.textures.addSpriteSheet(textureKey, canvas, { frameWidth: W, frameHeight: H });
  return textureKey;
}

function getOrCreateCharTexture(scene, config) {
  const key = charTextureKey(config);
  if (!scene.textures.exists(key)) {
    generateCharTexture(scene, config, key);
    // Create matching animation set
    if (!scene.anims.exists('walk-down-' + key)) {
      scene.anims.create({ key: 'walk-down-' + key,  frames: scene.anims.generateFrameNumbers(key, { start: 0, end: 2 }),  frameRate: 8, repeat: -1 });
      scene.anims.create({ key: 'walk-left-' + key,  frames: scene.anims.generateFrameNumbers(key, { start: 3, end: 5 }),  frameRate: 8, repeat: -1 });
      scene.anims.create({ key: 'walk-right-' + key, frames: scene.anims.generateFrameNumbers(key, { start: 6, end: 8 }),  frameRate: 8, repeat: -1 });
      scene.anims.create({ key: 'walk-up-' + key,    frames: scene.anims.generateFrameNumbers(key, { start: 9, end: 11 }), frameRate: 8, repeat: -1 });
    }
  }
  return key;
}

// ======================== BOOT SCENE ========================
class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create() {
    TownSounds.init();
    this.generateTileset();
    this.generateWaterFrames();
    // Generate base 'char' texture with player's own config (default for others)
    generateCharTexture(this, loadCharConfig(), 'char');
    this.generateNPC();
    this.scene.start('Town');
  }

  generateTileset() {
    const canvas = document.createElement('canvas');
    canvas.width = TILE * 10;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d');

    // 0: Grass — lush with blade details
    this.drawTile(ctx, 0, () => {
      ctx.fillStyle = '#4a8c3f';
      ctx.fillRect(0, 0, TILE, TILE);
      const greens = ['#3d7a34','#5a9c4f','#448838','#3e8035'];
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = greens[i % greens.length];
        ctx.fillRect(Math.random()*30, Math.random()*30, 2+Math.random()*3, 1);
      }
      ctx.fillStyle = '#5aac4f';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(4+Math.random()*24, 4+Math.random()*24, 1, 3);
      }
      ctx.fillStyle = '#8a8a78';
      if (Math.random()>0.5) ctx.fillRect(Math.random()*28+2, Math.random()*28+2, 2, 2);
    });

    // 1: Path — cobblestone with 3D effect
    this.drawTile(ctx, 1, () => {
      ctx.fillStyle = '#b89b74';
      ctx.fillRect(0, 0, TILE, TILE);
      const stones = [[1,1,8,6],[10,0,9,7],[21,1,9,6],[0,8,7,7],[8,9,10,6],[19,8,11,7],[2,16,9,7],[12,17,8,6],[21,16,9,7],[0,24,8,7],[9,25,10,6],[20,24,10,7]];
      stones.forEach(([x,y,w,h]) => {
        ctx.fillStyle = '#c4a882';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#d4b892';
        ctx.fillRect(x, y, w, 1);
        ctx.fillRect(x, y, 1, h);
        ctx.fillStyle = '#a08968';
        ctx.fillRect(x, y+h-1, w, 1);
        ctx.fillRect(x+w-1, y, 1, h);
      });
    });

    // 2: Water — deep blue with ripple pattern
    this.drawTile(ctx, 2, () => {
      ctx.fillStyle = '#2980b9';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#3498db';
      for (let y = 0; y < TILE; y += 8) {
        for (let x = 0; x < TILE; x += 2) {
          const wave = Math.sin((x + y*0.5)*0.3)*2;
          if (wave > 0.5) ctx.fillRect(x, y+wave, 2, 2);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(8,6,2,1); ctx.fillRect(22,14,2,1); ctx.fillRect(14,24,2,1);
    });

    // 3: Tree — detailed canopy with highlights
    this.drawTile(ctx, 3, () => {
      ctx.fillStyle = '#3d7a34';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#4a8c3f';
      for (let i=0;i<6;i++) ctx.fillRect(Math.random()*28,Math.random()*28,3,2);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath(); ctx.ellipse(16,26,10,5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#5a3620';
      ctx.fillRect(13,16,6,14);
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(14,16,4,14);
      ctx.fillStyle = '#4d2e18';
      ctx.fillRect(14,19,3,1); ctx.fillRect(15,23,2,1); ctx.fillRect(14,26,3,1);
      ctx.fillStyle = '#1a5c10';
      ctx.beginPath(); ctx.arc(16,12,12,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#2d6b1e';
      ctx.beginPath(); ctx.arc(14,10,9,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(19,11,8,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#3d8c2e';
      ctx.beginPath(); ctx.arc(15,8,7,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(18,10,6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4a9c3e';
      ctx.beginPath(); ctx.arc(13,7,3,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(17,6,2,0,Math.PI*2); ctx.fill();
    });

    // 4: Wall — stone bricks with 3D shading
    this.drawTile(ctx, 4, () => {
      ctx.fillStyle = '#6c7a7b';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let row = 0; row < 4; row++) {
        const offset = row % 2 === 0 ? 0 : 8;
        for (let col = -1; col < 3; col++) {
          const x = offset + col * 16;
          const y = row * 8;
          if (x >= -16 && x < TILE) {
            ctx.fillStyle = '#8c9ea0';
            ctx.fillRect(x+1, y+1, 14, 6);
            ctx.fillStyle = '#9cafb0';
            ctx.fillRect(x+1, y+1, 14, 1);
            ctx.fillRect(x+1, y+1, 1, 6);
            ctx.fillStyle = '#7a8889';
            ctx.fillRect(x+1, y+6, 14, 1);
            ctx.fillRect(x+14, y+1, 1, 6);
          }
        }
      }
    });

    // 5: Roof — shingles with depth
    this.drawTile(ctx, 5, () => {
      ctx.fillStyle = '#a93226';
      ctx.fillRect(0, 0, TILE, TILE);
      for (let row = 0; row < 6; row++) {
        const offset = row % 2 === 0 ? 0 : 5;
        const y = row * 6 - 1;
        for (let col = 0; col < 5; col++) {
          const x = offset + col * 10 - 5;
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(x, y, 9, 5);
          ctx.fillStyle = '#d44637';
          ctx.fillRect(x, y, 9, 1);
          ctx.fillStyle = '#922b21';
          ctx.fillRect(x, y+4, 9, 2);
        }
      }
    });

    // 6: Door — arched wooden door in stone frame
    this.drawTile(ctx, 6, () => {
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#8c9ea0';
      ctx.fillRect(1, 1, 14, 6);
      ctx.fillRect(17, 1, 14, 6);
      ctx.fillStyle = '#5a3620';
      ctx.fillRect(7, 3, 18, 29);
      ctx.fillStyle = '#8B5E3C';
      ctx.fillRect(9, 5, 14, 27);
      ctx.fillStyle = '#7a5030';
      ctx.fillRect(15, 5, 2, 27);
      ctx.fillStyle = '#a07050';
      ctx.fillRect(9, 5, 14, 2);
      ctx.fillStyle = '#f5c542';
      ctx.fillRect(20, 18, 2, 3);
      ctx.fillStyle = '#d4a830';
      ctx.fillRect(20, 18, 2, 1);
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(9, 28, 14, 4);
    });

    // 7: Board NPC — bulletin board with notices
    this.drawTile(ctx, 7, () => {
      ctx.fillStyle = '#4a8c3f';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#3d7a34';
      for (let i=0;i<4;i++) ctx.fillRect(Math.random()*28,Math.random()*28,2,2);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(14, 22, 8, 3);
      ctx.fillStyle = '#5a3620';
      ctx.fillRect(14, 14, 4, 18);
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(15, 14, 2, 18);
      ctx.fillStyle = '#8B5E3C';
      ctx.fillRect(3, 2, 26, 14);
      ctx.fillStyle = '#d4a853';
      ctx.fillRect(4, 3, 24, 12);
      ctx.fillStyle = '#c49843';
      ctx.fillRect(4, 6, 24, 1); ctx.fillRect(4, 10, 24, 1);
      ctx.fillStyle = '#f0e6d0';
      ctx.fillRect(6, 4, 8, 6);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(16, 5, 10, 4);
      ctx.fillStyle = '#f5eee0';
      ctx.fillRect(17, 10, 8, 4);
      ctx.fillStyle = '#555';
      ctx.fillRect(7,5,6,1); ctx.fillRect(7,7,5,1); ctx.fillRect(17,6,8,1); ctx.fillRect(18,11,6,1);
    });

    // 8: Flower — varied garden flowers
    this.drawTile(ctx, 8, () => {
      ctx.fillStyle = '#4a8c3f';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#3d7a34';
      for (let i=0;i<5;i++) ctx.fillRect(Math.random()*28,Math.random()*28,2,1);
      const flowers = [
        {x:6,y:10,c:'#e74c3c'},{x:16,y:6,c:'#f39c12'},{x:24,y:12,c:'#9b59b6'},
        {x:10,y:22,c:'#e91e63'},{x:22,y:22,c:'#3498db'}
      ];
      flowers.forEach(f => {
        ctx.fillStyle = '#2d6b1e';
        ctx.fillRect(f.x, f.y+3, 1, 6);
        ctx.fillStyle = '#3d8c2e';
        ctx.fillRect(f.x+1, f.y+5, 2, 1);
        ctx.fillStyle = f.c;
        ctx.fillRect(f.x-2,f.y,2,2); ctx.fillRect(f.x+1,f.y,2,2);
        ctx.fillRect(f.x-1,f.y-2,2,2); ctx.fillRect(f.x-1,f.y+2,2,2);
        ctx.fillStyle = '#f5c542';
        ctx.fillRect(f.x-1,f.y,2,2);
      });
    });

    // 9: Fence — wooden picket fence
    this.drawTile(ctx, 9, () => {
      ctx.fillStyle = '#4a8c3f';
      ctx.fillRect(0, 0, TILE, TILE);
      ctx.fillStyle = '#3d7a34';
      for (let i=0;i<4;i++) ctx.fillRect(Math.random()*28,Math.random()*28,2,2);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.fillRect(1, 24, 30, 3);
      ctx.fillStyle = '#6b4226';
      ctx.fillRect(0, 20, TILE, 3); ctx.fillRect(0, 10, TILE, 3);
      ctx.fillStyle = '#8B5E3C';
      ctx.fillRect(0, 10, TILE, 1); ctx.fillRect(0, 20, TILE, 1);
      for (let i = 0; i < 5; i++) {
        const x = 2 + i * 7;
        ctx.fillStyle = '#7c5030';
        ctx.fillRect(x, 8, 4, 18);
        ctx.fillStyle = '#8B5E3C';
        ctx.fillRect(x, 8, 4, 1); ctx.fillRect(x, 8, 1, 18);
        ctx.fillStyle = '#7c5030';
        ctx.fillRect(x+1, 6, 2, 2);
        ctx.fillStyle = '#8B5E3C';
        ctx.fillRect(x+1, 6, 2, 1);
      }
    });

    this.textures.addCanvas('tiles', canvas);
  }

  drawTile(ctx, index, drawFn) {
    ctx.save();
    ctx.translate(index * TILE, 0);
    ctx.beginPath();
    ctx.rect(0, 0, TILE, TILE);
    ctx.clip();
    drawFn();
    ctx.restore();
  }

  generateWaterFrames() {
    for (let f = 0; f < 3; f++) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE;
      canvas.height = TILE;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a6b9c';
      ctx.fillRect(0, 0, TILE, TILE);
      const offset = f * 4;
      ctx.fillStyle = '#2980b9';
      for (let y = 0; y < TILE; y += 4) {
        for (let x = 0; x < TILE; x += 2) {
          const wave = Math.sin((x + offset + y * 0.7) * 0.35) * 2;
          if (wave > 0) ctx.fillRect(x, y, 2, 3);
        }
      }
      ctx.fillStyle = '#3498db';
      for (let y = 2; y < TILE; y += 6) {
        for (let x = 0; x < TILE; x += 2) {
          const wave = Math.sin((x + offset * 1.5 + y * 0.4) * 0.5);
          if (wave > 0.6) ctx.fillRect(x, y, 3, 1);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      const sparkles = [[6,4],[18,12],[10,22],[26,8],[14,16]];
      sparkles.forEach(([sx,sy], i) => {
        if ((f + i) % 3 === 0) ctx.fillRect(sx, sy, 2, 1);
      });
      this.textures.addCanvas('water_' + f, canvas);
    }
  }

  generateNPC() {
    const canvas = document.createElement('canvas');
    const W = 24, H = 32;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(12, 30, 8, 3, 0, 0, Math.PI * 2); ctx.fill();

    // Legs
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(7, 24, 4, 6); ctx.fillRect(13, 24, 4, 6);
    ctx.fillStyle = '#1a252f';
    ctx.fillRect(6, 29, 5, 2); ctx.fillRect(13, 29, 5, 2);

    // Body — green vest
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(6, 14, 12, 11);
    ctx.fillStyle = '#219a52';
    ctx.fillRect(6, 14, 12, 1); ctx.fillRect(11, 15, 2, 9);

    // Arms
    ctx.fillStyle = '#27ae60';
    ctx.fillRect(3, 15, 3, 7); ctx.fillRect(18, 15, 3, 7);
    ctx.fillStyle = '#f0c987';
    ctx.fillRect(3, 21, 3, 2); ctx.fillRect(18, 21, 3, 2);

    // Head
    ctx.fillStyle = '#f0c987';
    ctx.beginPath(); ctx.arc(12, 9, 7, 0, Math.PI * 2); ctx.fill();

    // Eyes with whites
    ctx.fillStyle = '#fff';
    ctx.fillRect(8, 8, 3, 3); ctx.fillRect(13, 8, 3, 3);
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(9, 9, 2, 2); ctx.fillRect(14, 9, 2, 2);
    // Smile
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(10, 12, 4, 1);

    // Hat — merchant hat
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(3, 4, 18, 4);
    ctx.fillStyle = '#d4a830';
    ctx.fillRect(5, 1, 14, 4);
    ctx.fillStyle = '#f5c542';
    ctx.fillRect(5, 1, 14, 1);
    // Hat band
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(5, 4, 14, 1);

    this.textures.addImage('npc', canvas);
  }
}

// ======================== TOWN SCENE ========================
class TownScene extends Phaser.Scene {
  constructor() { super('Town'); }

  create() {
    // Build tilemap
    const mapData = new Phaser.Tilemaps.MapData({
      width: MAP_W, height: MAP_H,
      tileWidth: TILE, tileHeight: TILE,
      format: Phaser.Tilemaps.Formats.ARRAY_2D
    });

    this.map = new Phaser.Tilemaps.Tilemap(this, mapData);
    const tileset = this.map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);

    // Ground layer
    this.groundLayer = this.map.createBlankLayer('ground', tileset, 0, 0, MAP_W, MAP_H, TILE, TILE);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        this.groundLayer.putTileAt(MAP[y][x], x, y);
      }
    }

    // Set collisions
    this.groundLayer.setCollision(BLOCKED);

    // NPC sprite
    this.npcSprite = this.add.image(NPC_POS.x * TILE + TILE / 2, NPC_POS.y * TILE + TILE / 2, 'npc');
    this.npcSprite.setDepth(NPC_POS.y * TILE);
    // Click/tap NPC to open bulletin board directly
    this.npcSprite.setInteractive({ useHandCursor: true });
    this.npcSprite.on('pointerdown', () => {
      TownSounds.playInteract();
      this.openBulletinBoard();
    });

    // NPC label
    this.npcLabel = this.add.text(NPC_POS.x * TILE + TILE / 2, NPC_POS.y * TILE - 8, 'Bulletin Board', {
      fontSize: '11px', color: '#f5c542', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 6, y: 2 }
    }).setOrigin(0.5).setDepth(9999);

    // NPC interaction hint (hidden initially)
    this.npcHint = this.add.text(NPC_POS.x * TILE + TILE / 2, NPC_POS.y * TILE + TILE + 12, isMobile() ? '[ACT]' : '[SPACE]', {
      fontSize: '10px', color: '#4ecca3', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
      backgroundColor: 'rgba(0,0,0,0.75)',
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(9999).setVisible(false);

    // House (bottom-right) interaction hint
    this.houseCharHint = this.add.text(
      HOUSE_CHAR_POS.x * TILE + TILE / 2,
      HOUSE_CHAR_POS.y * TILE + TILE + 12,
      (isMobile() ? '[ACT]' : '[SPACE]') + ' Customize',
      {
        fontSize: '10px', color: '#f5c542', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
        backgroundColor: 'rgba(0,0,0,0.75)',
        padding: { x: 5, y: 2 }
      }
    ).setOrigin(0.5).setDepth(9999).setVisible(false);

    // House (top-right) interaction hint — Mining House
    this.houseMineHint = this.add.text(
      HOUSE_MINE_POS.x * TILE + TILE / 2,
      HOUSE_MINE_POS.y * TILE + TILE + 12,
      (isMobile() ? '[ACT]' : '[SPACE]') + ' Mining',
      {
        fontSize: '10px', color: '#00d4ff', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
        backgroundColor: 'rgba(0,0,0,0.75)',
        padding: { x: 5, y: 2 }
      }
    ).setOrigin(0.5).setDepth(9999).setVisible(false);

    // Mining house label (always visible)
    this.add.text(
      HOUSE_MINE_POS.x * TILE + TILE / 2,
      (HOUSE_MINE_POS.y - 3) * TILE + TILE / 2,
      '⛏️ Mine',
      {
        fontSize: '9px', color: '#00d4ff', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
        stroke: '#000', strokeThickness: 3,
        backgroundColor: 'rgba(0,0,0,0.65)',
        padding: { x: 4, y: 2 }
      }
    ).setOrigin(0.5).setDepth(200);

    // Player character — load customization config from localStorage
    this.myCharConfig = loadCharConfig();
    this.createAnimations();
    const startX = 15 * TILE + TILE / 2;
    const startY = 15 * TILE + TILE / 2;
    const myCharKey = getOrCreateCharTexture(this, this.myCharConfig);
    this.player = this.physics.add.sprite(startX, startY, myCharKey, 0);
    this.player.setSize(16, 10);
    this.player.setOffset(4, 22);
    this.player.setDepth(startY);
    this.physics.add.collider(this.player, this.groundLayer);

    // Player name label
    const addr = getActiveBtctAddr();
    this.playerLabel = this.add.text(startX, startY - 22, shortAddr(addr), {
      fontSize: '11px', color: '#4ecca3', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
      backgroundColor: 'rgba(0,0,0,0.65)',
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(99999);

    // Camera
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.cameras.main.setZoom(1.5);

    // Controls (defensive — keyboard may not exist on mobile)
    townScene = this;
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = {
        up: this.input.keyboard.addKey('W'),
        down: this.input.keyboard.addKey('S'),
        left: this.input.keyboard.addKey('A'),
        right: this.input.keyboard.addKey('D'),
      };
      this.spaceKey = this.input.keyboard.addKey('SPACE');
      this.spaceKey.on('down', () => this.tryInteract());
    }

    // Other players group
    this.otherPlayersGroup = this.add.group();

    // Setup Socket.IO
    this.setupSocket();

    // Update wallet display
    this.updateWalletDisplay();

    // ---- Water animation ----
    this.waterFrame = 0;
    this.waterSprites = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (MAP[y][x] === 2) {
          const s = this.add.image(x * TILE + TILE/2, y * TILE + TILE/2, 'water_0');
          s.setDepth(-1);
          this.waterSprites.push(s);
        }
      }
    }
    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        this.waterFrame = (this.waterFrame + 1) % 3;
        this.waterSprites.forEach(s => s.setTexture('water_' + this.waterFrame));
      }
    });

    // ---- NPC bobbing ----
    this.tweens.add({
      targets: this.npcSprite,
      y: this.npcSprite.y - 2,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  // Play walk animation using texture-specific anim key (fallback to base key)
  playCharAnim(sprite, dir) {
    if (!sprite) return;
    const texKey = sprite.texture ? sprite.texture.key : 'char';
    const txAnim = 'walk-' + dir + '-' + texKey;
    const baseAnim = 'walk-' + dir;
    if (this.anims.exists(txAnim)) sprite.anims.play(txAnim, true);
    else if (this.anims.exists(baseAnim)) sprite.anims.play(baseAnim, true);
  }

  createAnimations() {
    // down (3 frames)
    this.anims.create({ key: 'walk-down', frames: this.anims.generateFrameNumbers('char', { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
    // left
    this.anims.create({ key: 'walk-left', frames: this.anims.generateFrameNumbers('char', { start: 3, end: 5 }), frameRate: 8, repeat: -1 });
    // right
    this.anims.create({ key: 'walk-right', frames: this.anims.generateFrameNumbers('char', { start: 6, end: 8 }), frameRate: 8, repeat: -1 });
    // up
    this.anims.create({ key: 'walk-up', frames: this.anims.generateFrameNumbers('char', { start: 9, end: 11 }), frameRate: 8, repeat: -1 });
  }

  update() {
    if (!this.player) return;

    // Block movement when chat input is focused
    const chatInput = document.getElementById('town-chat-input');
    const chatFocused = chatInput && (document.activeElement === chatInput);

    const up = !chatFocused && (this.cursors?.up?.isDown || this.wasd?.up?.isDown || mobileInput.y < -0.3);
    const down = !chatFocused && (this.cursors?.down?.isDown || this.wasd?.down?.isDown || mobileInput.y > 0.3);
    const left = !chatFocused && (this.cursors?.left?.isDown || this.wasd?.left?.isDown || mobileInput.x < -0.3);
    const right = !chatFocused && (this.cursors?.right?.isDown || this.wasd?.right?.isDown || mobileInput.x > 0.3);

    this.player.setVelocity(0);

    if (left) {
      this.player.setVelocityX(-SPEED);
      this.playCharAnim(this.player, 'left');
    } else if (right) {
      this.player.setVelocityX(SPEED);
      this.playCharAnim(this.player, 'right');
    }

    if (up) {
      this.player.setVelocityY(-SPEED);
      if (!left && !right) this.playCharAnim(this.player, 'up');
    } else if (down) {
      this.player.setVelocityY(SPEED);
      if (!left && !right) this.playCharAnim(this.player, 'down');
    }

    if (!up && !down && !left && !right) {
      this.player.anims.stop();
    }

    // Footstep sound
    if (up || down || left || right) TownSounds.playFootstep();

    // Depth sorting
    this.player.setDepth(this.player.y);

    // Update label position
    this.playerLabel.setPosition(this.player.x, this.player.y - 22);

    // Update self bubble position
    if (this.selfBubble) this.selfBubble.setPosition(this.player.x, this.player.y - 36);

    // Update self chat bubble position
    if (this.selfChatBubble) this.selfChatBubble.setPosition(this.player.x, this.player.y - 54);

    // Update other players' chat bubbles
    for (const id in otherPlayers) {
      const p = otherPlayers[id];
      if (p.chatBubble) p.chatBubble.setPosition(p.sprite.x, p.sprite.y - 54);
    }

    // Update trade notif badge position
    if (this.tradeNotifBadge) {
      const bx = this.player.x + 10;
      const by = this.player.y - 46;
      this.tradeNotifBadge.setPosition(bx, by);
      this.tradeNotifBadge.setDepth(99999);
    }

    // Check NPC proximity
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      NPC_POS.x * TILE + TILE / 2, NPC_POS.y * TILE + TILE / 2);
    this.npcHint.setVisible(dist < TILE * 2);

    // Check house (bottom-right) proximity
    const houseDist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      HOUSE_CHAR_POS.x * TILE + TILE / 2, HOUSE_CHAR_POS.y * TILE + TILE / 2);
    this.houseCharHint.setVisible(houseDist < TILE * 2);

    // Check house (top-right) proximity — Mining House
    const mineDist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      HOUSE_MINE_POS.x * TILE + TILE / 2, HOUSE_MINE_POS.y * TILE + TILE / 2);
    this.houseMineHint.setVisible(mineDist < TILE * 2);

    // Send position to server (throttled)
    this.sendPosition();
  }

  // ---- Socket.IO ----
  setupSocket() {
    socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: 10 });

    const scene = this;
    const emitJoin = () => {
      const addr = getActiveBtctAddr();
      socket.emit('townJoin', {
        address: addr,
        x: scene.player ? Math.round(scene.player.x) : 480,
        y: scene.player ? Math.round(scene.player.y) : 480,
        character: scene.myCharConfig || {},
      });
    };

    // Join/rejoin on connect (handles initial + reconnections)
    socket.on('connect', () => {
      console.log('[Town] Socket connected:', socket.id);
      // Register for personal notifications
      const myAddr = getActiveBtctAddr();
      if (myAddr) socket.emit('registerAddress', { address: myAddr });
      // Clear stale other players on reconnect
      for (const id in otherPlayers) {
        if (otherPlayers[id].sprite) otherPlayers[id].sprite.destroy();
        if (otherPlayers[id].label) otherPlayers[id].label.destroy();
        if (otherPlayers[id].bubble) otherPlayers[id].bubble.destroy();
        if (otherPlayers[id].chatBubble) otherPlayers[id].chatBubble.destroy();
        delete otherPlayers[id];
      }
      emitJoin();
    });

    socket.on('connect_error', (err) => {
      console.warn('[Town] Socket connect error:', err.message);
    });

    // Player joined
    socket.on('townPlayers', (players) => {
      Object.keys(players).forEach(id => {
        if (id !== socket.id) {
          try { this.addOtherPlayer(id, players[id]); } catch (e) { console.error('[Town] addOtherPlayer error:', e); }
        } else if (players[id].adText) {
          // Show own ad bubble
          this.setSelfBubble(players[id].adText);
        }
      });
      this.updatePlayerCount(Object.keys(players).length);
    });

    // New player
    socket.on('townPlayerJoined', (data) => {
      if (data.id !== socket.id) {
        this.addOtherPlayer(data.id, data);
      }
      this.updatePlayerCount(data.totalPlayers || 0);
    });

    // Player moved
    socket.on('townPlayerMoved', (data) => {
      if (data.id !== socket.id && otherPlayers[data.id]) {
        const p = otherPlayers[data.id];
        // Smooth lerp
        this.tweens.add({
          targets: p.sprite,
          x: data.x, y: data.y,
          duration: 150,
          onUpdate: () => {
            p.label.setPosition(p.sprite.x, p.sprite.y - 22);
            p.sprite.setDepth(p.sprite.y);
            if (p.bubble) p.bubble.setPosition(p.sprite.x, p.sprite.y - 34);
          }
        });

        // Animation direction
        if (data.dir) {
          this.playCharAnim(p.sprite, data.dir);
        } else {
          p.sprite.anims.stop();
        }
      }
    });

    // Player left
    socket.on('townPlayerLeft', (data) => {
      if (otherPlayers[data.id]) {
        otherPlayers[data.id].sprite.destroy();
        otherPlayers[data.id].label.destroy();
        if (otherPlayers[data.id].bubble) otherPlayers[data.id].bubble.destroy();
        if (otherPlayers[data.id].chatBubble) otherPlayers[data.id].chatBubble.destroy();
        delete otherPlayers[data.id];
      }
      this.updatePlayerCount(data.totalPlayers || 0);
    });

    // Ad bubble updates
    socket.on('townAdUpdate', (data) => {
      if (data.id && otherPlayers[data.id]) {
        this.setPlayerBubble(data.id, data.adText);
      }
      // Update own bubble if this is our address
      if (data.address) {
        const myAddr = getActiveBtctAddr();
        if (myAddr && data.address === myAddr.replace(/^0x/, '').toLowerCase()) {
          this.setSelfBubble(data.adText);
        }
      }
    });

    // Trade status real-time updates
    socket.on('tradeStatusUpdate', (data) => {
      if (currentTradeId && data.tradeId === currentTradeId) {
        townShowTradeDetail(currentTradeId);
      }
      // Celebration particles on trade completion
      if (data.status === 'completed') {
        this.showCompletionParticles();
        TownSounds.playTrade();
        townShowToast('🎉 Atomic swap completed!', 5000);
      }
    });

    socket.on('newMessage', (msg) => {
      const chatBox = document.getElementById('townChatMessages');
      if (chatBox && msg) {
        const t = new Date(msg.created_at).toLocaleTimeString();
        chatBox.innerHTML += `<div class="chat-msg"><span class="sender">${shortAddr(msg.sender_address)}</span> <span class="time">${t}</span><br>${escapeHtml(msg.content)}</div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
      }
    });

    // Town global chat receive
    socket.on('townChatMsg', (data) => {
      const container = document.getElementById('town-chat-messages');
      if (!container) return;
      const addr = data.address || '';
      const color = this.addrToCssColor(addr);
      const line = document.createElement('div');
      line.className = 'town-chat-line';
      line.innerHTML = `<span class="chat-name" style="color:${color}">${shortAddr(addr)}</span><span class="chat-text">${escapeHtml(data.content)}</span>`;
      container.appendChild(line);
      // Keep max 50 messages
      while (container.children.length > 50) container.removeChild(container.firstChild);
      container.scrollTop = container.scrollHeight;
      // Show chat bubble above character
      this.showChatBubble(addr, data.content);
    });

    // New trade alert (for ad owners)
    socket.on('newTradeAlert', (data) => {
      this.showTradeNotif(data);
    });

    // Emoji expression from other players
    socket.on('townEmojiMsg', (data) => {
      this.showEmojiBubble(data.id, data.address, data.emoji);
    });

    // Character update from another player
    socket.on('townCharUpdate', (data) => {
      if (!data.id || !otherPlayers[data.id]) return;
      const p = otherPlayers[data.id];
      const newKey = getOrCreateCharTexture(this, data.character || {});
      p.sprite.setTexture(newKey, 0);
      p.character = data.character || {};
    });

    // Enter key to activate/send town chat
    this.setupTownChat();
    // Market price panel
    initMarketPanel();
  }

  addOtherPlayer(id, data) {
    if (otherPlayers[id]) return;

    // Generate character texture from config (or default)
    const otherKey = getOrCreateCharTexture(this, data.character || {});
    const sprite = this.physics.add.sprite(data.x || 15 * TILE, data.y || 15 * TILE, otherKey, 0);
    sprite.setSize(16, 10);
    sprite.setOffset(4, 22);
    sprite.setDepth(data.y || 0);

    const label = this.add.text(sprite.x, sprite.y - 22, shortAddr(data.address), {
      fontSize: '11px', color: '#f0f0f0', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
      backgroundColor: 'rgba(0,0,0,0.65)',
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(99999);

    otherPlayers[id] = { sprite, label, address: data.address, bubble: null, character: data.character || {} };

    // Show ad bubble if player has active ad
    if (data.adText) {
      this.setPlayerBubble(id, data.adText);
    }

    // Make clickable
    sprite.setInteractive();
    sprite.on('pointerdown', () => {
      this.showPlayerInfo(data.address);
    });
  }

  setPlayerBubble(id, text) {
    if (!otherPlayers[id]) return;
    const p = otherPlayers[id];
    if (p.bubble) p.bubble.destroy();
    if (!text) return;

    p.bubble = this.add.text(p.sprite.x, p.sprite.y - 34, text, {
      fontSize: '9px', color: '#f5c542', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
      backgroundColor: 'rgba(22,33,62,0.85)',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setDepth(99999);
  }

  showTradeNotif(data) {
    // Clear existing badge
    this.clearTradeNotif();

    // Create '!' badge above player head
    this.tradeNotifBadge = this.add.text(
      this.player.x + 10, this.player.y - 46, '!',
      {
        fontSize: '14px', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
        color: '#fff',
        backgroundColor: '#e53e3e',
        padding: { x: 5, y: 2 },
        stroke: '#000', strokeThickness: 2,
      }
    ).setOrigin(0.5).setDepth(99999).setInteractive({ useHandCursor: true });

    // Bounce tween
    this.tweens.add({
      targets: this.tradeNotifBadge,
      y: '-=6',
      duration: 350,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    // Click → open Bulletin Board on My Trades tab
    this.tradeNotifBadge.on('pointerdown', () => {
      this.clearTradeNotif();
      TownSounds.playInteract();
      this.openBulletinBoard();
      setTimeout(() => townSwitchTab('myTrades'), 120);
    });

    // Toast
    const btct = (Number(data.btctAmount) / 1e11).toFixed(3);
    townShowToast(`🔔 New swap on your listing! ${btct} BTCT  —  tap ! to view`, 8000);
  }

  clearTradeNotif() {
    if (this.tradeNotifBadge) {
      this.tweens.killTweensOf(this.tradeNotifBadge);
      this.tradeNotifBadge.destroy();
      this.tradeNotifBadge = null;
    }
  }

  // Confetti/firework celebration on trade completion
  showCompletionParticles() {
    if (!this.player) return;
    const x = this.player.x;
    const y = this.player.y - 20;
    const colors = [0xf5c542, 0x4ecca3, 0xe94560, 0x3fa7ff, 0xff9f43, 0xf368e0];
    const particles = [];
    for (let i = 0; i < 24; i++) {
      const color = colors[i % colors.length];
      const px = this.add.rectangle(x, y, 6, 6, color).setDepth(100003);
      const angle = (Math.PI * 2 / 24) * i + (Math.random() * 0.3 - 0.15);
      const speed = 80 + Math.random() * 100;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 60; // upward bias
      particles.push(px);
      this.tweens.add({
        targets: px,
        x: x + vx,
        y: y + vy + 80, // gravity pull
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 1200 + Math.random() * 600,
        ease: 'Power2',
        onComplete: () => px.destroy()
      });
    }
    // Big center text
    const txt = this.add.text(x, y - 30, '🎉 SWAP COMPLETE!', {
      fontSize: '16px', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      color: '#f5c542', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(100004);
    this.tweens.add({
      targets: txt,
      y: y - 90,
      alpha: 0,
      duration: 2500,
      ease: 'Power2',
      onComplete: () => txt.destroy()
    });
  }

  showChatBubble(address, content) {
    const myAddr = getActiveBtctAddr();
    const isMe = address && address === myAddr;
    // Truncate long messages
    const text = content.length > 28 ? content.substring(0, 28) + '…' : content;
    const style = {
      fontSize: '11px', color: '#ffffff', fontFamily: 'Arial,sans-serif',
      stroke: '#000000', strokeThickness: 3,
      backgroundColor: 'rgba(20,40,80,0.92)',
      padding: { x: 7, y: 5 }
    };

    if (isMe) {
      // Remove previous
      if (this.selfChatBubble) { this.tweens.killTweensOf(this.selfChatBubble); this.selfChatBubble.destroy(); }
      if (this._selfChatTimer) { clearTimeout(this._selfChatTimer); }
      this.selfChatBubble = this.add.text(
        this.player.x, this.player.y - 54, `💬 ${text}`, style
      ).setOrigin(0.5).setDepth(100001);
      this._selfChatTimer = setTimeout(() => {
        if (this.selfChatBubble) {
          this.tweens.add({
            targets: this.selfChatBubble, alpha: 0, duration: 600,
            onComplete: () => { if (this.selfChatBubble) { this.selfChatBubble.destroy(); this.selfChatBubble = null; } }
          });
        }
      }, 4500);
    } else {
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (p.address !== address) continue;
        // Remove previous
        if (p.chatBubble) { this.tweens.killTweensOf(p.chatBubble); p.chatBubble.destroy(); }
        if (p._chatTimer) clearTimeout(p._chatTimer);
        p.chatBubble = this.add.text(
          p.sprite.x, p.sprite.y - 54, `💬 ${text}`, style
        ).setOrigin(0.5).setDepth(100001);
        const scene = this;
        p._chatTimer = setTimeout(() => {
          if (p.chatBubble) {
            scene.tweens.add({
              targets: p.chatBubble, alpha: 0, duration: 600,
              onComplete: () => { if (p.chatBubble) { p.chatBubble.destroy(); p.chatBubble = null; } }
            });
          }
        }, 4500);
        break;
      }
    }
  }

  // Emoji float-up bubble (big emoji above character, floats up + fades)
  showEmojiBubble(socketId, address, emoji) {
    const myAddr = getActiveBtctAddr();
    const isMe = address && address === myAddr;
    const style = {
      fontSize: '28px', fontFamily: 'Arial,sans-serif',
    };
    let targetX, targetY;
    if (isMe && this.player) {
      targetX = this.player.x;
      targetY = this.player.y - 50;
    } else if (otherPlayers[socketId]) {
      targetX = otherPlayers[socketId].sprite.x;
      targetY = otherPlayers[socketId].sprite.y - 50;
    } else {
      // fallback: find by address
      for (const id in otherPlayers) {
        if (otherPlayers[id].address === address) {
          targetX = otherPlayers[id].sprite.x;
          targetY = otherPlayers[id].sprite.y - 50;
          break;
        }
      }
    }
    if (targetX === undefined) return;
    const emojiText = this.add.text(targetX, targetY, emoji, style)
      .setOrigin(0.5).setDepth(100002);
    this.tweens.add({
      targets: emojiText,
      y: targetY - 50,
      alpha: 0,
      duration: 2000,
      ease: 'Power2',
      onComplete: () => emojiText.destroy()
    });
  }

  setSelfBubble(text) {
    if (this.selfBubble) this.selfBubble.destroy();
    this.selfBubble = null;
    if (!text || !this.player) return;

    this.selfBubble = this.add.text(this.player.x, this.player.y - 36, text, {
      fontSize: '9px', color: '#f5c542', fontFamily: 'Arial,sans-serif', fontStyle: 'bold',
      stroke: '#000', strokeThickness: 2,
      backgroundColor: 'rgba(22,33,62,0.85)',
      padding: { x: 5, y: 3 }
    }).setOrigin(0.5).setDepth(99999);
  }

  addrToColor(addr) {
    if (!addr || addr.length < 6) return 0xffffff;
    const hex = addr.replace(/^0x/, '').substring(0, 6);
    const r = parseInt(hex.substring(0, 2), 16) || 128;
    const g = parseInt(hex.substring(2, 4), 16) || 128;
    const b = parseInt(hex.substring(4, 6), 16) || 128;
    // Brighten to avoid too dark
    const br = Math.min(255, r + 80);
    const bg = Math.min(255, g + 80);
    const bb = Math.min(255, b + 80);
    return (br << 16) | (bg << 8) | bb;
  }

  addrToCssColor(addr) {
    const c = this.addrToColor(addr);
    return '#' + ((c >> 16) & 0xff).toString(16).padStart(2, '0')
      + ((c >> 8) & 0xff).toString(16).padStart(2, '0')
      + (c & 0xff).toString(16).padStart(2, '0');
  }

  setupTownChat() {
    const input = document.getElementById('town-chat-input');
    if (!input) return;

    // Global Enter key to focus chat
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && document.activeElement !== input) {
        // If modal is open, don't capture
        const modal = document.getElementById('trade-modal');
        if (modal && !modal.classList.contains('hidden')) return;
        input.focus();
        e.preventDefault();
      }
    });

    // Handle Enter/Escape inside input, stop other keys from reaching game
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const content = input.value.trim();
        if (content && socket) {
          socket.emit('townChat', { content });
        }
        input.value = '';
        input.blur();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
        e.preventDefault();
      }
      e.stopPropagation();
    });
  }

  sendPosition() {
    if (!socket) return;
    const now = Date.now();
    if (this._lastSend && now - this._lastSend < 100) return;
    this._lastSend = now;

    let dir = null;
    if (this.player.body.velocity.x < 0) dir = 'left';
    else if (this.player.body.velocity.x > 0) dir = 'right';
    else if (this.player.body.velocity.y < 0) dir = 'up';
    else if (this.player.body.velocity.y > 0) dir = 'down';

    socket.emit('townMove', {
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      dir: dir,
    });
  }

  updatePlayerCount(count) {
    document.getElementById('player-count').textContent = count + ' online';
  }

  async updateWalletDisplay() {
    const addr = getActiveBtctAddr();
    const dogeAddr = getActiveDogeAddr();
    const el = document.getElementById('wallet-display');
    if (!el) return;
    el.onclick = () => openTownWallet();
    if (!addr) {
      el.innerHTML = '<span class="wallet-addr" style="color:#e94560;">No Wallet — Click to create</span>';
      return;
    }
    el.innerHTML = `<span class="wallet-addr" style="color:#4ecca3;">${shortAddr(addr)}</span>`
      + `<span class="wallet-bals"><span id="town-btct-bal" style="color:#f5c542;">BTCT: …</span>`
      + ` <span id="town-doge-bal" style="color:#b8d4ff;">DOGE: ${dogeAddr ? '…' : '--'}</span></span>`;
    // 잔액 비동기 조회
    try {
      const b = await fetch(`/api/btct/balance/${addr}`).then(r => r.json());
      const balEl = document.getElementById('town-btct-bal');
      if (balEl) balEl.textContent = 'BTCT: ' + satToBTCT(b.balance);
    } catch (e) {
      const balEl = document.getElementById('town-btct-bal');
      if (balEl) balEl.textContent = 'BTCT: ?';
    }
    if (dogeAddr) {
      try {
        const d = await fetch(`/api/doge/balance/${dogeAddr}`).then(r => r.json());
        const balEl = document.getElementById('town-doge-bal');
        if (balEl) balEl.textContent = 'DOGE: ' + satToDOGE(d.balance);
      } catch (e) {
        const balEl = document.getElementById('town-doge-bal');
        if (balEl) balEl.textContent = 'DOGE: ?';
      }
    }
  }


  // ---- Interactions ----
  tryInteract() {
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      NPC_POS.x * TILE + TILE / 2, NPC_POS.y * TILE + TILE / 2);

    if (dist < TILE * 4) {  // TILE*4 = 128px (울타리 바깥에서도 도달 가능)
      TownSounds.playInteract();
      this.openBulletinBoard();
      return;
    }

    // Check house (bottom-right): open character customizer
    const houseDist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      HOUSE_CHAR_POS.x * TILE + TILE / 2, HOUSE_CHAR_POS.y * TILE + TILE / 2);
    if (houseDist < TILE * 2) {
      TownSounds.playInteract();
      openCharModal();
      return;
    }

    // Check house (top-right): open mining panel
    const mineDist = Phaser.Math.Distance.Between(this.player.x, this.player.y,
      HOUSE_MINE_POS.x * TILE + TILE / 2, HOUSE_MINE_POS.y * TILE + TILE / 2);
    if (mineDist < TILE * 2) {
      TownSounds.playInteract();
      openMinePanel();
      return;
    }

    // Check if near another player
    for (const id in otherPlayers) {
      const p = otherPlayers[id];
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.sprite.x, p.sprite.y);
      if (d < TILE * 2) {
        this.showPlayerInfo(p.address);
        return;
      }
    }
  }

  async openBulletinBoard() {
    panelOpen = true;
    syncCurrentUser();
    const panel = document.getElementById('interaction-panel');
    const title = document.getElementById('panel-title');
    const content = document.getElementById('panel-content');
    panel.classList.remove('hidden');
    title.textContent = 'Bulletin Board';

    content.innerHTML = `
      <div class="panel-tabs">
        <button class="tab-btn active" id="tabListings" onclick="townSwitchTab('listings')">Listings</button>
        <button class="tab-btn" id="tabMyTrades" onclick="townSwitchTab('myTrades')">My Trades</button>
      </div>
      <div id="tab-content"><div style="color:#888;text-align:center;padding:20px;">Loading...</div></div>
    `;

    townLoadListings();
  }

  showPlayerInfo(address) {
    if (!address) return;
    syncCurrentUser();
    const modal = document.getElementById('trade-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    const cleanAddr = address.replace(/^0x/, '');

    title.textContent = '👤 Player ' + shortAddr(address);
    content.innerHTML = `
      <div style="margin-bottom:10px;">
        <div style="color:#aaa;font-size:11px;">BTCT Address</div>
        <div style="color:#4ecca3;font-size:12px;word-break:break-all;user-select:all;">0x${cleanAddr}</div>
      </div>
      <div id="player-profile-stats" style="display:flex;gap:12px;margin-bottom:12px;">
        <div style="text-align:center;flex:1;background:rgba(255,255,255,0.04);padding:8px;border-radius:6px;">
          <div style="font-size:18px;color:#f5c542;" id="pp-listings">…</div>
          <div style="font-size:10px;color:#888;">Active Listings</div>
        </div>
        <div style="text-align:center;flex:1;background:rgba(255,255,255,0.04);padding:8px;border-radius:6px;">
          <div style="font-size:18px;color:#4ecca3;" id="pp-trades">…</div>
          <div style="font-size:10px;color:#888;">Completed</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" style="flex:1;min-width:80px;" onclick="townShowPlayerAds('${cleanAddr}')">View Listings</button>
        <button class="btn" style="flex:1;min-width:80px;background:#0f3460;color:#e0e0e0;border:1px solid #1a4a80;" onclick="townSendEmoji('${cleanAddr}')">👋 Wave</button>
        <button class="btn btn-danger" onclick="closeModal()">Close</button>
      </div>
    `;
    modal.classList.remove('hidden');

    // Async fetch profile stats
    (async () => {
      try {
        const ads = await api('/ads');
        const playerAds = (ads || []).filter(a => a.btct_address === cleanAddr && a.status === 'open');
        const el = document.getElementById('pp-listings');
        if (el) el.textContent = playerAds.length;
      } catch { const el = document.getElementById('pp-listings'); if (el) el.textContent = '?'; }
      try {
        const trades = await api(`/trades?address=${cleanAddr}`);
        const completed = (trades || []).filter(t => t.status === 'completed');
        const el = document.getElementById('pp-trades');
        if (el) el.textContent = completed.length;
      } catch { const el = document.getElementById('pp-trades'); if (el) el.textContent = '?'; }
    })();
  }
}

// ======================== GLOBAL UI FUNCTIONS ========================

function closePanel() {
  panelOpen = false;
  document.getElementById('interaction-panel').classList.add('hidden');
}

function closeModal() {
  document.getElementById('trade-modal').classList.add('hidden');
  currentTradeId = null;
}

// ======================== PANEL TAB SYSTEM ========================

function townSwitchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (tab === 'listings') {
    document.getElementById('tabListings').classList.add('active');
    townLoadListings();
  } else {
    document.getElementById('tabMyTrades').classList.add('active');
    townLoadMyTrades();
  }
}

async function townLoadListings() {
  const el = document.getElementById('tab-content');
  if (!el) return;
  el.innerHTML = '<div style="color:#888;text-align:center;padding:12px;">Loading...</div>';

  try {
    const ads = await api('/ads');

    let html = `<button class="btn btn-primary btn-sm" onclick="townShowPostModal()" style="margin-bottom:10px;width:100%;">+ Post Listing</button>`;

    if (!ads || ads.length === 0) {
      html += '<div style="color:#888;text-align:center;padding:16px;">No listings yet</div>';
    } else {
      ads.forEach(ad => {
        const typeClass = ad.type === 'sell' ? 'sell' : 'buy';
        const typeLabel = ad.type === 'sell' ? 'SELLING BTCT' : 'BUYING BTCT';
        const priceStr = parseFloat(ad.price).toFixed(4);
        const minBtct = satToBTCT(ad.min_btct);
        const maxBtct = satToBTCT(ad.remaining);
        const isOwn = currentUser && ad.btct_address === currentUser.btctAddress;
        html += `
          <div class="listing-item ${isOwn ? 'own' : ''}" onclick="${isOwn ? `townCloseAd(${ad.id})` : `townShowTradeStart(${ad.id})`}">
            <div class="listing-type ${typeClass}">${typeLabel}</div>
            <div class="listing-price">1 BTCT = ${priceStr} DOGE</div>
            <div class="listing-range">${minBtct} ~ ${maxBtct} BTCT</div>
            <div class="listing-addr">${shortAddr(ad.btct_address)}${isOwn ? ' <span style="color:#f5c542;">(You)</span>' : ''}</div>
          </div>`;
      });
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div style="color:#e94560;padding:16px;">Error: ${e.message}</div>`;
  }
}

async function townLoadMyTrades() {
  const el = document.getElementById('tab-content');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">Connect wallet in DEX first</div>';
    return;
  }
  el.innerHTML = '<div style="color:#888;text-align:center;padding:12px;">Loading...</div>';

  try {
    const trades = await api(`/trades?address=${currentUser.btctAddress}`);

    if (!trades || trades.length === 0) {
      el.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">No trades yet</div>';
      return;
    }

    let html = '';
    trades.forEach(t => {
      const isSeller = currentUser.btctAddress.toLowerCase() === t.seller_address.toLowerCase();
      const role = isSeller ? 'Seller' : 'Buyer';
      const statusClass = t.status === 'completed' ? 'done' : t.status === 'cancelled' ? 'cancelled' : 'active';
      html += `
        <div class="listing-item" onclick="townShowTradeDetail(${t.id})">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#f5c542;font-weight:bold;">Trade #${t.id}</span>
            <span class="trade-badge ${statusClass}">${tradeStatusLabel(t.status)}</span>
          </div>
          <div style="color:#ccc;font-size:12px;margin-top:4px;">${satToBTCT(t.btct_amount)} BTCT ↔ ${satToDOGE(t.doge_amount)} DOGE</div>
          <div style="color:#888;font-size:11px;">You: ${role} · ${shortAddr(isSeller ? t.buyer_address : t.seller_address)}</div>
        </div>`;
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = `<div style="color:#e94560;padding:16px;">Error: ${e.message}</div>`;
  }
}

function tradeStatusLabel(status) {
  const labels = {
    negotiating: 'Negotiating', hash_published: 'Hash Published',
    btct_locked: 'BTCT Locked', doge_locked: 'DOGE Locked',
    seller_redeemed: 'Seller Redeemed', completed: 'Completed',
    cancelled: 'Cancelled', expired: 'Expired'
  };
  return labels[status] || status;
}

// ======================== POST LISTING ========================

function townShowPostModal() {
  syncCurrentUser();
  if (!currentUser) return alert('Set your wallet in DEX first (← DEX link)');

  const modal = document.getElementById('trade-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = 'Post Listing';
  content.innerHTML = `
    <div class="form-group">
      <label>Type</label>
      <select id="townAdType">
        <option value="sell">SELL BTCT (receive DOGE)</option>
        <option value="buy">BUY BTCT (pay DOGE)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Price (DOGE per 1 BTCT)</label>
      <input type="number" id="townAdPrice" step="0.0001" min="0.0001" placeholder="e.g. 0.5000">
    </div>
    <div class="form-group">
      <label>Min BTCT</label>
      <input type="number" id="townAdMin" step="0.00001" min="0.00001" placeholder="e.g. 1">
    </div>
    <div class="form-group">
      <label>Max BTCT</label>
      <input type="number" id="townAdMax" step="0.00001" min="0.00001" placeholder="e.g. 100">
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;">
      <button class="btn btn-primary" style="flex:1;" onclick="townSubmitAd()">Post</button>
      <button class="btn btn-danger" onclick="closeModal()">Cancel</button>
    </div>
  `;
  modal.classList.remove('hidden');
}

async function townSubmitAd() {
  if (!currentUser) return;
  const type = document.getElementById('townAdType').value;
  const price = document.getElementById('townAdPrice').value;
  const minBtct = btctToSat(document.getElementById('townAdMin').value);
  const maxBtct = btctToSat(document.getElementById('townAdMax').value);

  if (!price || !minBtct || !maxBtct) return alert('Fill all fields');

  try {
    await api('/ads', {
      body: { btctAddress: currentUser.btctAddress, type, price, minBtct, maxBtct }
    });
    closeModal();
    townLoadListings();
  } catch (e) { alert(e.message); }
}

async function townCloseAd(adId) {
  if (!currentUser) return;
  if (!confirm('Close this listing?')) return;
  try {
    await api(`/ads/${adId}/close`, { body: { btctAddress: currentUser.btctAddress } });
    townLoadListings();
  } catch (e) { alert(e.message); }
}

// ======================== TRADE START ========================

async function townShowTradeStart(adId) {
  syncCurrentUser();
  if (!currentUser) return alert('Set your wallet in DEX first');

  try {
    const ads = await api('/ads');
    pendingAd = ads.find(a => a.id === adId);
    if (!pendingAd) return alert('Listing not found');

    const modal = document.getElementById('trade-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    const typeLabel = pendingAd.type === 'sell' ? 'SELLING BTCT' : 'BUYING BTCT';
    const typeClass = pendingAd.type === 'sell' ? 'sell' : 'buy';

    title.textContent = 'Start Trade';
    content.innerHTML = `
      <div class="info-box">
        <span class="listing-type ${typeClass}" style="font-size:14px;">${typeLabel}</span>
        <div style="margin-top:6px;color:#f5c542;font-size:15px;font-weight:bold;">1 BTCT = ${Number(pendingAd.price).toFixed(4)} DOGE</div>
        <div style="color:#aaa;font-size:12px;margin-top:4px;">Range: ${satToBTCT(pendingAd.min_btct)} – ${satToBTCT(pendingAd.remaining)} BTCT</div>
        <div style="color:#666;font-size:11px;margin-top:2px;">Seller: ${shortAddr(pendingAd.btct_address)}</div>
      </div>
      <div class="form-group">
        <label>BTCT Amount</label>
        <input type="number" id="townTradeAmount" step="0.00001" min="0.00001" placeholder="Enter BTCT amount" oninput="townCalcTrade()">
      </div>
      <div id="townTradeSummary" style="color:#ccc;font-size:13px;min-height:20px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="flex:1;" onclick="townSubmitTrade()">Start Atomic Swap</button>
        <button class="btn btn-danger" onclick="closeModal()">Cancel</button>
      </div>
      <div style="color:#666;font-size:11px;margin-top:8px;text-align:center;">Trustless HTLC — no middleman needed</div>
    `;
    modal.classList.remove('hidden');
  } catch (e) { alert(e.message); }
}

function townCalcTrade() {
  const amt = Number(document.getElementById('townTradeAmount').value);
  const el = document.getElementById('townTradeSummary');
  if (!pendingAd || amt <= 0) { el.innerHTML = ''; return; }
  const dogeAmt = amt * Number(pendingAd.price);
  el.innerHTML = `<strong style="color:#4ecca3;">${amt.toFixed(5)} BTCT</strong> ↔ <strong style="color:#f5c542;">${dogeAmt.toFixed(4)} DOGE</strong>`;
}

async function townSubmitTrade() {
  if (!currentUser || !pendingAd) return;
  const amount = Number(document.getElementById('townTradeAmount').value);
  if (amount <= 0) return alert('Enter a valid amount');

  try {
    const trade = await api('/trades', {
      body: { adId: pendingAd.id, buyerAddress: currentUser.btctAddress, btctAmount: btctToSat(amount) }
    });
    pendingAd = null;
    townShowTradeDetail(trade.id);
  } catch (e) { alert(e.message); }
}

// ======================== TRADE DETAIL (HTLC 5-Step) ========================

async function townShowTradeDetail(tradeId) {
  syncCurrentUser();
  const modal = document.getElementById('trade-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  currentTradeId = tradeId;
  socket.emit('joinTrade', tradeId);

  try {
    const trade = await api(`/trades/${tradeId}`);
    const isSeller = currentUser && currentUser.btctAddress.toLowerCase() === trade.seller_address.toLowerCase();
    const isBuyer = currentUser && currentUser.btctAddress.toLowerCase() === trade.buyer_address.toLowerCase();

    const steps = ['Hash Published', 'BTCT Locked', 'DOGE Locked', 'Seller Redeems', 'Buyer Redeems'];
    const stepStates = townGetStepStates(trade.status);

    title.textContent = `Trade #${trade.id}`;

    let html = `
      <div class="info-box">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="color:#4ecca3;">${satToBTCT(trade.btct_amount)} BTCT</strong>
          <span>↔</span>
          <strong style="color:#f5c542;">${satToDOGE(trade.doge_amount)} DOGE</strong>
        </div>
        <div style="color:#888;font-size:11px;margin-top:4px;">
          Seller: ${shortAddr(trade.seller_address)} · Buyer: ${shortAddr(trade.buyer_address)}
        </div>
      </div>

      <div class="swap-steps">
        ${steps.map((s, i) => `<div class="swap-step ${stepStates[i]}"><span class="step-num">${i + 1}</span>${s}</div>`).join('')}
      </div>

      ${townGetActionHTML(trade, isSeller, isBuyer)}

      ${trade.status === 'completed' ? `
        <div class="info-box" style="border-color:#4ecca3;color:#4ecca3;">
          ✓ Atomic swap completed!
          ${trade.btct_redeem_tx ? `<br><span style="font-size:11px;">BTCT TX: ${trade.btct_redeem_tx}</span>` : ''}
        </div>` : ''}

      ${['negotiating', 'hash_published'].includes(trade.status) ? `
        <button class="btn btn-danger btn-sm" style="margin-top:12px;width:100%;" onclick="townCancelTrade(${trade.id})">Cancel Trade</button>` : ''}

      <!-- Chat -->
      <div style="margin-top:16px;border-top:1px solid #0f3460;padding-top:12px;">
        <div style="font-weight:bold;color:#f5c542;font-size:13px;margin-bottom:8px;">Chat</div>
        <div id="townChatMessages" style="max-height:120px;overflow-y:auto;background:#0a0a1a;border-radius:4px;padding:8px;font-size:12px;margin-bottom:8px;min-height:40px;"></div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="townChatInput" placeholder="Type..." maxlength="500" style="flex:1;padding:6px 8px;background:#1a1a3e;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0;font-size:12px;" onkeypress="if(event.key==='Enter')townSendChat()">
          <button class="btn btn-sm btn-primary" onclick="townSendChat()">Send</button>
        </div>
      </div>

      <button class="btn btn-sm" style="margin-top:12px;width:100%;background:#333;color:#aaa;" onclick="closeModal()">Close</button>
    `;

    content.innerHTML = html;
    modal.classList.remove('hidden');

    // Load chat messages
    townLoadChat(tradeId);

  } catch (e) {
    title.textContent = 'Error';
    content.innerHTML = `<div style="color:#e94560;padding:16px;">${e.message}</div><button class="btn btn-sm" onclick="closeModal()">Close</button>`;
    modal.classList.remove('hidden');
  }
}

function townGetStepStates(status) {
  const order = ['hash_published', 'btct_locked', 'doge_locked', 'seller_redeemed', 'completed'];
  const idx = order.indexOf(status);
  return order.map((_, i) => {
    if (status === 'negotiating') return i === 0 ? 'active' : '';
    if (status === 'completed') return 'done';
    if (status === 'cancelled' || status === 'expired') return '';
    if (i < idx) return 'done';
    if (i === idx) return 'active';
    return '';
  });
}

function townGetActionHTML(trade, isSeller, isBuyer) {
  if (['completed', 'cancelled'].includes(trade.status)) return '';

  // Expired: show refund buttons
  if (trade.status === 'expired') {
    const hasDogeLock = !!trade.doge_redeem_script;
    if (!isSeller && !isBuyer) return '';
    return `<div class="action-box" style="border-color:#e74c3c;">
      <h4 style="color:#e74c3c;">⏰ Trade Expired</h4>
      <p style="font-size:12px;color:#aaa;">This trade timed out. Please reclaim your funds.</p>
      ${isSeller ? `<button class="btn btn-primary" style="width:100%;background:#e74c3c;" onclick="townBtctRefund(${trade.id})">Refund BTCT (Timeout)</button>` : ''}
      ${isBuyer && hasDogeLock ? `<button class="btn btn-primary" style="width:100%;background:#e74c3c;margin-top:6px;" onclick="townRefundDoge(${trade.id})">Refund DOGE (Timeout)</button>` : ''}
    </div>`;
  }

  // Step 1: Seller publishes hash
  if (trade.status === 'negotiating' && isSeller) {
    const hasDogeWallet = currentUser && currentUser.dogeAddress;
    return `<div class="action-box"><h4>Step 1: Generate Secret & Publish Hash</h4>
      <p style="font-size:12px;color:#aaa;">Generate a cryptographic secret. Its hash locks both sides.</p>
      ${!hasDogeWallet ? '<p style="font-size:11px;color:#e74c3c;">⚠ DOGE wallet required — add one in DEX first</p>' : ''}
      <button class="btn btn-primary" style="width:100%;" onclick="townPublishHash(${trade.id})" ${!hasDogeWallet ? 'disabled' : ''}>Generate Secret & Publish Hash</button></div>`;
  }
  if (trade.status === 'negotiating' && isBuyer) {
    return `<div class="action-box"><h4>Waiting for seller...</h4><p style="font-size:12px;color:#aaa;">Seller needs to generate secret & publish hash.</p></div>`;
  }

  // Step 2: Seller locks BTCT
  if (trade.status === 'hash_published' && isSeller) {
    return `<div class="action-box"><h4>Step 2: Lock BTCT in HTLC</h4>
      <p style="font-size:12px;color:#aaa;">Lock ${satToBTCT(trade.btct_amount)} BTCT in HTLC contract.</p>
      <p style="font-size:11px;color:#666;">Hash: ${trade.hash_lock}</p>
      <button class="btn btn-primary" style="width:100%;" onclick="townLockBTCT(${trade.id})">Lock BTCT</button></div>`;
  }
  if (trade.status === 'hash_published' && isBuyer) {
    return `<div class="action-box"><h4>Waiting for BTCT lock...</h4><p style="font-size:11px;color:#888;">Hash: ${trade.hash_lock}</p></div>`;
  }

  // Step 3: Buyer locks DOGE in P2SH HTLC
  if (trade.status === 'btct_locked' && isBuyer) {
    return `<div class="action-box"><h4>Step 3: Lock DOGE in HTLC</h4>
      <p style="font-size:12px;color:#aaa;">Lock ${satToDOGE(trade.doge_amount)} DOGE in P2SH HTLC. Seller claims by revealing secret.</p>
      <p style="font-size:11px;color:#666;">Seller DOGE: ${trade.seller_doge_address || 'N/A'}</p>
      <button class="btn btn-primary" style="width:100%;background:#27ae60;" onclick="townSendDoge(${trade.id})">Lock ${satToDOGE(trade.doge_amount)} DOGE in HTLC</button></div>`;
  }
  if (trade.status === 'btct_locked' && isSeller) {
    const currentBlock = window._currentBlock || 0;
    const timedOut = currentBlock > 0 && trade.btct_timeout && currentBlock >= trade.btct_timeout;
    if (timedOut) {
      return `<div class="action-box" style="border-color:#e74c3c;"><h4 style="color:#e74c3c;">⏰ BTCT Timeout Reached</h4>
        <p style="font-size:12px;color:#aaa;">Buyer did not lock DOGE. Reclaim your BTCT.</p>
        <button class="btn btn-primary" style="width:100%;background:#e74c3c;" onclick="townBtctRefund(${trade.id})">Refund BTCT (Timeout)</button></div>`;
    }
    return `<div class="action-box"><h4>Waiting for DOGE HTLC...</h4>
      <p style="font-size:11px;color:#888;">HTLC: 0x${trade.btct_htlc_address}</p></div>`;
  }

  // Step 4: Seller redeems DOGE from P2SH (reveals secret)
  if (trade.status === 'doge_locked' && isSeller) {
    const secret = localStorage.getItem(`dex_secret_${trade.id}`);
    return `<div class="action-box"><h4>Step 4: Redeem DOGE from HTLC</h4>
      <p style="font-size:12px;color:#aaa;">Claim DOGE by revealing your secret. Buyer can then claim BTCT.</p>
      <p style="font-size:11px;color:#666;">DOGE HTLC: ${trade.doge_htlc_address || 'N/A'}</p>
      <p style="font-size:11px;color:#666;">Secret: ${secret || 'NOT FOUND!'}</p>
      <button class="btn btn-primary" style="width:100%;background:#27ae60;" onclick="townSellerRedeem(${trade.id})">Reveal Secret & Redeem DOGE</button></div>`;
  }
  if (trade.status === 'doge_locked' && isBuyer) {
    const timedOut = trade.doge_timeout && DogeHTLC.isTimedOut(trade.doge_timeout);
    const timeStr = trade.doge_timeout ? DogeHTLC.formatTimeRemaining(trade.doge_timeout) : '';
    return `<div class="action-box"><h4>Waiting for seller to redeem...</h4>
      <p style="font-size:12px;color:#aaa;">Secret will be revealed soon. Timeout: ${timeStr}</p>
      ${timedOut ? `<button class="btn btn-primary" style="width:100%;background:#e74c3c;" onclick="townRefundDoge(${trade.id})">Refund DOGE (Timeout)</button>` : ''}
    </div>`;
  }

  // Step 5: Buyer redeems BTCT
  if (trade.status === 'seller_redeemed' && isBuyer) {
    return `<div class="action-box"><h4>Step 5: Redeem BTCT</h4>
      <p style="font-size:12px;color:#4ecca3;">Secret revealed! Claim your BTCT from HTLC.</p>
      <p style="font-size:11px;color:#666;">Secret: ${trade.secret_revealed}</p>
      <button class="btn btn-primary" style="width:100%;background:#27ae60;" onclick="townBuyerRedeem(${trade.id})">Redeem BTCT</button></div>`;
  }
  if (trade.status === 'seller_redeemed' && isSeller) {
    return `<div class="action-box"><h4>Waiting for buyer...</h4><p style="color:#4ecca3;font-size:12px;">✓ You've claimed your DOGE!</p></div>`;
  }

  return '';
}

// ======================== HTLC ACTIONS ========================

// Step 1: Publish Hash
async function townPublishHash(tradeId) {
  if (!currentUser) return;
  if (!currentUser.dogeAddress) return alert('DOGE wallet required. Add one in DEX Wallet tab first.');
  await ensureKrypton();

  try {
    const secretBytes = Krypton.PrivateKey.generate().serialize();
    const secretHex = Krypton.BufferUtils.toHex(secretBytes);
    const hashBytes = await Krypton.Hash.computeSha256(secretBytes);
    const hashHex = Krypton.BufferUtils.toHex(hashBytes);

    localStorage.setItem(`dex_secret_${tradeId}`, secretHex);

    await api(`/trades/${tradeId}/hash`, {
      body: {
        sellerAddress: currentUser.btctAddress,
        hashLock: hashHex,
        sellerDogeAddress: currentUser.dogeAddress
      }
    });

    alert('✓ Hash published!\n\nSECRET (backup!): ' + secretHex);
    socket.emit('tradeUpdate', { tradeId, status: 'hash_published' });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('Error: ' + e.message); }
}

// Step 2: Lock BTCT in HTLC
async function townLockBTCT(tradeId) {
  if (!currentUser || !currentUser.btctKey) return alert('BTCT wallet key not found');
  await ensureKrypton();

  try {
    const trade = await api(`/trades/${tradeId}`);
    const blockHeight = (await api('/btct/block')).height;

    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();

    const htlcSender = senderAddr;
    const htlcRecipient = Krypton.Address.fromHex(trade.buyer_address);
    const hashAlgo = Krypton.Hash.Algorithm.SHA256;
    const hashRoot = Krypton.BufferUtils.fromHex(trade.hash_lock);
    const hashCount = 1;
    const timeout = blockHeight + 1440;

    const bufSize = htlcSender.serializedSize + htlcRecipient.serializedSize + 1 + hashRoot.byteLength + 1 + 4;
    const data = new Krypton.SerialBuffer(bufSize);
    htlcSender.serialize(data);
    htlcRecipient.serialize(data);
    data.writeUint8(hashAlgo);
    data.write(hashRoot);
    data.writeUint8(hashCount);
    data.writeUint32(timeout);

    const value = Number(trade.btct_amount);
    const tx = new Krypton.ExtendedTransaction(
      senderAddr, Krypton.Account.Type.BASIC,
      Krypton.Address.CONTRACT_CREATION, Krypton.Account.Type.HTLC,
      value, blockHeight + 1,
      Krypton.Transaction.Flag.CONTRACT_CREATION, data
    );

    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    tx.proof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();

    const htlcAddress = tx.getContractCreationAddress();
    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    await api(`/trades/${tradeId}/btct-locked`, {
      body: { sellerAddress: currentUser.btctAddress, htlcTx: result.hash, htlcAddress: htlcAddress.toHex(), timeout }
    });

    alert('✓ BTCT locked in HTLC!\nContract: 0x' + htlcAddress.toHex());
    socket.emit('tradeUpdate', { tradeId, status: 'btct_locked' });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('HTLC creation failed: ' + e.message); console.error(e); }
}

// Step 3: Lock DOGE in HTLC P2SH
async function townSendDoge(tradeId) {
  if (!currentUser || !currentUser.dogeKey) return alert('DOGE wallet not connected. Set it in DEX first.');

  try {
    const trade = await api(`/trades/${tradeId}`);
    const dogeAmountSat = Number(trade.doge_amount);
    const sellerDogeAddr = trade.seller_doge_address;
    const buyerDogeAddr = currentUser.dogeAddress;

    if (!sellerDogeAddr) return alert('Seller DOGE address not found');
    if (!buyerDogeAddr) return alert('Your DOGE address not found');

    // Create HTLC P2SH
    const locktime = DogeHTLC.getDefaultLocktime();
    const htlc = DogeHTLC.createHTLC(trade.hash_lock, sellerDogeAddr, buyerDogeAddr, locktime);

    if (!confirm(`Lock ${satToDOGE(dogeAmountSat)} DOGE in HTLC P2SH?\n\nP2SH: ${htlc.p2shAddress}\nTimeout: ${new Date(locktime * 1000).toLocaleString()}\nFee: 0.01 DOGE`)) return;

    const utxos = await api(`/doge/utxos/${buyerDogeAddr}`);
    const rawTx = DogeHTLC.buildFundingTx(currentUser.dogeKey, htlc.p2shAddress, dogeAmountSat, utxos);
    const result = await api('/doge/broadcast', { body: { rawTx } });

    // Save HTLC info locally
    localStorage.setItem(`doge_htlc_${tradeId}`, JSON.stringify({
      redeemScriptHex: htlc.redeemScriptHex, p2shAddress: htlc.p2shAddress, locktime, amountSat: dogeAmountSat
    }));

    await api(`/trades/${tradeId}/doge-locked`, {
      body: {
        buyerAddress: currentUser.btctAddress, htlcTx: result.txid, htlcAddress: htlc.p2shAddress,
        timeout: locktime, buyerDogeAddress: buyerDogeAddr, dogeRedeemScript: htlc.redeemScriptHex
      }
    });

    alert('✓ DOGE locked in HTLC P2SH!\nTX: ' + result.txid);
    socket.emit('tradeUpdate', { tradeId, status: 'doge_locked' });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('DOGE HTLC failed: ' + e.message); console.error(e); }
}

// Step 4: Seller redeems DOGE from P2SH (reveals secret)
async function townSellerRedeem(tradeId) {
  if (!currentUser) return;
  if (!currentUser.dogeKey) return alert('DOGE wallet required to redeem');

  const secret = localStorage.getItem(`dex_secret_${tradeId}`);
  if (!secret) return alert('Secret not found! Check localStorage.');

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.doge_redeem_script || !trade.doge_htlc_address) return alert('DOGE HTLC data not found');

    const utxos = await api(`/doge/utxos/${trade.doge_htlc_address}`);
    if (!utxos || utxos.length === 0) return alert('No DOGE in HTLC P2SH. Wait for confirmation.');

    const rawTx = DogeHTLC.buildRedeemTx(currentUser.dogeKey, trade.doge_redeem_script, secret, utxos);
    const result = await api('/doge/broadcast', { body: { rawTx } });

    await api(`/trades/${tradeId}/seller-redeemed`, {
      body: { sellerAddress: currentUser.btctAddress, redeemTx: result.txid, secret }
    });

    alert('✓ DOGE redeemed! TX: ' + result.txid);
    socket.emit('tradeUpdate', { tradeId, status: 'seller_redeemed', detail: { secret } });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('DOGE redeem failed: ' + e.message); console.error(e); }
}

// DOGE HTLC Refund (buyer reclaims after timeout)
async function townBtctRefund(tradeId) {
  if (!currentUser || !currentUser.btctKey) return alert('BTCT wallet not connected.');
  try {
    await ensureKrypton();
    const trade = await api(`/trades/${tradeId}`);
    const blockInfo = await api('/btct/block');
    const blockHeight = blockInfo.height;
    if (blockHeight < trade.btct_timeout) {
      return alert(`Timeout not reached yet.\nCurrent: ${blockHeight} / Timeout: ${trade.btct_timeout}`);
    }
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();
    if (senderAddr.toHex().toLowerCase() !== trade.seller_address.toLowerCase()) {
      return alert('Only the seller can refund BTCT after timeout.');
    }
    const htlcAddr = trade.btct_htlc_address;
    const htlcAccount = await api(`/btct/account/${htlcAddr}`);
    const htlcBalance = Number(htlcAccount.balance);
    if (htlcBalance <= 0) {
      // Already refunded on-chain — just mark cancelled
      await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });
      townShowToast('HTLC already empty — trade marked as cancelled.');
      socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
      closeModal();
      return;
    }
    const htlcAddress = Krypton.Address.fromHex(htlcAddr);
    const networkFee = Number(Krypton.Policy.txFee(blockHeight));
    const refundValue = htlcBalance - networkFee;
    if (refundValue <= 0) return alert('HTLC balance too low to cover fee.');
    const tx = new Krypton.ExtendedTransaction(
      htlcAddress, Krypton.Account.Type.HTLC,
      senderAddr, Krypton.Account.Type.BASIC,
      refundValue, blockHeight,
      Krypton.Transaction.Flag.NONE, new Uint8Array(0)
    );
    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const sigProof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();
    const proof = new Krypton.SerialBuffer(1 + sigProof.byteLength);
    proof.writeUint8(Krypton.HashedTimeLockedContract.ProofType.TIMEOUT_RESOLVE);
    proof.write(sigProof);
    tx.proof = proof;
    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });
    await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });
    townShowToast('✓ BTCT refunded! TX: ' + result.hash);
    socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
    closeModal();
  } catch (e) {
    alert('BTCT refund failed: ' + e.message);
    console.error(e);
  }
}

async function townRefundDoge(tradeId) {
  if (!currentUser || !currentUser.dogeKey) return alert('DOGE wallet required');

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.doge_redeem_script || !trade.doge_htlc_address) return alert('DOGE HTLC data not found');
    if (!DogeHTLC.isTimedOut(trade.doge_timeout)) {
      return alert('Timeout not expired. Remaining: ' + DogeHTLC.formatTimeRemaining(trade.doge_timeout));
    }

    const utxos = await api(`/doge/utxos/${trade.doge_htlc_address}`);
    if (!utxos || utxos.length === 0) return alert('No DOGE in HTLC (already claimed or refunded)');

    const rawTx = DogeHTLC.buildRefundTx(currentUser.dogeKey, trade.doge_redeem_script, trade.doge_timeout, utxos);
    const result = await api('/doge/broadcast', { body: { rawTx } });

    alert('✓ DOGE refunded! TX: ' + result.txid);
    await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });
    socket.emit('tradeUpdate', { tradeId, status: 'cancelled' });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('DOGE refund failed: ' + e.message); console.error(e); }
}

// Step 5: Buyer redeems BTCT
async function townBuyerRedeem(tradeId) {
  if (!currentUser || !currentUser.btctKey) return alert('BTCT wallet key not found');
  await ensureKrypton();

  try {
    const trade = await api(`/trades/${tradeId}`);
    if (!trade.secret_revealed) return alert('Secret not yet revealed');

    const blockHeight = (await api('/btct/block')).height;
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(currentUser.btctKey));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const recipientAddr = keyPair.publicKey.toAddress();

    const htlcAddr = trade.btct_htlc_address;
    const htlcAccount = await api(`/btct/account/${htlcAddr}`);
    const htlcBalance = Number(htlcAccount.balance);
    if (htlcBalance <= 0) return alert('HTLC balance is 0');

    const htlcAddress = Krypton.Address.fromHex(htlcAddr);
    const networkFee = Number(Krypton.Policy.txFee(blockHeight));
    const redeemValue = htlcBalance - networkFee;
    if (redeemValue <= 0) return alert('HTLC balance too low to cover network fee');

    const tx = new Krypton.ExtendedTransaction(
      htlcAddress, Krypton.Account.Type.HTLC,
      recipientAddr, Krypton.Account.Type.BASIC,
      redeemValue, blockHeight,
      Krypton.Transaction.Flag.NONE, new Uint8Array(0)
    );

    const hashSize = 32;
    const secretBytes = Krypton.BufferUtils.fromHex(trade.secret_revealed);
    const hashRoot = Krypton.BufferUtils.fromHex(trade.hash_lock);

    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    const sigProof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();

    const proof = new Krypton.SerialBuffer(1 + 1 + 1 + hashSize + hashSize + sigProof.byteLength);
    proof.writeUint8(Krypton.HashedTimeLockedContract.ProofType.REGULAR_TRANSFER);
    proof.writeUint8(Krypton.Hash.Algorithm.SHA256);
    proof.writeUint8(1);
    proof.write(hashRoot);
    proof.write(secretBytes);
    proof.write(sigProof);
    tx.proof = proof;

    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    await api(`/trades/${tradeId}/buyer-redeemed`, {
      body: { buyerAddress: currentUser.btctAddress, redeemTx: result.hash }
    });

    alert('✓ BTCT redeemed! Trade complete!\nTX: ' + result.hash);
    socket.emit('tradeUpdate', { tradeId, status: 'completed' });
    townShowTradeDetail(tradeId);
  } catch (e) { alert('BTCT redeem failed: ' + e.message); console.error(e); }
}

async function townCancelTrade(tradeId) {
  if (!currentUser) return;
  if (!confirm('Cancel this trade?')) return;
  try {
    await api(`/trades/${tradeId}/cancel`, { body: { address: currentUser.btctAddress } });
    closeModal();
    townLoadMyTrades();
  } catch (e) { alert(e.message); }
}

// ======================== CHAT ========================

async function townLoadChat(tradeId) {
  try {
    const msgs = await api(`/trades/${tradeId}/messages`);
    const el = document.getElementById('townChatMessages');
    if (!el) return;
    el.innerHTML = msgs.map(m => {
      const t = new Date(m.created_at).toLocaleTimeString();
      return `<div style="margin-bottom:6px;"><span style="color:#4ecca3;font-size:11px;">${shortAddr(m.sender_address)}</span> <span style="color:#555;font-size:10px;">${t}</span><br><span style="color:#ccc;">${escapeHtml(m.content)}</span></div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  } catch {}
}

function townSendChat() {
  const input = document.getElementById('townChatInput');
  if (!input || !currentUser || !currentTradeId) return;
  const content = input.value.trim();
  if (!content) return;

  socket.emit('chatMessage', {
    tradeId: currentTradeId,
    senderAddress: currentUser.btctAddress,
    content
  });
  input.value = '';
}

// Show a specific player's active listings
async function townShowPlayerAds(address) {
  const modal = document.getElementById('trade-modal');
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-content');

  title.textContent = 'Player Listings';
  content.innerHTML = '<div style="color:#888;text-align:center;padding:20px;">Loading...</div>';

  try {
    const allAds = await api('/ads');
    const addr = address.replace(/^0x/, '').toLowerCase();
    const playerAds = allAds.filter(a => a.btct_address === addr);

    if (playerAds.length === 0) {
      content.innerHTML = `<div style="color:#888;text-align:center;padding:20px;">No active listings from this player.</div>
        <button class="btn btn-sm" style="width:100%;background:#333;color:#aaa;" onclick="closeModal()">Close</button>`;
      return;
    }

    let html = '';
    playerAds.forEach(ad => {
      const typeClass = ad.type === 'sell' ? 'sell' : 'buy';
      const typeLabel = ad.type === 'sell' ? 'SELLING BTCT' : 'BUYING BTCT';
      html += `
        <div class="listing-item" onclick="townShowTradeStart(${ad.id})">
          <div class="listing-type ${typeClass}">${typeLabel}</div>
          <div class="listing-price">1 BTCT = ${parseFloat(ad.price).toFixed(4)} DOGE</div>
          <div class="listing-range">${satToBTCT(ad.min_btct)} ~ ${satToBTCT(ad.remaining)} BTCT</div>
        </div>`;
    });
    html += `<button class="btn btn-sm" style="width:100%;background:#333;color:#aaa;margin-top:8px;" onclick="closeModal()">Close</button>`;
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div style="color:#e94560;padding:16px;">${e.message}</div>`;
  }
}

// ======================== TOWN DISCLAIMER ========================

function checkTownDisclaimer() {
  if (localStorage.getItem('btct_town_disclaimer_accepted')) {
    document.getElementById('townDisclaimerModal').style.display = 'none';
    return true;
  }
  document.getElementById('townDisclaimerModal').style.display = 'flex';
  return false;
}

function toggleTownDisclaimer() {
  const btn = document.getElementById('townDisclaimerEnterBtn');
  btn.disabled = !document.getElementById('townDisclaimerCheck').checked;
}

function acceptTownDisclaimer() {
  localStorage.setItem('btct_town_disclaimer_accepted', 'true');
  document.getElementById('townDisclaimerModal').style.display = 'none';
}

// Check on page load
if (!localStorage.getItem('btct_town_disclaimer_accepted')) {
  // Show disclaimer — game still loads behind it
}

// ======================== MINING PANEL ========================

let mineInitializing = false;

function openMinePanel() {
  const modal = document.getElementById('mine-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Set address from active wallet
    const addr = getActiveBtctAddr();
    const addrEl = document.getElementById('mine-address');
    if (addrEl) addrEl.textContent = addr ? '0x' + addr.replace(/^0x/, '') : 'No wallet connected';
    // Set thread slider max
    const slider = document.getElementById('mine-threads');
    if (slider && typeof TownMiner !== 'undefined') {
      slider.max = TownMiner.maxThreads;
      const st = TownMiner.getState();
      slider.value = st.threads;
      const tval = document.getElementById('mine-thread-val');
      if (tval) tval.textContent = st.threads + '/' + TownMiner.maxThreads;
    }
    updateMineUI();
  }
}

function closeMinePanel() {
  const modal = document.getElementById('mine-modal');
  if (modal) modal.classList.add('hidden');
}

function onMineThreadChange(val) {
  const n = parseInt(val) || 1;
  const tval = document.getElementById('mine-thread-val');
  if (tval && typeof TownMiner !== 'undefined') tval.textContent = n + '/' + TownMiner.maxThreads;
  if (typeof TownMiner !== 'undefined') TownMiner.setThreads(n);
}

async function toggleMining() {
  if (typeof TownMiner === 'undefined') { showMineError('Mining module not loaded'); return; }

  if (TownMiner.mining) {
    TownMiner.stopMining();
    return;
  }

  const addr = getActiveBtctAddr();
  if (!addr) { showMineError('Connect a BTCT wallet first'); return; }

  const btn = document.getElementById('mine-start-btn');
  if (btn) { btn.textContent = '⏳ Initializing...'; btn.disabled = true; }
  hideMineError();

  try {
    mineInitializing = true;
    await TownMiner.startMining(addr);
  } catch (e) {
    console.error('[Mining]', e);
    showMineError(e.message || 'Failed to start mining');
  } finally {
    mineInitializing = false;
    if (btn) btn.disabled = false;
    updateMineUI();
  }
}

function showMineError(msg) {
  const el = document.getElementById('mine-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function hideMineError() {
  const el = document.getElementById('mine-error');
  if (el) el.style.display = 'none';
}

function updateMineUI(state) {
  if (typeof TownMiner === 'undefined') return;
  const s = state || TownMiner.getState();

  // Status
  const statusEl = document.getElementById('mine-status');
  if (statusEl) {
    if (s.mining) {
      if (s.connectionState === 'connected') {
        statusEl.textContent = 'Mining ⛏️';
        statusEl.style.color = '#4ecca3';
      } else if (s.connectionState === 'connecting') {
        statusEl.textContent = 'Connecting to pool...';
        statusEl.style.color = '#f5c542';
      } else {
        statusEl.textContent = 'Reconnecting...';
        statusEl.style.color = '#f5c542';
      }
    } else {
      statusEl.textContent = 'Stopped';
      statusEl.style.color = '#888';
    }
  }

  // Consensus
  const consEl = document.getElementById('mine-consensus');
  if (consEl) {
    const cmap = { connecting: '🔴 Connecting', syncing: '🟡 Syncing', established: '🟢 Synced' };
    consEl.textContent = cmap[s.consensusState] || s.consensusState;
  }

  // Block height
  const blockEl = document.getElementById('mine-block');
  if (blockEl) blockEl.textContent = s.headHeight ? '#' + s.headHeight.toLocaleString() : '—';

  // Hashrate
  const hrEl = document.getElementById('mine-hashrate');
  if (hrEl) hrEl.textContent = s.hashrateFormatted;

  // Balance
  const balEl = document.getElementById('mine-balance');
  if (balEl) balEl.textContent = s.balanceFormatted + ' BTCT';
  const confEl = document.getElementById('mine-confirmed');
  if (confEl) confEl.textContent = s.confirmedBalanceFormatted + ' BTCT';

  // Start/stop button
  const btn = document.getElementById('mine-start-btn');
  if (btn && !mineInitializing) {
    if (s.mining) {
      btn.textContent = '■ Stop Mining';
      btn.classList.add('mining');
    } else {
      btn.textContent = '▶ Start Mining';
      btn.classList.remove('mining');
    }
  }

  // Top bar mining icon
  const mineBtn = document.getElementById('mine-open-btn');
  if (mineBtn) {
    if (s.mining) {
      mineBtn.classList.add('mining-active');
      mineBtn.title = 'Mining: ' + s.hashrateFormatted;
    } else {
      mineBtn.classList.remove('mining-active');
      mineBtn.title = 'Mining';
    }
  }
}

// Register TownMiner update callback
if (typeof TownMiner !== 'undefined') {
  TownMiner.onUpdate(updateMineUI);
}

// ======================== PHASER CONFIG ========================

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight - 44,
  parent: 'game-container',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: [BootScene, TownScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  backgroundColor: '#0a0a1a'
};

const game = new Phaser.Game(config);

// Handle resize
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight - 44);
});

// ======================== MOBILE CONTROLS ========================

function setupMobileControls() {
  const controls = document.getElementById('mobile-controls');
  if (!controls) return;
  controls.style.display = 'block';

  // Hide desktop help
  const help = document.getElementById('controls-help');
  if (help) help.style.display = 'none';

  const base = document.getElementById('joystick-base');
  const stick = document.getElementById('joystick-stick');
  const actBtn = document.getElementById('mobile-action-btn');

  let joyTouchId = null;

  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    joyTouchId = e.changedTouches[0].identifier;
    moveStick(e.changedTouches[0]);
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (joyTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId) {
        e.preventDefault();
        moveStick(e.changedTouches[i]);
        break;
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId) {
        joyTouchId = null;
        mobileInput.x = 0;
        mobileInput.y = 0;
        stick.style.transform = 'translate(-50%, -50%)';
        break;
      }
    }
  });

  document.addEventListener('touchcancel', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyTouchId) {
        joyTouchId = null;
        mobileInput.x = 0;
        mobileInput.y = 0;
        stick.style.transform = 'translate(-50%, -50%)';
        break;
      }
    }
  });

  function moveStick(touch) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = touch.clientX - cx;
    const dy = touch.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxR = rect.width / 2;

    let sx = dx, sy = dy;
    if (dist > maxR) {
      sx = (dx / dist) * maxR;
      sy = (dy / dist) * maxR;
    }

    stick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;

    const deadzone = 0.25;
    const norm = Math.min(dist / maxR, 1);
    if (norm > deadzone) {
      mobileInput.x = dx / dist;
      mobileInput.y = dy / dist;
    } else {
      mobileInput.x = 0;
      mobileInput.y = 0;
    }
  }

  // Action button
  actBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    actBtn.classList.add('active');
    if (townScene) {
      TownSounds.playInteract();
      townScene.tryInteract();
    }
  }, { passive: false });

  actBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    actBtn.classList.remove('active');
  }, { passive: false });
}

// Auto-init mobile controls
if (isMobile()) {
  setupMobileControls();
}

// ======================== Market Price Panel ========================
let _marketPanelInterval = null;
let _lastDogeUsdt = 0;

function toggleMarketPanel() {
  const panel = document.getElementById('market-panel');
  const icon = document.getElementById('market-panel-toggle-icon');
  if (!panel) return;
  const collapsed = panel.classList.toggle('collapsed');
  if (icon) icon.textContent = collapsed ? '+' : '−';
  localStorage.setItem('town_market_panel_open', collapsed ? '0' : '1');
}

async function loadMarketPanelData() {
  // DOGE/USDT from Binance
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=DOGEUSDT');
    const d = await r.json();
    const price = parseFloat(d.lastPrice);
    const change = parseFloat(d.priceChangePercent);
    _lastDogeUsdt = price;
    const priceEl = document.getElementById('mp-doge-price');
    const changeEl = document.getElementById('mp-doge-change');
    if (priceEl) priceEl.textContent = '$' + price.toFixed(5);
    if (changeEl) {
      changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      changeEl.className = 'mp-change ' + (change >= 0 ? 'up' : 'down');
    }
  } catch (e) {
    const el = document.getElementById('mp-doge-price');
    if (el) el.textContent = 'N/A';
  }

  // BTCT/DOGE from DEX trades
  try {
    const r = await fetch('/api/btct-chart');
    const trades = await r.json();
    const btctPriceEl = document.getElementById('mp-btct-price');
    const btctUsdEl = document.getElementById('mp-btct-usd');
    const btctChangeEl = document.getElementById('mp-btct-change');
    const btctHighEl = document.getElementById('mp-btct-high');
    const btctLowEl = document.getElementById('mp-btct-low');
    if (!trades || trades.length === 0) {
      if (btctPriceEl) btctPriceEl.textContent = 'No trades';
      if (btctUsdEl) btctUsdEl.textContent = '≈ $--';
      if (btctChangeEl) btctChangeEl.textContent = '';
      if (btctHighEl) btctHighEl.textContent = '--';
      if (btctLowEl) btctLowEl.textContent = '--';
      return;
    }
    const prices = trades.map(t => parseFloat(t.price));
    const last = prices[prices.length - 1];
    const first = prices[0];
    const change = ((last - first) / first) * 100;
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    if (btctPriceEl) btctPriceEl.textContent = last.toFixed(4) + ' DOGE';
    if (btctUsdEl) btctUsdEl.textContent = _lastDogeUsdt > 0 ? '≈ $' + (last * _lastDogeUsdt).toFixed(4) : '≈ $--';
    if (btctChangeEl) {
      btctChangeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      btctChangeEl.className = 'mp-change ' + (change >= 0 ? 'up' : 'down');
    }
    if (btctHighEl) btctHighEl.textContent = high.toFixed(4);
    if (btctLowEl) btctLowEl.textContent = low.toFixed(4);
  } catch (e) {
    const el = document.getElementById('mp-btct-price');
    if (el) el.textContent = 'Error';
  }
}

function initMarketPanel() {
  // Restore open/closed state (기본: 열림)
  const panel = document.getElementById('market-panel');
  const icon = document.getElementById('market-panel-toggle-icon');
  const saved = localStorage.getItem('town_market_panel_open');
  if (saved === '0') {
    if (panel) panel.classList.add('collapsed');
    if (icon) icon.textContent = '+';
  }
  // Initial load
  loadMarketPanelData();
  refreshTopBarBalance();
  // 30초 자동 갱신
  if (_marketPanelInterval) clearInterval(_marketPanelInterval);
  _marketPanelInterval = setInterval(() => {
    loadMarketPanelData();
    refreshTopBarBalance();
  }, 30000);
}

async function refreshTopBarBalance() {
  const addr = getActiveBtctAddr();
  const dogeAddr = getActiveDogeAddr();
  const btctEl = document.getElementById('town-btct-bal');
  const dogeEl = document.getElementById('town-doge-bal');
  const modalOpen = document.getElementById('town-wallet-modal') &&
    !document.getElementById('town-wallet-modal').classList.contains('hidden');
  const twBtctEl = modalOpen ? document.getElementById('tw-btct-bal') : null;
  const twDogeEl = modalOpen ? document.getElementById('tw-doge-bal') : null;

  if (addr) {
    try {
      const b = await fetch(`/api/btct/balance/${addr}`).then(r => r.json());
      if (btctEl) btctEl.textContent = 'BTCT: ' + satToBTCT(b.balance);
      if (twBtctEl) twBtctEl.textContent = satToBTCT(b.balance) + ' BTCT';
    } catch {}
  }
  if (dogeAddr) {
    try {
      const d = await fetch(`/api/doge/balance/${dogeAddr}`).then(r => r.json());
      if (dogeEl) dogeEl.textContent = 'DOGE: ' + satToDOGE(d.balance);
      if (twDogeEl) twDogeEl.textContent = satToDOGE(d.balance) + ' DOGE';
    } catch {}
  }
}

// ======================== Town Wallet Modal ========================
async function signAndSendDoge(wif, toAddress, amountDoge) {
  if (typeof DogeHTLC === 'undefined') throw new Error('doge-htlc not loaded');
  const amountSat = Math.round(Number(amountDoge) * 1e8);
  const fromAddress = DogeHTLC.wifToAddress(wif);
  const utxos = await api(`/doge/utxos/${fromAddress}`);
  if (!utxos || utxos.length === 0) throw new Error('No UTXOs (balance is 0)');
  const rawTx = DogeHTLC.buildSimpleTx(wif, toAddress, amountSat, utxos);
  const result = await api('/doge/broadcast', { body: { rawTx } });
  return { txid: result.txid };
}

function _townWalletMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'tw-msg ' + (type || '');
  el.classList.remove('hidden');
}

// town wallet 입력 필드 초기화 헬퍼
function _resetTownWalletInputs() {
  ['tw-btct-import-key','tw-doge-import-wif'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // 숨김 초기화
  ['tw-btct-nokey','tw-btct-send-box','tw-doge-nokey','tw-doge-none','tw-doge-send-box',
   'tw-btct-import','tw-doge-import','tw-btct-backup','tw-doge-backup',
   'tw-btct-gen-msg','tw-doge-gen-msg'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.add('hidden');
  });
}

async function openTownWallet() {
  const modal = document.getElementById('town-wallet-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  _resetTownWalletInputs();
  syncCurrentUser();

  const btctAddr = getActiveBtctAddr();
  const dogeAddr = getActiveDogeAddr();
  const hasBtctKey = btctAddr && !!getBtctKeyForAddr(btctAddr);
  const hasDogeWif = dogeAddr && !!getDogeWifForAddr(dogeAddr);

  // === BTCT switch dropdown ===
  _populateSwitchDropdown('tw-btct-switch', 'dex_btct_wallets', btctAddr, townSwitchBtct, true);

  // === DOGE switch dropdown ===
  _populateSwitchDropdown('tw-doge-switch', 'dex_doge_wallets', dogeAddr, townSwitchDoge, false);

  // BTCT 주소 표시
  const btctAddrEl = document.getElementById('tw-btct-addr');
  if (btctAddrEl) btctAddrEl.textContent = btctAddr ? '0x' + btctAddr : 'No wallet';

  // DOGE 주소 표시
  const dogeAddrEl = document.getElementById('tw-doge-addr');
  if (dogeAddrEl) dogeAddrEl.textContent = dogeAddr || 'No DOGE wallet';

  // Export 버튼 표시/숨김
  const btctExportBtn = document.getElementById('tw-btct-export-btn');
  if (btctExportBtn) btctExportBtn.style.display = hasBtctKey ? '' : 'none';
  const dogeExportBtn = document.getElementById('tw-doge-export-btn');
  if (dogeExportBtn) dogeExportBtn.style.display = hasDogeWif ? '' : 'none';

  // 송금 박스 / nokey 표시
  const btctSendBox = document.getElementById('tw-btct-send-box');
  const btctNoKey = document.getElementById('tw-btct-nokey');
  if (btctAddr) {
    if (hasBtctKey) {
      if (btctSendBox) btctSendBox.classList.remove('hidden');
      if (btctNoKey) btctNoKey.classList.add('hidden');
    } else {
      if (btctSendBox) btctSendBox.classList.add('hidden');
      if (btctNoKey) btctNoKey.classList.remove('hidden');
    }
  } else {
    if (btctSendBox) btctSendBox.classList.add('hidden');
    if (btctNoKey) btctNoKey.classList.remove('hidden');
  }

  const dogeSendBox = document.getElementById('tw-doge-send-box');
  const dogeNoKey = document.getElementById('tw-doge-nokey');
  const dogeNone = document.getElementById('tw-doge-none');
  if (!dogeAddr) {
    if (dogeSendBox) dogeSendBox.classList.add('hidden');
    if (dogeNoKey) dogeNoKey.classList.add('hidden');
    if (dogeNone) dogeNone.classList.remove('hidden');
  } else if (!hasDogeWif) {
    if (dogeSendBox) dogeSendBox.classList.add('hidden');
    if (dogeNone) dogeNone.classList.add('hidden');
    if (dogeNoKey) dogeNoKey.classList.remove('hidden');
  } else {
    if (dogeSendBox) dogeSendBox.classList.remove('hidden');
    if (dogeNoKey) dogeNoKey.classList.add('hidden');
    if (dogeNone) dogeNone.classList.add('hidden');
  }

  // 잔액 조회
  const btctBalEl = document.getElementById('tw-btct-bal');
  const dogeBalEl = document.getElementById('tw-doge-bal');
  if (btctBalEl) btctBalEl.textContent = 'Loading…';
  if (dogeBalEl) dogeBalEl.textContent = dogeAddr ? 'Loading…' : '--';

  if (btctAddr) {
    try {
      const b = await api(`/btct/balance/${btctAddr}`);
      if (btctBalEl) btctBalEl.textContent = satToBTCT(b.balance) + ' BTCT';
    } catch { if (btctBalEl) btctBalEl.textContent = '? BTCT'; }
  } else {
    if (btctBalEl) btctBalEl.textContent = '--';
  }

  if (dogeAddr) {
    try {
      const d = await api(`/doge/balance/${dogeAddr}`);
      if (dogeBalEl) dogeBalEl.textContent = satToDOGE(d.balance) + ' DOGE';
    } catch { if (dogeBalEl) dogeBalEl.textContent = '? DOGE'; }
  }
}

// === Switch dropdown helper ===
function _populateSwitchDropdown(containerId, storageKey, activeAddr, switchFn, isBtct) {
  const container = document.getElementById(containerId);
  if (!container) return;
  let wallets;
  try { wallets = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { wallets = {}; }
  const addrs = Object.keys(wallets);
  if (addrs.length <= 1) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = '';
  const sel = document.createElement('select');
  addrs.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = isBtct ? `0x${a.substring(0,6)}…${a.slice(-4)}` : `${a.substring(0,6)}…${a.slice(-4)}`;
    if (a === activeAddr) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => switchFn(sel.value);
  container.appendChild(sel);
}

function closeTownWallet() {
  const modal = document.getElementById('town-wallet-modal');
  if (modal) modal.classList.add('hidden');
}

// === BTCT wallet generate / import / export / switch ===
async function townGenBtct() {
  _townWalletMsg('tw-btct-gen-msg', 'Generating…', '');
  try {
    await ensureKrypton();
    const wallet = Krypton.Wallet.generate();
    const address = wallet.address.toHex().toLowerCase();
    const privateKeyHex = wallet.keyPair.privateKey.toHex();
    saveBtctWallet(address, privateKeyHex);
    setActiveBtctAddr(address);
    syncCurrentUser();
    _townWalletMsg('tw-btct-gen-msg', `✓ New wallet: 0x${address.substring(0,8)}…`, 'success');
    // Show backup key
    const backupEl = document.getElementById('tw-btct-backup');
    if (backupEl) {
      backupEl.innerHTML = `<strong style="color:#e94560;">⚠ BACKUP YOUR KEY NOW</strong><br>
        <span style="font-size:11px;word-break:break-all;user-select:all;">${privateKeyHex}</span>`;
      backupEl.classList.remove('hidden');
    }
    setTimeout(() => { openTownWallet(); updateWalletDisplayGlobal(); }, 1500);
  } catch (err) {
    _townWalletMsg('tw-btct-gen-msg', 'Failed: ' + err.message, 'error');
  }
}

function townToggleImportBtct() {
  const el = document.getElementById('tw-btct-import');
  if (el) el.classList.toggle('hidden');
}

async function townImportBtct() {
  let keyInput = (document.getElementById('tw-btct-import-key')?.value || '').trim();
  if (keyInput.startsWith('0x') || keyInput.startsWith('0X')) keyInput = keyInput.slice(2);
  if (!keyInput || keyInput.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyInput)) {
    return _townWalletMsg('tw-btct-gen-msg', 'Invalid: must be 64 hex characters', 'error');
  }
  _townWalletMsg('tw-btct-gen-msg', 'Importing…', '');
  try {
    await ensureKrypton();
    const wallet = Krypton.Wallet.importPrivateKey(keyInput);
    if (!wallet) throw new Error('Failed to import');
    const address = wallet.address.toHex().toLowerCase();
    saveBtctWallet(address, keyInput);
    setActiveBtctAddr(address);
    syncCurrentUser();
    _townWalletMsg('tw-btct-gen-msg', `✓ Imported: 0x${address.substring(0,8)}…`, 'success');
    setTimeout(() => { openTownWallet(); updateWalletDisplayGlobal(); }, 1200);
  } catch (err) {
    _townWalletMsg('tw-btct-gen-msg', 'Import failed: ' + err.message, 'error');
  }
}

function townExportBtct() {
  const addr = getActiveBtctAddr();
  const key = addr ? getBtctKeyForAddr(addr) : null;
  if (!key) return _townWalletMsg('tw-btct-gen-msg', 'No private key for active wallet', 'error');
  const backupEl = document.getElementById('tw-btct-backup');
  if (!backupEl) return;
  if (!backupEl.classList.contains('hidden')) { backupEl.classList.add('hidden'); return; }
  backupEl.innerHTML = `<strong>Private Key:</strong><br>
    <span style="font-size:11px;word-break:break-all;user-select:all;">${key}</span>`;
  backupEl.classList.remove('hidden');
}

function townSwitchBtct(addr) {
  setActiveBtctAddr(addr);
  syncCurrentUser();
  openTownWallet();
  updateWalletDisplayGlobal();
}

// === DOGE wallet generate / import / export / switch ===
async function townGenDoge() {
  _townWalletMsg('tw-doge-gen-msg', 'Generating…', '');
  try {
    const result = await api('/doge/generate', { method: 'POST' });
    saveDogeWallet(result.address, result.wif);
    setActiveDogeAddr(result.address);
    syncCurrentUser();
    _townWalletMsg('tw-doge-gen-msg', `✓ New wallet: ${result.address.substring(0,8)}…`, 'success');
    const backupEl = document.getElementById('tw-doge-backup');
    if (backupEl) {
      backupEl.innerHTML = `<strong style="color:#e94560;">⚠ BACKUP YOUR WIF NOW</strong><br>
        <span style="font-size:11px;word-break:break-all;user-select:all;">${result.wif}</span>`;
      backupEl.classList.remove('hidden');
    }
    setTimeout(() => { openTownWallet(); updateWalletDisplayGlobal(); }, 1500);
  } catch (err) {
    _townWalletMsg('tw-doge-gen-msg', 'Failed: ' + err.message, 'error');
  }
}

function townToggleImportDoge() {
  const el = document.getElementById('tw-doge-import');
  if (el) el.classList.toggle('hidden');
}

async function townImportDoge() {
  const wif = (document.getElementById('tw-doge-import-wif')?.value || '').trim();
  if (!wif) return _townWalletMsg('tw-doge-gen-msg', 'Enter WIF private key', 'error');
  _townWalletMsg('tw-doge-gen-msg', 'Importing…', '');
  try {
    const result = await api('/doge/import', { body: { wif } });
    saveDogeWallet(result.address, wif);
    setActiveDogeAddr(result.address);
    syncCurrentUser();
    _townWalletMsg('tw-doge-gen-msg', `✓ Imported: ${result.address.substring(0,8)}…`, 'success');
    setTimeout(() => { openTownWallet(); updateWalletDisplayGlobal(); }, 1200);
  } catch (err) {
    _townWalletMsg('tw-doge-gen-msg', 'Import failed: ' + err.message, 'error');
  }
}

function townExportDoge() {
  const addr = getActiveDogeAddr();
  const wif = addr ? getDogeWifForAddr(addr) : null;
  if (!wif) return _townWalletMsg('tw-doge-gen-msg', 'No WIF for active wallet', 'error');
  const backupEl = document.getElementById('tw-doge-backup');
  if (!backupEl) return;
  if (!backupEl.classList.contains('hidden')) { backupEl.classList.add('hidden'); return; }
  backupEl.innerHTML = `<strong>WIF Private Key:</strong><br>
    <span style="font-size:11px;word-break:break-all;user-select:all;">${wif}</span>`;
  backupEl.classList.remove('hidden');
}

function townSwitchDoge(addr) {
  setActiveDogeAddr(addr);
  syncCurrentUser();
  openTownWallet();
  updateWalletDisplayGlobal();
}

// Helper: update top bar wallet display from anywhere
function updateWalletDisplayGlobal() {
  if (game && game.scene && game.scene.scenes) {
    const mainScene = game.scene.scenes.find(s => s.updateWalletDisplay);
    if (mainScene) mainScene.updateWalletDisplay();
  }
}

function saveBtctWallet(address, key) {
  const addr = (address || '').replace(/^0x/, '').toLowerCase();
  try {
    const wallets = JSON.parse(localStorage.getItem('dex_btct_wallets') || '{}');
    wallets[addr] = key;
    localStorage.setItem('dex_btct_wallets', JSON.stringify(wallets));
  } catch {}
}

function saveDogeWallet(address, wif) {
  try {
    const wallets = JSON.parse(localStorage.getItem('dex_doge_wallets') || '{}');
    wallets[address] = wif;
    localStorage.setItem('dex_doge_wallets', JSON.stringify(wallets));
  } catch {}
}

function setActiveBtctAddr(addr) {
  localStorage.setItem('dex_active_btct', (addr || '').replace(/^0x/, '').toLowerCase());
}

function setActiveDogeAddr(addr) {
  localStorage.setItem('dex_active_doge', addr || '');
}

async function townWalletSendBtct() {
  const activeBtct = getActiveBtctAddr();
  const key = getBtctKeyForAddr(activeBtct);
  if (!key) return _townWalletMsg('tw-btct-msg', 'No private key', 'error');

  const toAddr = (document.getElementById('tw-btct-to')?.value || '').trim();
  const amount = (document.getElementById('tw-btct-amount')?.value || '').trim();
  if (!toAddr) return _townWalletMsg('tw-btct-msg', 'Enter recipient address', 'error');
  if (!amount || Number(amount) <= 0) return _townWalletMsg('tw-btct-msg', 'Enter valid amount', 'error');
  if (!confirm(`Send ${amount} BTCT to ${toAddr}?\nFee: 0.00001 BTCT`)) return;

  _townWalletMsg('tw-btct-msg', 'Sending…', '');
  try {
    const { height: blockNumber } = await api('/btct/block');
    await ensureKrypton();
    const privKey = Krypton.PrivateKey.unserialize(Krypton.BufferUtils.fromHex(key));
    const keyPair = Krypton.KeyPair.derive(privKey);
    const senderAddr = keyPair.publicKey.toAddress();
    const recipientAddr = Krypton.Address.fromHex(toAddr.replace(/^0x/, ''));
    const valueSat = btctToSat(amount);
    const tx = new Krypton.ExtendedTransaction(
      senderAddr, Krypton.Account.Type.BASIC,
      recipientAddr, Krypton.Account.Type.BASIC,
      Number(valueSat), blockNumber + 1,
      Krypton.Transaction.Flag.NONE, new Uint8Array(0)
    );
    const signature = Krypton.Signature.create(keyPair.privateKey, keyPair.publicKey, tx.serializeContent());
    tx.proof = Krypton.SignatureProof.singleSig(keyPair.publicKey, signature).serialize();
    const txHex = Krypton.BufferUtils.toHex(tx.serialize());
    const result = await api('/btct/broadcast', { body: { txHex } });

    _townWalletMsg('tw-btct-msg', `✓ Sent! Tx: ${result.hash}`, 'success');
    if (document.getElementById('tw-btct-to')) document.getElementById('tw-btct-to').value = '';
    if (document.getElementById('tw-btct-amount')) document.getElementById('tw-btct-amount').value = '';
    // 잔액 갱신
    setTimeout(() => openTownWallet(), 2000);
  } catch (err) {
    _townWalletMsg('tw-btct-msg', err.message, 'error');
  }
}

async function townWalletSendDoge() {
  const dogeAddr = getActiveDogeAddr();
  const wif = getDogeWifForAddr(dogeAddr);
  if (!wif) return _townWalletMsg('tw-doge-msg', 'No private key', 'error');

  const toAddr = (document.getElementById('tw-doge-to')?.value || '').trim();
  const amount = (document.getElementById('tw-doge-amount')?.value || '').trim();
  if (!toAddr) return _townWalletMsg('tw-doge-msg', 'Enter recipient address', 'error');
  if (!amount || Number(amount) <= 0) return _townWalletMsg('tw-doge-msg', 'Enter valid amount', 'error');
  if (!confirm(`Send ${amount} DOGE to ${toAddr}?\nFee: ~0.02 DOGE`)) return;

  _townWalletMsg('tw-doge-msg', 'Sending…', '');
  try {
    const result = await signAndSendDoge(wif, toAddr, Number(amount));
    _townWalletMsg('tw-doge-msg', `✓ Sent! Tx: ${result.txid}`, 'success');
    if (document.getElementById('tw-doge-to')) document.getElementById('tw-doge-to').value = '';
    if (document.getElementById('tw-doge-amount')) document.getElementById('tw-doge-amount').value = '';
    setTimeout(() => openTownWallet(), 2000);
  } catch (err) {
    _townWalletMsg('tw-doge-msg', err.message, 'error');
  }
}

// ======================== Emoji System ========================
function toggleEmojiBar() {
  const bar = document.getElementById('emoji-bar');
  if (bar) bar.classList.toggle('hidden');
}

function sendTownEmoji(emoji) {
  if (socket) socket.emit('townEmoji', { emoji });
  // Show locally on self immediately
  if (game && game.scene && game.scene.scenes) {
    const scene = game.scene.scenes.find(s => s.showEmojiBubble);
    if (scene) scene.showEmojiBubble(null, getActiveBtctAddr(), emoji);
  }
  // Auto-hide emoji bar after picking
  const bar = document.getElementById('emoji-bar');
  if (bar) bar.classList.add('hidden');
}

// Wave at a player from profile modal
function townSendEmoji(targetAddr) {
  sendTownEmoji('👋');
  closeModal();
}

// ======================== Character Customizer ========================

const CHAR_CONFIG_KEY = 'town_character';

// Default config
const DEFAULT_CHAR_CONFIG = { type: 0, skin: 0, cloth: 0, hair: 0, hat: 0, glasses: 0 };

function loadCharConfig() {
  try {
    const raw = localStorage.getItem(CHAR_CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      return Object.assign({}, DEFAULT_CHAR_CONFIG, cfg);
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_CHAR_CONFIG);
}

function saveCharConfigToStorage(config) {
  try { localStorage.setItem(CHAR_CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
}

// Pending config (edited in modal, not yet applied)
let pendingCharConfig = null;

function openCharModal() {
  pendingCharConfig = Object.assign({}, loadCharConfig());
  _syncCharModalUI(pendingCharConfig);
  updateCharPreview(pendingCharConfig);
  const m = document.getElementById('char-modal');
  if (m) m.classList.remove('hidden');
}

function closeCharModal() {
  const m = document.getElementById('char-modal');
  if (m) m.classList.add('hidden');
  pendingCharConfig = null;
}

function _syncCharModalUI(config) {
  // Sync active classes for all groups
  const groups = {
    type: 'char-type-opts',
    skin: 'char-skin-opts',
    cloth: 'char-cloth-opts',
    hair: 'char-hair-opts',
    hat: 'char-hat-opts',
    glasses: 'char-glasses-opts',
  };
  for (const [prop, containerId] of Object.entries(groups)) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.querySelectorAll('[data-val]').forEach(btn => {
      const val = parseInt(btn.getAttribute('data-val'), 10);
      btn.classList.toggle('active', val === (config[prop] || 0));
    });
  }
}

function setCharOpt(prop, val) {
  if (!pendingCharConfig) pendingCharConfig = loadCharConfig();
  pendingCharConfig[prop] = val;
  _syncCharModalUI(pendingCharConfig);
  updateCharPreview(pendingCharConfig);
}

// Draw front-facing idle frame onto a canvas for preview
function _drawCharFrame(ctx, config, ox, oy) {
  const SKIN_C = ['#f0c987','#fad5c0','#c4885a','#8b5e3c','#5c3d1e','#e8b89a'];
  const SKIN_D = ['#d4a96a','#e4c090','#a96e40','#6e4424','#3d2410','#c8956f'];
  const CLTH_C = ['#3498db','#c0392b','#27ae60','#8e44ad','#e67e22','#7f8c8d'];
  const CLTH_D = ['#2175a9','#962d22','#1e8449','#6e3585','#c05c1a','#626d6d'];
  const HAIR_C = ['#5a3620','#1a1a1a','#f6c90e','#c0392b','#bdc3c7'];

  const skin  = SKIN_C[config.skin  ?? 0] || SKIN_C[0];
  const skinD = SKIN_D[config.skin  ?? 0] || SKIN_D[0];
  const clth  = CLTH_C[config.cloth ?? 0] || CLTH_C[0];
  const clthD = CLTH_D[config.cloth ?? 0] || CLTH_D[0];
  const hair  = HAIR_C[config.hair  ?? 0] || HAIR_C[0];
  const type  = config.type || 0;
  const dir   = 0; // front
  const frame = 0; // idle

  ctx.save();
  ctx.translate(ox, oy);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(12, 30, 7, 3, 0, 0, Math.PI * 2); ctx.fill();

  // Legs
  const legC = type===1?'#7f8c8d':type===2?'#6c3483':type===3?'#2c3e50':'#34495e';
  const legD = type===1?'#626d6d':type===2?'#4a235a':type===3?'#1a252f':'#2c3e50';
  ctx.fillStyle = legC;
  ctx.fillRect(8, 24, 4, 6); ctx.fillRect(12, 24, 4, 6);
  ctx.fillStyle = legD;
  ctx.fillRect(7, 29, 5, 2); ctx.fillRect(12, 29, 5, 2);

  // Body
  if (type === 1) {
    ctx.fillStyle = '#7f8c8d'; ctx.fillRect(7, 14, 10, 11);
    ctx.fillStyle = '#bdc3c7'; ctx.fillRect(8, 15, 8, 2); ctx.fillRect(10, 17, 4, 7);
    ctx.fillStyle = '#626d6d'; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 15, 2, 9);
  } else if (type === 2) {
    ctx.fillStyle = clth; ctx.fillRect(6, 14, 12, 11);
    ctx.fillStyle = clthD; ctx.fillRect(6, 14, 12, 1); ctx.fillRect(11, 15, 2, 9);
    ctx.fillStyle = 'rgba(255,255,200,0.7)';
    ctx.fillRect(8,17,1,1); ctx.fillRect(15,19,1,1); ctx.fillRect(10,21,1,1);
  } else if (type === 3) {
    ctx.fillStyle = '#7d6544'; ctx.fillRect(7, 14, 10, 11);
    ctx.fillStyle = '#5d4a2e'; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 14, 2, 11);
    ctx.fillStyle = '#c0a060'; ctx.fillRect(7, 22, 10, 2);
  } else {
    ctx.fillStyle = clth; ctx.fillRect(7, 14, 10, 11);
    ctx.fillStyle = clthD; ctx.fillRect(7, 14, 10, 1); ctx.fillRect(11, 15, 2, 9);
  }

  // Arms
  const armC = type===1?'#7f8c8d':type===3?'#7d6544':clth;
  ctx.fillStyle = armC;
  ctx.fillRect(4, 15, 3, 8); ctx.fillRect(17, 15, 3, 8);
  ctx.fillStyle = skin;
  ctx.fillRect(4, 22, 3, 2); ctx.fillRect(17, 22, 3, 2);
  if (type === 1) {
    ctx.fillStyle = '#bdc3c7';
    ctx.fillRect(3, 14, 4, 3); ctx.fillRect(17, 14, 4, 3);
  }

  // Head
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(12, 9, 7, 0, Math.PI * 2); ctx.fill();

  // Hair
  ctx.fillStyle = hair;
  ctx.beginPath(); ctx.arc(12, 7, 7, Math.PI, 2 * Math.PI); ctx.fill();
  ctx.fillRect(5, 5, 14, 3);
  ctx.fillRect(7, 4, 4, 3);

  // Eyes (front)
  ctx.fillStyle = '#fff';
  ctx.fillRect(8, 8, 3, 3); ctx.fillRect(13, 8, 3, 3);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(9, 9, 2, 2); ctx.fillRect(14, 9, 2, 2);

  // Hat
  const hatH = config.hat || 0;
  if (hatH === 1) {
    ctx.fillStyle = clth; ctx.fillRect(5, 3, 14, 3); ctx.fillRect(7, 1, 10, 3);
    ctx.fillStyle = clthD; ctx.fillRect(5, 5, 14, 1);
    ctx.fillStyle = clth; ctx.fillRect(17, 4, 4, 2);
  } else if (hatH === 2) {
    ctx.fillStyle = clth;
    ctx.beginPath(); ctx.moveTo(12, -5); ctx.lineTo(7, 4); ctx.lineTo(17, 4); ctx.closePath(); ctx.fill();
    ctx.fillRect(5, 3, 14, 3);
    ctx.fillStyle = '#f6c90e'; ctx.fillRect(6, 5, 12, 1);
  } else if (hatH === 3) {
    ctx.fillStyle = '#c0392b'; ctx.fillRect(5, 3, 14, 4);
    ctx.fillStyle = '#922b21'; ctx.fillRect(5, 6, 14, 1);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(5, 3, 3, 2);
  } else if (hatH === 4) {
    ctx.fillStyle = '#f6c90e'; ctx.fillRect(5, 3, 14, 3);
    ctx.fillRect(6, 1, 2, 3); ctx.fillRect(11, 0, 2, 3); ctx.fillRect(16, 1, 2, 3);
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(7, 3, 2, 2); ctx.fillRect(12, 3, 2, 2); ctx.fillRect(17, 3, 2, 2);
  }

  // Glasses
  const glassT = config.glasses || 0;
  if (glassT === 1) {
    ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 1;
    ctx.strokeRect(8, 8, 3, 3); ctx.strokeRect(13, 8, 3, 3);
    ctx.beginPath(); ctx.moveTo(11, 9); ctx.lineTo(13, 9); ctx.stroke();
  } else if (glassT === 2) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(8, 8, 3, 2); ctx.fillRect(13, 8, 3, 2);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(11, 8, 2, 1);
  }

  ctx.restore();
}

function updateCharPreview(config) {
  const canvas = document.getElementById('char-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 24, 32);
  _drawCharFrame(ctx, config || loadCharConfig(), 0, 0);
}

function saveCharacter() {
  if (!pendingCharConfig) return;
  const config = Object.assign({}, pendingCharConfig);
  saveCharConfigToStorage(config);

  // Apply to live player sprite
  if (townScene && townScene.player) {
    try {
      const newKey = getOrCreateCharTexture(townScene, config);
      townScene.player.setTexture(newKey, 0);
      townScene.myCharConfig = config;
    } catch (e) { console.warn('[Char] apply texture error:', e); }
  }

  // Broadcast to other players
  if (socket) {
    socket.emit('townCharUpdate', { character: config });
  }

  closeCharModal();
  townShowToast('🎨 Character saved!', 2500);
}
