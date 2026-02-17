// DEX Server — Decentralized Exchange (bulletin board + blockchain reader)
// Server NEVER holds private keys, NEVER custodies funds
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

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ===================== SOCKET.IO (Chat + Trade Updates) =====================

io.on('connection', (socket) => {
  socket.on('joinTrade', (tradeId) => {
    socket.join(`trade:${tradeId}`);
  });

  socket.on('leaveTrade', (tradeId) => {
    socket.leave(`trade:${tradeId}`);
  });

  socket.on('chatMessage', async (data) => {
    const { tradeId, senderAddress, content } = data;
    if (!tradeId || !senderAddress || !content) return;

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
});

// ===================== STARTUP =====================

async function start() {
  await initDB();

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
