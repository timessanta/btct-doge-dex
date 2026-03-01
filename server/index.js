// DEX Server — Decentralized Exchange (bulletin board + blockchain reader)
// Server NEVER holds private keys, NEVER custodies funds
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initDB } = require('./db');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3020;

// Trust reverse proxy (time VM) to get real client IP via X-Forwarded-For
app.set('trust proxy', true);

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// API
app.use('/api', apiRoutes);

// SPA fallback — serve town.html for /town, privacy.html for /privacy, index.html for everything else
app.get('/town', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'town.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.get('/privacy-ko', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy-ko.html'));
});
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about.html'));
});
app.get('/about-ko', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about-ko.html'));
});
app.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'guide.html'));
});
app.get('/guide-ko', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'guide-ko.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ===================== SOCKET.IO (Chat + Trade Updates + Town) =====================

// Town multiplayer state
const townPlayers = {};

// Share io and townPlayers with routes (for ad bubble updates)
app.set('io', io);
app.set('townPlayers', townPlayers);

// Helper: generate ad bubble text from DB
async function getAdBubbleText(address) {
  try {
    const { pool } = require('./db');
    const { rows } = await pool.query(
      `SELECT type, price FROM trade_ads WHERE btct_address = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [address]
    );
    if (rows.length === 0) return null;
    const ad = rows[0];
    const emoji = ad.type === 'sell' ? '📦' : '🛒';
    return `${emoji} ${ad.type.toUpperCase()} @ ${Number(ad.price).toFixed(2)} DOGE`;
  } catch (e) {
    return null;
  }
}
app.set('getAdBubbleText', getAdBubbleText);

// ===================== PvP DUEL LOGIC =====================

// In-memory pending duel requests (15s timeout)
const pendingDuels = new Map();

function simulateDuel(cStats, dStats) {
  // cStats/dStats: { atk, def, max_hp } from DB
  const rounds = [];
  let cWins = 0, dWins = 0;

  for (let r = 0; r < 3; r++) {
    if (cWins === 2 || dWins === 2) break;

    let cHp = cStats.max_hp;
    let dHp = dStats.max_hp;
    const log = [];
    // 선공 랜덤
    let turn = Math.random() < 0.5 ? 'c' : 'd';
    let swings = 0;

    while (cHp > 0 && dHp > 0 && swings < 60) {
      if (turn === 'c') {
        const crit = Math.random() < 0.05;
        let dmg = Math.max(1, cStats.atk - Math.floor(dStats.def * 0.5));
        if (crit) dmg = Math.round(dmg * 1.5);
        dHp -= dmg;
        log.push({ attacker: 'c', dmg, crit, cHp: Math.max(0, cHp), dHp: Math.max(0, dHp) });
        turn = 'd';
      } else {
        const crit = Math.random() < 0.05;
        let dmg = Math.max(1, dStats.atk - Math.floor(cStats.def * 0.5));
        if (crit) dmg = Math.round(dmg * 1.5);
        cHp -= dmg;
        log.push({ attacker: 'd', dmg, crit, cHp: Math.max(0, cHp), dHp: Math.max(0, dHp) });
        turn = 'c';
      }
      swings++;
    }

    // 라운드 승자 (HP 더 많이 남은 쪽, 동점이면 랜덤)
    let roundWinner;
    if (cHp > dHp) roundWinner = 'c';
    else if (dHp > cHp) roundWinner = 'd';
    else roundWinner = Math.random() < 0.5 ? 'c' : 'd';

    if (roundWinner === 'c') cWins++;
    else dWins++;

    rounds.push({ round: r + 1, cStartHp: cStats.max_hp, dStartHp: dStats.max_hp, log, roundWinner, cHp: Math.max(0, cHp), dHp: Math.max(0, dHp), cWins, dWins });
  }

  return { winner: cWins >= 2 ? 'challenger' : 'defender', rounds };
}

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

  // ---- BTCT Town Events ----
  socket.on('townJoin', async (data) => {
    const addr = (data.address || '').replace(/^0x/, '').toLowerCase();

    // Check for active ads
    const adText = await getAdBubbleText(addr);

    townPlayers[socket.id] = {
      id: socket.id,
      address: addr,
      x: data.x || 480,
      y: data.y || 480,
      adText: adText || null,
      character: data.character || {},
    };

    // Send all current players to new player
    socket.emit('townPlayers', townPlayers);

    // Notify others
    socket.broadcast.emit('townPlayerJoined', {
      ...townPlayers[socket.id],
      totalPlayers: Object.keys(townPlayers).length,
    });
  });

  socket.on('townMove', (data) => {
    if (townPlayers[socket.id]) {
      townPlayers[socket.id].x = data.x;
      townPlayers[socket.id].y = data.y;
      socket.broadcast.emit('townPlayerMoved', {
        id: socket.id,
        x: data.x,
        y: data.y,
        dir: data.dir,
      });
    }
  });

  socket.on('townCharUpdate', (data) => {
    if (!townPlayers[socket.id]) return;
    const char = data.character || {};
    // Basic validation — only allow small plain objects
    if (typeof char === 'object' && !Array.isArray(char)) {
      townPlayers[socket.id].character = char;
      socket.broadcast.emit('townCharUpdate', {
        id: socket.id,
        character: char,
      });
    }
  });

  // ---- Town Global Chat ----
  socket.on('townChat', (data) => {
    if (!townPlayers[socket.id]) return;
    const content = (data.content || '').substring(0, 200).trim();
    if (!content) return;
    if (containsBlockedKeyword(content)) {
      socket.emit('chatError', { error: 'Message blocked: contains prohibited content.' });
      return;
    }
    const player = townPlayers[socket.id];
    io.emit('townChatMsg', {
      address: player.address,
      content,
      time: Date.now()
    });
  });

  // ---- Town Emoji ----
  socket.on('townEmoji', (data) => {
    if (!townPlayers[socket.id]) return;
    const emoji = (data.emoji || '').substring(0, 4);
    if (!emoji) return;
    const player = townPlayers[socket.id];
    socket.broadcast.emit('townEmojiMsg', {
      id: socket.id,
      address: player.address,
      emoji,
    });
  });

  // ---- Town Wave (1:1) ----
  socket.on('townWave', (data) => {
    if (!townPlayers[socket.id]) return;
    const targetAddr = (data.targetAddr || '').replace(/^0x/, '').toLowerCase();
    if (!targetAddr) return;
    const sender = townPlayers[socket.id];
    // Find target socket
    const targetSocketId = Object.keys(townPlayers).find(sid => townPlayers[sid].address === targetAddr);
    if (targetSocketId) {
      io.to(targetSocketId).emit('townWaveReceived', {
        id: socket.id,
        address: sender.address,
        emoji: '👋',
      });
    }
  });

  // ---- Chat & Trade Events ----

  // Register address room for personal notifications
  socket.on('registerAddress', (data) => {
    const addr = (data && data.address || '').replace(/^0x/, '').toLowerCase();
    if (addr && addr.length === 40) {
      socket.join(`addr:${addr}`);
    }
  });

  socket.on('joinTrade', (tradeId) => {
    socket.join(`trade:${tradeId}`);
  });

  socket.on('leaveTrade', (tradeId) => {
    socket.leave(`trade:${tradeId}`);
  });

  // Chat keyword filter (illegal content prevention)
  const BLOCKED_KEYWORDS = [
    '마약', '대마', '메스', '필로폰', 'meth', 'cocaine', 'heroin', 'fentanyl',
    '총기', '권총', 'firearm', 'gun sale',
    '아동', 'child porn', 'cp ', 'csam',
    '랜섬웨어', 'ransomware', '해킹대행',
    '자금세탁', 'money launder'
  ];

  function containsBlockedKeyword(text) {
    const lower = text.toLowerCase();
    return BLOCKED_KEYWORDS.some(kw => lower.includes(kw));
  }

  socket.on('chatMessage', async (data) => {
    const { tradeId, senderAddress, content } = data;
    if (!tradeId || !senderAddress || !content) return;

    // Keyword filter
    if (containsBlockedKeyword(content)) {
      socket.emit('chatError', { error: 'Message blocked: contains prohibited content.' });
      console.warn(`[Chat] Blocked message from ${senderAddress} in trade ${tradeId}`);
      return;
    }

    const addr = senderAddress.replace(/^0x/, '').toLowerCase();
    try {
      const { pool } = require('./db');

      // Verify sender is participant
      const { rows: [trade] } = await pool.query(
        `SELECT * FROM trades WHERE id = $1 AND (seller_address = $2 OR buyer_address = $2)`,
        [tradeId, addr]
      );
      if (!trade) return;

      // Save message
      const { rows: [msg] } = await pool.query(
        `INSERT INTO messages (trade_id, sender_address, content) VALUES ($1, $2, $3) RETURNING *`,
        [tradeId, addr, content.substring(0, 500)]
      );

      io.to(`trade:${tradeId}`).emit('newMessage', msg);
    } catch (e) {
      console.error('[Chat] Error:', e.message);
    }
  });

  // Trade status update notifications
  socket.on('tradeUpdate', (data) => {
    const { tradeId, status, detail } = data;
    if (tradeId) {
      io.to(`trade:${tradeId}`).emit('tradeStatusUpdate', { tradeId, status, detail });
    }
  });

  // ---- PvP Duel Events ----
  socket.on('townDuelRequest', async ({ defenderAddr, betAmount }) => {
    try {
      const challengerPlayer = townPlayers[socket.id];
      if (!challengerPlayer) return;
      const challengerAddr = challengerPlayer.address;
      if (!challengerAddr || challengerAddr === defenderAddr) return;

      betAmount = Math.max(0, Math.min(1000, parseInt(betAmount) || 0));

      // Find defender socket
      const defSocket = Object.entries(townPlayers).find(([, p]) => p.address === defenderAddr);
      if (!defSocket) {
        socket.emit('townDuelError', { msg: 'That player has left the town.' });
        return;
      }

      // PvP cooldown: same pair within 5 min
      const { pool } = require('./db');
      const coolRow = await pool.query(
        `SELECT id FROM town_duels WHERE ((challenger=$1 AND defender=$2) OR (challenger=$2 AND defender=$1))
         AND created_at > NOW() - INTERVAL '1 minute' AND status != 'pending' LIMIT 1`,
        [challengerAddr, defenderAddr]
      );
      if (coolRow.rows.length > 0) {
        socket.emit('townDuelError', { msg: 'You can only duel the same player once every 1 minute.' });
        return;
      }

      // BET: challenger must have enough BIT
      if (betAmount > 0) {
        const bitRow = await pool.query('SELECT bit_balance FROM town_players WHERE btct_address=$1', [challengerAddr]);
        if (!bitRow.rows.length || Number(bitRow.rows[0].bit_balance) < betAmount) {
          socket.emit('townDuelError', { msg: `Not enough BIT to bet ${betAmount}.` });
          return;
        }
      }

      const requestId = `duel_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      pendingDuels.set(requestId, {
        challengerSid: socket.id,
        defenderSid: defSocket[0],
        challengerAddr,
        defenderAddr,
        betAmount,
        timeout: setTimeout(() => {
          if (pendingDuels.has(requestId)) {
            pendingDuels.delete(requestId);
            socket.emit('townDuelTimeout', { msg: 'Duel request timed out.' });
          }
        }, 15000)
      });

      io.to(defSocket[0]).emit('townDuelChallenge', {
        requestId,
        challengerAddr,
        betAmount,
      });
    } catch (e) {
      console.error('[Duel] request error:', e.message);
    }
  });

  socket.on('townDuelAccept', async ({ requestId }) => {
    try {
      const req = pendingDuels.get(requestId);
      if (!req) {
        socket.emit('townDuelError', { msg: 'Duel request expired.' });
        return;
      }
      clearTimeout(req.timeout);
      pendingDuels.delete(requestId);

      const { pool } = require('./db');

      // Fetch both players' stats
      const [cRow, dRow] = await Promise.all([
        pool.query('SELECT * FROM town_players WHERE btct_address=$1', [req.challengerAddr]),
        pool.query('SELECT * FROM town_players WHERE btct_address=$1', [req.defenderAddr]),
      ]);
      if (!cRow.rows.length || !dRow.rows.length) {
        io.to(req.challengerSid).emit('townDuelError', { msg: 'Player data not found.' });
        return;
      }

      const cStats = cRow.rows[0];
      const dStats = dRow.rows[0];

      // BET: deduct from both if bet > 0
      if (req.betAmount > 0) {
        const dBit = await pool.query('SELECT bit_balance FROM town_players WHERE btct_address=$1', [req.defenderAddr]);
        if (!dBit.rows.length || Number(dBit.rows[0].bit_balance) < req.betAmount) {
          io.to(req.challengerSid).emit('townDuelError', { msg: 'Opponent does not have enough BIT for the bet.' });
          io.to(req.defenderSid).emit('townDuelError', { msg: 'You do not have enough BIT for the bet.' });
          return;
        }
        await pool.query('UPDATE town_players SET bit_balance = bit_balance - $1 WHERE btct_address=$2', [req.betAmount, req.challengerAddr]);
        await pool.query('UPDATE town_players SET bit_balance = bit_balance - $1 WHERE btct_address=$2', [req.betAmount, req.defenderAddr]);
      }

      // === 3-round best-of-3 battle ===
      const result = simulateDuel(cStats, dStats);

      const winnerAddr = result.winner === 'challenger' ? req.challengerAddr : req.defenderAddr;
      const loserAddr  = result.winner === 'challenger' ? req.defenderAddr : req.challengerAddr;
      const winnerSid  = result.winner === 'challenger' ? req.challengerSid : req.defenderSid;
      const loserSid   = result.winner === 'challenger' ? req.defenderSid : req.challengerSid;

      // Rewards
      const BASE_BIT_WIN = 30;
      const BASE_EXP_WIN = 20;
      const BASE_EXP_LOSE = 8;
      const totalBitWin = BASE_BIT_WIN + req.betAmount * 2;

      await pool.query(
        `UPDATE town_players SET
           bit_balance = bit_balance + $1,
           exp = exp + $2,
           level = GREATEST(level, floor((exp + $2) / 100)::int + 1),
           max_hp = 100 + (GREATEST(level, floor((exp + $2) / 100)::int + 1) - 1) * 10,
           atk = 10 + (GREATEST(level, floor((exp + $2) / 100)::int + 1) - 1) * 2
         WHERE btct_address=$3`,
        [totalBitWin, BASE_EXP_WIN, winnerAddr]
      );
      await pool.query(
        `UPDATE town_players SET
           exp = exp + $1,
           level = GREATEST(level, floor((exp + $1) / 100)::int + 1),
           max_hp = 100 + (GREATEST(level, floor((exp + $1) / 100)::int + 1) - 1) * 10,
           atk = 10 + (GREATEST(level, floor((exp + $1) / 100)::int + 1) - 1) * 2
         WHERE btct_address=$2`,
        [BASE_EXP_LOSE, loserAddr]
      );

      // Save to DB
      await pool.query(
        `INSERT INTO town_duels (challenger, defender, winner, rounds_log, bet_amount, base_reward_bit, base_reward_exp, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed')`,
        [req.challengerAddr, req.defenderAddr, winnerAddr, JSON.stringify(result.rounds), req.betAmount, BASE_BIT_WIN, BASE_EXP_WIN]
      );

      const payload = {
        rounds: result.rounds,
        winner: winnerAddr,
        loser: loserAddr,
        challengerAddr: req.challengerAddr,
        defenderAddr: req.defenderAddr,
        betAmount: req.betAmount,
        winnerBit: totalBitWin,
        winnerExp: BASE_EXP_WIN,
        loserExp: BASE_EXP_LOSE,
      };

      io.to(winnerSid).emit('townDuelResult', { ...payload, youWon: true });
      io.to(loserSid).emit('townDuelResult', { ...payload, youWon: false });

    } catch (e) {
      console.error('[Duel] accept error:', e.message);
    }
  });

  socket.on('townDuelReject', ({ requestId }) => {
    const req = pendingDuels.get(requestId);
    if (!req) return;
    clearTimeout(req.timeout);
    pendingDuels.delete(requestId);
    io.to(req.challengerSid).emit('townDuelRejected', { defenderAddr: req.defenderAddr });
  });

  // ---- Disconnect cleanup ----
  socket.on('disconnect', () => {
    // Cancel any pending duels involving this socket
    for (const [id, req] of pendingDuels.entries()) {
      if (req.challengerSid === socket.id || req.defenderSid === socket.id) {
        clearTimeout(req.timeout);
        pendingDuels.delete(id);
        const otherSid = req.challengerSid === socket.id ? req.defenderSid : req.challengerSid;
        io.to(otherSid).emit('townDuelError', { msg: 'Opponent disconnected.' });
      }
    }
    if (townPlayers[socket.id]) {
      delete townPlayers[socket.id];
      io.emit('townPlayerLeft', {
        id: socket.id,
        totalPlayers: Object.keys(townPlayers).length,
      });
    }
  });
});

