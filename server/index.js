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
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about.html'));
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

  // ---- Chat & Trade Events ----
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

  // ---- Disconnect cleanup ----
  socket.on('disconnect', () => {
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