// ===================== STARTUP =====================

// Auto-expire trades when HTLC timeout passes (runs every 5 min)
function scheduleExpiredTradeCleanup() {
  const INTERVAL = 5 * 60 * 1000; // 5 minutes

  async function checkExpired() {
    try {
      const { pool } = require('./db');

      // 1) BTCT timeout: btct_locked + btct_timeout <= current block
      let currentBlock = 0;
      try {
        const { getBlockNumber } = require('./btctRpc');
        currentBlock = await getBlockNumber();
      } catch (e) {
        // fallback: http module (no external deps)
        const http = require('http');
        currentBlock = await new Promise((resolve) => {
          const data = JSON.stringify({ jsonrpc: '2.0', method: 'blockNumber', params: [], id: 1 });
          const req = http.request(
            { hostname: '127.0.0.1', port: 12211, path: '/', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            },
            (res) => {
              let body = '';
              res.on('data', d => body += d);
              res.on('end', () => { try { resolve(JSON.parse(body).result || 0); } catch { resolve(0); } });
            }
          );
          req.on('error', () => resolve(0));
          req.write(data); req.end();
        });
      }

      if (currentBlock > 0) {
        const { rows: btctExpired } = await pool.query(
          `UPDATE trades SET status = 'expired'
           WHERE status = 'btct_locked' AND btct_timeout IS NOT NULL AND btct_timeout <= $1
           RETURNING id, seller_address, buyer_address`,
          [currentBlock]
        );
        for (const t of btctExpired) {
          console.log(`[Expire] Trade #${t.id} expired (btct_locked, block ${currentBlock} >= ${t.btct_timeout || '?'})`);
          io.to(`trade:${t.id}`).emit('tradeStatusUpdate', { tradeId: t.id, status: 'expired' });
          io.to(`addr:${t.seller_address}`).emit('tradeNotification', { tradeId: t.id, type: 'expired', message: `Trade #${t.id} expired — BTCT refund available` });
          io.to(`addr:${t.buyer_address}`).emit('tradeNotification', { tradeId: t.id, type: 'expired', message: `Trade #${t.id} expired` });
        }
      }

      // 2) DOGE timeout: doge_locked + doge_timeout <= now (unix timestamp)
      const nowSec = Math.floor(Date.now() / 1000);
      const { rows: dogeExpired } = await pool.query(
        `UPDATE trades SET status = 'expired'
         WHERE status = 'doge_locked' AND doge_timeout IS NOT NULL AND doge_timeout <= $1
         RETURNING id, seller_address, buyer_address`,
        [nowSec]
      );
      for (const t of dogeExpired) {
        console.log(`[Expire] Trade #${t.id} expired (doge_locked, now ${nowSec} >= ${t.doge_timeout || '?'})`);
        io.to(`trade:${t.id}`).emit('tradeStatusUpdate', { tradeId: t.id, status: 'expired' });
        io.to(`addr:${t.seller_address}`).emit('tradeNotification', { tradeId: t.id, type: 'expired', message: `Trade #${t.id} expired — BTCT refund available` });
        io.to(`addr:${t.buyer_address}`).emit('tradeNotification', { tradeId: t.id, type: 'expired', message: `Trade #${t.id} expired — DOGE refund available` });
      }

    } catch (e) {
      console.error('[Expire Cleanup] Error:', e.message);
    }
  }

  checkExpired(); // Run once on startup
  setInterval(checkExpired, INTERVAL);
}

// Auto-delete chat messages older than 90 days (runs daily)
function scheduleMessageCleanup() {
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  async function cleanup() {
    try {
      const { pool } = require('./db');
      const { rowCount } = await pool.query(
        `DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days'`
      );
      if (rowCount > 0) {
        console.log(`[Chat Cleanup] Deleted ${rowCount} messages older than 90 days`);
      }
    } catch (e) {
      console.error('[Chat Cleanup] Error:', e.message);
    }
  }
  cleanup(); // Run once on startup
  setInterval(cleanup, CLEANUP_INTERVAL);
}

async function start() {
  await initDB();
  scheduleExpiredTradeCleanup();
  scheduleMessageCleanup();

  server.listen(PORT, () => {
    console.log('='.repeat(50));
    console.log('  BTCT/DOGE DEX (Decentralized Exchange)');
    console.log('  Atomic Swap via HTLC');
    console.log('  Server holds NO private keys');
    console.log(`  Listening on port ${PORT}`);
    console.log('='.repeat(50));
  });
}

start().catch(err => {
  console.error('[DEX] Startup failed:', err);
  process.exit(1);
});
