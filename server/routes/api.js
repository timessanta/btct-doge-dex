// DEX API Routes — server is just a bulletin board + blockchain reader
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const btctRpc = require('../btctRpc');
const dogeRpc = require('../dogeRpc');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: update town bubble for a given address
async function updateTownBubble(req, address) {
  try {
    const io = req.app.get('io');
    const townPlayers = req.app.get('townPlayers');
    const getAdBubbleText = req.app.get('getAdBubbleText');
    if (!io || !townPlayers || !getAdBubbleText) return;

    const adText = await getAdBubbleText(address);

    // Find all sockets for this address and update
    for (const [sid, player] of Object.entries(townPlayers)) {
      if (player.address === address) {
        player.adText = adText;
        io.emit('townAdUpdate', { id: sid, adText, address });
      }
    }
  } catch (e) {
    console.error('[TownBubble] Error:', e.message);
  }
}

// Admin credentials (use environment variables in production)
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PW_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$10$example.hash.replace.in.production';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

// ===================== NETWORK STATUS =====================

router.get('/status', async (req, res) => {
  try {
    const blockNumber = await btctRpc.getBlockNumber();
    const peerCount = await btctRpc.getPeerCount();
    const consensus = await btctRpc.getConsensus();
    res.json({ btctBlock: blockNumber, btctPeers: peerCount, btctConsensus: consensus });
  } catch (e) {
    res.json({ btctBlock: 0, btctPeers: 0, btctConsensus: 'unknown', error: e.message });
  }
});

// ===================== BTCT/DOGE CHART DATA =====================

router.get('/btct-chart', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT price, completed_at FROM trades WHERE status = 'completed' AND completed_at IS NOT NULL ORDER BY completed_at ASC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== TRADE ADS (Public Board) =====================

// List active ads
router.get('/ads', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM trade_ads WHERE status = 'active' ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create ad (no auth — address is self-declared)
router.post('/ads', async (req, res) => {
  try {
    const { btctAddress, type, price, minBtct, maxBtct } = req.body;
    if (!btctAddress || !type || !price || !minBtct || !maxBtct) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['buy', 'sell'].includes(type)) {
      return res.status(400).json({ error: 'Type must be buy or sell' });
    }

    const addr = btctAddress.replace(/^0x/, '').toLowerCase();

    // Rate limit check
    const rateCheck = await checkAdRateLimit(addr);
    if (rateCheck.limited) {
      return res.status(429).json({ error: rateCheck.reason });
    }
    const creatorIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
    const { rows: [ad] } = await pool.query(
      `INSERT INTO trade_ads (btct_address, type, price, min_btct, max_btct, remaining, creator_ip)
       VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING *`,
      [addr, type, price, minBtct, maxBtct, creatorIp]
    );
    res.json(ad);

    // Broadcast to all clients
    const io = req.app.get('io');
    if (io) io.emit('adListUpdate');
    updateTownBubble(req, addr);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Close ad
router.post('/ads/:id/close', async (req, res) => {
  try {
    const { btctAddress } = req.body;
    const addr = btctAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [ad] } = await pool.query(
      `UPDATE trade_ads SET status = 'closed' WHERE id = $1 AND btct_address = $2 RETURNING *`,
      [req.params.id, addr]
    );
    if (!ad) return res.status(404).json({ error: 'Ad not found or not yours' });
    res.json(ad);

    // Broadcast to all clients
    const io = req.app.get('io');
    if (io) io.emit('adListUpdate');
    updateTownBubble(req, addr);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== RATE LIMITING (AML compliance) =====================

const RATE_LIMIT_24H_BTCT = 5000000000000000; // 50,000 BTCT in satoshi (50000 * 1e11)
const RATE_LIMIT_24H_TRADES = 30; // max trades per wallet per 24h
const RATE_LIMIT_24H_ADS = 20; // max listings per wallet per 24h

async function checkTradeRateLimit(address) {
  const addr = address.replace(/^0x/, '').toLowerCase();
  
  // Check trade count in last 24h
  const { rows: [countRow] } = await pool.query(
    `SELECT COUNT(*) as cnt FROM trades
     WHERE (seller_address = $1 OR buyer_address = $1)
     AND created_at > NOW() - INTERVAL '24 hours'`,
    [addr]
  );
  if (parseInt(countRow.cnt) >= RATE_LIMIT_24H_TRADES) {
    return { limited: true, reason: `Daily swap limit reached (${RATE_LIMIT_24H_TRADES} swaps per 24h)` };
  }

  // Check total BTCT volume in last 24h
  const { rows: [volRow] } = await pool.query(
    `SELECT COALESCE(SUM(btct_amount), 0) as total FROM trades
     WHERE (seller_address = $1 OR buyer_address = $1)
     AND created_at > NOW() - INTERVAL '24 hours'`,
    [addr]
  );
  const totalVol = BigInt(volRow.total);
  if (totalVol >= BigInt(RATE_LIMIT_24H_BTCT)) {
    return { limited: true, reason: 'Daily volume limit reached (50,000 BTCT per 24h)' };
  }

  return { limited: false };
}

async function checkAdRateLimit(address) {
  const addr = address.replace(/^0x/, '').toLowerCase();
  const { rows: [countRow] } = await pool.query(
    `SELECT COUNT(*) as cnt FROM trade_ads
     WHERE btct_address = $1
     AND created_at > NOW() - INTERVAL '24 hours'`,
    [addr]
  );
  if (parseInt(countRow.cnt) >= RATE_LIMIT_24H_ADS) {
    return { limited: true, reason: `Daily listing limit reached (${RATE_LIMIT_24H_ADS} listings per 24h)` };
  }
  return { limited: false };
}

// ===================== TRADES (Atomic Swap Coordination) =====================

// Initiate trade (buyer clicks ad)
router.post('/trades', async (req, res) => {
  try {
    const { adId, buyerAddress, btctAmount } = req.body;
    if (!adId || !buyerAddress || !btctAmount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const buyer = buyerAddress.replace(/^0x/, '').toLowerCase();

    // Rate limit check
    const rateCheck = await checkTradeRateLimit(buyer);
    if (rateCheck.limited) {
      return res.status(429).json({ error: rateCheck.reason });
    }

    // Get ad
    const { rows: [ad] } = await pool.query(
      `SELECT * FROM trade_ads WHERE id = $1 AND status = 'active'`, [adId]
    );
    if (!ad) return res.status(404).json({ error: 'Ad not found or inactive' });

    // Also check seller rate limit
    const sellerAddr = ad.type === 'sell' ? ad.btct_address : buyer;
    if (sellerAddr !== buyer) {
      const sellerCheck = await checkTradeRateLimit(sellerAddr);
      if (sellerCheck.limited) {
        return res.status(429).json({ error: 'Counterparty has reached daily limit' });
      }
    }

    const amount = BigInt(btctAmount);
    if (amount < BigInt(ad.min_btct) || amount > BigInt(ad.remaining)) {
      return res.status(400).json({ error: 'Amount out of range' });
    }

    // Determine seller/buyer based on ad type
    let seller, finalBuyer;
    if (ad.type === 'sell') {
      seller = ad.btct_address;
      finalBuyer = buyer;
    } else {
      seller = buyer; // The one responding to a buy ad is selling
      finalBuyer = ad.btct_address;
    }

    // Calculate DOGE amount
    const btctSat = Number(btctAmount);
    const dogeAmount = Math.round(btctSat * Number(ad.price) / 1000);

    // Create trade
    const initiatorIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;
    const { rows: [trade] } = await pool.query(
      `INSERT INTO trades (ad_id, seller_address, buyer_address, btct_amount, doge_amount, price, initiator_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [adId, seller, finalBuyer, btctAmount, dogeAmount, ad.price, initiatorIp]
    );

    // Reduce ad remaining
    await pool.query(
      `UPDATE trade_ads SET remaining = remaining - $1 WHERE id = $2`,
      [btctAmount, adId]
    );
    await pool.query(
      `UPDATE trade_ads SET status = 'closed' WHERE id = $1 AND remaining <= 0`,
      [adId]
    );

    // Notify ad owner about the new trade
    const io = req.app.get('io');
    if (io) {
      const adOwner = ad.btct_address;
      io.to(`addr:${adOwner}`).emit('newTradeAlert', {
        tradeId: trade.id,
        btctAmount: trade.btct_amount,
        dogeAmount: trade.doge_amount,
        adType: ad.type
      });
      // Refresh bulletin board for all (ad remaining changed)
      io.emit('adListUpdate');
    }

    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get trade details
router.get('/trades/:id', async (req, res) => {
  try {
    const { rows: [trade] } = await pool.query(
      `SELECT t.*, a.type as ad_type FROM trades t
       LEFT JOIN trade_ads a ON t.ad_id = a.id
       WHERE t.id = $1`, [req.params.id]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    res.json(trade);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List trades for an address
router.get('/trades', async (req, res) => {
  try {
    const addr = (req.query.address || '').replace(/^0x/, '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'Address required' });

    const { rows } = await pool.query(
      `SELECT t.*, a.type as ad_type FROM trades t
       LEFT JOIN trade_ads a ON t.ad_id = a.id
       WHERE t.seller_address = $1 OR t.buyer_address = $1
       ORDER BY t.created_at DESC`, [addr]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Publish hash lock (seller publishes H = SHA256(secret))
router.post('/trades/:id/hash', async (req, res) => {
  try {
    const { sellerAddress, hashLock, sellerDogeAddress } = req.body;
    if (!sellerAddress || !hashLock) {
      return res.status(400).json({ error: 'Missing sellerAddress or hashLock' });
    }

    const seller = sellerAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1 AND seller_address = $2 AND status = 'negotiating'`,
      [req.params.id, seller]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found or not in negotiating state' });

    await pool.query(
      `UPDATE trades SET hash_lock = $1, seller_doge_address = $2, status = 'hash_published' WHERE id = $3`,
      [hashLock, sellerDogeAddress || null, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Report BTCT HTLC creation (seller locked BTCT)
router.post('/trades/:id/btct-locked', async (req, res) => {
  try {
    const { sellerAddress, htlcTx, htlcAddress, timeout } = req.body;
    if (!sellerAddress || !htlcTx || !htlcAddress) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const seller = sellerAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1 AND seller_address = $2 AND status = 'hash_published'`,
      [req.params.id, seller]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    // Verify HTLC exists on-chain (best-effort: TX may still be in mempool)
    try {
      const htlcAddr = htlcAddress.replace(/^0x/, '');
      const account = await btctRpc.getAccount(htlcAddr);
      if (!account || account.type !== 2) {
        // TX is likely in mempool, not yet mined — allow it
        console.log(`[DEX] HTLC contract not yet on chain for trade ${trade.id} (mempool), proceeding anyway`);
      } else if (account.hashRoot && account.hashRoot !== trade.hash_lock) {
        return res.status(400).json({ error: 'HTLC hash does not match trade hash_lock' });
      }
    } catch (e) {
      // Contract may not be available immediately, allow it
      console.log(`[DEX] HTLC verification pending for trade ${trade.id}: ${e.message}`);
    }

    await pool.query(
      `UPDATE trades SET btct_htlc_tx = $1, btct_htlc_address = $2, btct_timeout = $3, status = 'btct_locked'
       WHERE id = $4`,
      [htlcTx, htlcAddress.replace(/^0x/, ''), timeout || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Report DOGE HTLC creation (buyer locked DOGE in P2SH)
router.post('/trades/:id/doge-locked', async (req, res) => {
  try {
    const { buyerAddress, htlcTx, htlcAddress, timeout, buyerDogeAddress, dogeRedeemScript } = req.body;
    if (!buyerAddress || !htlcTx || !htlcAddress) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const buyer = buyerAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1 AND buyer_address = $2 AND status = 'btct_locked'`,
      [req.params.id, buyer]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    await pool.query(
      `UPDATE trades SET doge_htlc_tx = $1, doge_htlc_address = $2, doge_timeout = $3,
       buyer_doge_address = $4, doge_redeem_script = $5, status = 'doge_locked'
       WHERE id = $6`,
      [htlcTx, htlcAddress, timeout || 0, buyerDogeAddress || null, dogeRedeemScript || null, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Report seller redeemed DOGE (reveals secret)
router.post('/trades/:id/seller-redeemed', async (req, res) => {
  try {
    const { sellerAddress, redeemTx, secret } = req.body;
    if (!sellerAddress || !redeemTx || !secret) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const seller = sellerAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1 AND seller_address = $2 AND status = 'doge_locked'`,
      [req.params.id, seller]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    await pool.query(
      `UPDATE trades SET doge_redeem_tx = $1, secret_revealed = $2, status = 'seller_redeemed' WHERE id = $3`,
      [redeemTx, secret, req.params.id]
    );
    res.json({ success: true, secret });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Report buyer redeemed BTCT (used revealed secret)
router.post('/trades/:id/buyer-redeemed', async (req, res) => {
  try {
    const { buyerAddress, redeemTx } = req.body;
    if (!buyerAddress || !redeemTx) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const buyer = buyerAddress.replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1 AND buyer_address = $2 AND status = 'seller_redeemed'`,
      [req.params.id, buyer]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    await pool.query(
      `UPDATE trades SET btct_redeem_tx = $1, status = 'completed', completed_at = NOW() WHERE id = $2`,
      [redeemTx, req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cancel trade
router.post('/trades/:id/cancel', async (req, res) => {
  try {
    const { address } = req.body;
    const addr = (address || '').replace(/^0x/, '').toLowerCase();
    const { rows: [trade] } = await pool.query(
      `SELECT * FROM trades WHERE id = $1
       AND (seller_address = $2 OR buyer_address = $2)
       AND status IN ('negotiating', 'hash_published', 'btct_locked', 'doge_locked', 'expired')`,
      [req.params.id, addr]
    );
    if (!trade) return res.status(404).json({ error: 'Trade not found or cannot cancel' });

    await pool.query(`UPDATE trades SET status = 'cancelled' WHERE id = $1`, [trade.id]);

    // Restore ad remaining
    await pool.query(
      `UPDATE trade_ads SET remaining = remaining + $1 WHERE id = $2`,
      [trade.btct_amount, trade.ad_id]
    );
    await pool.query(
      `UPDATE trade_ads SET status = 'active' WHERE id = $1 AND status = 'closed' AND remaining > 0`,
      [trade.ad_id]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== BLOCKCHAIN QUERIES (convenience) =====================

router.get('/btct/balance/:address', async (req, res) => {
  try {
    const balance = await btctRpc.getBalance(req.params.address);
    res.json({ address: req.params.address, balance: Number(balance) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/btct/account/:address', async (req, res) => {
  try {
    const account = await btctRpc.getAccount(req.params.address);
    res.json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/btct/block', async (req, res) => {
  try {
    const height = await btctRpc.getBlockNumber();
    res.json({ height });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/btct/broadcast', async (req, res) => {
  try {
    const { txHex } = req.body;
    if (!txHex) return res.status(400).json({ error: 'txHex required' });
    const hash = await btctRpc.sendRawTransaction(txHex);
    res.json({ hash });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/doge/balance/:address', async (req, res) => {
  try {
    const bal = await dogeRpc.getAddressBalance(req.params.address);
    res.json({ address: req.params.address, ...bal });
  } catch (e) {
    // Rate limit or network error — return 0 instead of error
    console.warn('[DOGE-Balance]', req.params.address, e.message);
    res.json({ address: req.params.address, balance: 0, unconfirmed: 0, final_balance: 0, error: e.message });
  }
});

// Generate DOGE keypair (server generates, returns to client, does NOT store)
router.post('/doge/generate', async (req, res) => {
  try {
    const bitcore = require('bitcore-lib-doge');
    const privateKey = new bitcore.PrivateKey();
    const address = privateKey.toAddress().toString();
    const wif = privateKey.toWIF();
    // Server does NOT store — client saves in localStorage
    res.json({ address, wif });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Validate/import DOGE WIF key
router.post('/doge/import', async (req, res) => {
  try {
    const { wif } = req.body;
    if (!wif) return res.status(400).json({ error: 'WIF key required' });
    const bitcore = require('bitcore-lib-doge');
    const privateKey = bitcore.PrivateKey.fromWIF(wif);
    const address = privateKey.toAddress().toString();
    res.json({ address, wif });
  } catch (e) {
    res.status(400).json({ error: 'Invalid WIF key: ' + e.message });
  }
});

// Get UTXOs for DOGE address (no private key needed)
router.get('/doge/utxos/:address', async (req, res) => {
  try {
    const { address } = req.params;
    // Accept P2PKH (D...) and P2SH (9... or A...) addresses
    if (!/^[D9A][1-9A-HJ-NP-Za-km-z]{25,33}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid DOGE address format' });
    }
    const utxos = await dogeRpc.getUTXOs(address);
    res.json(utxos);
  } catch (err) {
    console.error('[DOGE-UTXOs]', err);
    res.status(500).json({ error: err.message || 'UTXO fetch failed' });
  }
});

// Broadcast signed DOGE transaction via local Dogecoin Core RPC
router.post('/doge/broadcast', async (req, res) => {
  try {
    const { rawTx } = req.body;
    if (!rawTx) return res.status(400).json({ error: 'rawTx (hex) required' });
    const txid = await dogeRpc.broadcastRawTx(rawTx);
    console.log(`[DOGE] Broadcast TX: ${txid}`);
    res.json({ success: true, txid });
  } catch (err) {
    console.error('[DOGE-Broadcast]', err);
    res.status(500).json({ error: err.message || 'Broadcast failed' });
  }
});

// ===================== CHAT =====================

router.get('/trades/:id/messages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM messages WHERE trade_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== ADMIN (read-only + spam removal) =====================

// Admin login
router.post('/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (id !== ADMIN_ID) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, ADMIN_PW_HASH);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('Not admin');
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin: Statistics
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [
      { rows: [adStats] },
      { rows: [tradeStats] },
      { rows: [completedStats] },
      { rows: recentTrades }
    ] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'active') AS active_ads,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_ads,
        COUNT(*) AS total_ads
        FROM trade_ads`),
      pool.query(`SELECT
        COUNT(*) AS total_trades,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled','expired')) AS active
        FROM trades`),
      pool.query(`SELECT
        COALESCE(SUM(btct_amount), 0) AS total_btct_volume,
        COALESCE(SUM(doge_amount), 0) AS total_doge_volume
        FROM trades WHERE status = 'completed'`),
      pool.query(`SELECT id, seller_address, buyer_address, btct_amount, doge_amount, status, created_at
        FROM trades ORDER BY created_at DESC LIMIT 5`)
    ]);

    res.json({
      ads: adStats,
      trades: tradeStats,
      volume: completedStats,
      recentTrades
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: All ads (including closed)
router.get('/admin/ads', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM trade_ads ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: Delete ad (spam removal)
router.post('/admin/ads/:id/delete', requireAdmin, async (req, res) => {
  try {
    const { rows: [ad] } = await pool.query(
      `UPDATE trade_ads SET status = 'deleted' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    res.json({ success: true, ad });

    // Broadcast to all clients
    const io = req.app.get('io');
    if (io) io.emit('adListUpdate');
    updateTownBubble(req, ad.btct_address);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: All trades (read-only)
router.get('/admin/trades', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, a.type as ad_type, a.creator_ip,
              (t.initiator_ip IS NOT NULL AND a.creator_ip IS NOT NULL AND t.initiator_ip = a.creator_ip) as self_trade
       FROM trades t
       LEFT JOIN trade_ads a ON t.ad_id = a.id
       ORDER BY t.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public stats API (for master dashboard)
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    // 서버가 KST이므로 로컬 자정 = KST 자정
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalAds,
      activeAds,
      totalTrades,
      todayTrades,
      completedTrades,
      todayCompleted,
      totalVolumeBtct,
      todayVolumeBtct,
      recentTrades,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM trade_ads'),
      pool.query("SELECT COUNT(*) FROM trade_ads WHERE status = 'active'"),
      pool.query('SELECT COUNT(*) FROM trades'),
      pool.query('SELECT COUNT(*) FROM trades WHERE created_at >= $1', [todayStart]),
      pool.query("SELECT COUNT(*) FROM trades WHERE status = 'completed'"),
      pool.query("SELECT COUNT(*) FROM trades WHERE status = 'completed' AND completed_at >= $1", [todayStart]),
      pool.query("SELECT COALESCE(SUM(btct_amount),0) as total FROM trades WHERE status = 'completed'"),
      pool.query("SELECT COALESCE(SUM(btct_amount),0) as total FROM trades WHERE status = 'completed' AND completed_at >= $1", [todayStart]),
      pool.query(`SELECT t.seller_address, t.buyer_address, t.btct_amount, t.doge_amount, t.price, t.status, t.created_at, t.initiator_ip, a.creator_ip, (t.initiator_ip IS NOT NULL AND a.creator_ip IS NOT NULL AND t.initiator_ip = a.creator_ip) as self_trade FROM trades t LEFT JOIN trade_ads a ON t.ad_id = a.id ORDER BY t.created_at DESC LIMIT 10`),
    ]);

    const toFloat = (satoshi) => (Number(satoshi || 0) / 1e11).toFixed(8);

    res.json({
      ads: {
        total: parseInt(totalAds.rows[0].count),
        active: parseInt(activeAds.rows[0].count),
      },
      trades: {
        total: parseInt(totalTrades.rows[0].count),
        today: parseInt(todayTrades.rows[0].count),
        completed: parseInt(completedTrades.rows[0].count),
        todayCompleted: parseInt(todayCompleted.rows[0].count),
      },
      volume: {
        totalBtct: toFloat(totalVolumeBtct.rows[0].total),
        todayBtct: toFloat(todayVolumeBtct.rows[0].total),
      },
      recent: recentTrades.rows.map(r => ({
        ...r,
        btct_amount: toFloat(r.btct_amount),
        doge_amount: (Number(r.doge_amount || 0) / 1e8).toFixed(8),
        initiator_ip: r.initiator_ip || null,
        creator_ip: r.creator_ip || null,
        self_trade: r.self_trade || false,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======================== TOWN RPG — BIT API ========================

// Get player stats + BIT balance
router.get('/town/player/:address', async (req, res) => {
  try {
    const addr = req.params.address.replace(/^0x/, '').toLowerCase();
    let result = await pool.query('SELECT * FROM town_players WHERE btct_address = $1', [addr]);
    if (result.rows.length === 0) {
      // Auto-create player on first visit
      await pool.query('INSERT INTO town_players (btct_address) VALUES ($1) ON CONFLICT DO NOTHING', [addr]);
      result = await pool.query('SELECT * FROM town_players WHERE btct_address = $1', [addr]);
    }
    const player = result.rows[0];
    // Get inventory
    const inv = await pool.query('SELECT item_id, quantity, equipped FROM town_inventory WHERE btct_address = $1', [addr]);
    res.json({ ...player, inventory: inv.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add BIT reward (mob kill)
router.post('/town/reward', async (req, res) => {
  try {
    const addr = (req.body.address || '').replace(/^0x/, '').toLowerCase();
    const bits = parseInt(req.body.bits) || 0;
    const exp = parseInt(req.body.exp) || 0;
    if (!addr || bits < 0 || bits > 200) return res.status(400).json({ error: 'Invalid reward' });

    const result = await pool.query(
      `UPDATE town_players SET bit_balance = bit_balance + $2, exp = exp + $3,
       mobs_killed = mobs_killed + 1, updated_at = NOW()
       WHERE btct_address = $1 RETURNING bit_balance, exp, level, mobs_killed`,
      [addr, bits, exp]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Player not found' });

    // Level up check (every 100 exp per level)
    const p = result.rows[0];
    const newLevel = Math.floor(Number(p.exp) / 100) + 1;
    if (newLevel > p.level) {
      await pool.query(
        'UPDATE town_players SET level = $2, max_hp = 100 + ($2 - 1) * 10, atk = 10 + ($2 - 1) * 2 WHERE btct_address = $1',
        [addr, newLevel]
      );
      return res.json({ ...p, level: newLevel, levelUp: true });
    }
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Record death
router.post('/town/death', async (req, res) => {
  try {
    const addr = (req.body.address || '').replace(/^0x/, '').toLowerCase();
    if (!addr) return res.status(400).json({ error: 'No address' });
    await pool.query('UPDATE town_players SET deaths = deaths + 1, updated_at = NOW() WHERE btct_address = $1', [addr]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Buy item from shop
router.post('/town/shop/buy', async (req, res) => {
  try {
    const addr = (req.body.address || '').replace(/^0x/, '').toLowerCase();
    const itemId = req.body.itemId;
    const price = parseInt(req.body.price) || 0;
    if (!addr || !itemId || price <= 0) return res.status(400).json({ error: 'Invalid params' });

    // Check balance
    const player = await pool.query('SELECT bit_balance FROM town_players WHERE btct_address = $1', [addr]);
    if (player.rows.length === 0) return res.status(404).json({ error: 'Player not found' });
    if (Number(player.rows[0].bit_balance) < price) return res.status(400).json({ error: 'Not enough BIT' });

    // Deduct BIT and add item
    await pool.query('UPDATE town_players SET bit_balance = bit_balance - $2, updated_at = NOW() WHERE btct_address = $1', [addr, price]);
    await pool.query(
      `INSERT INTO town_inventory (btct_address, item_id, quantity) VALUES ($1, $2, 1)
       ON CONFLICT (btct_address, item_id) DO UPDATE SET quantity = town_inventory.quantity + 1`,
      [addr, itemId]
    );
    const updated = await pool.query('SELECT bit_balance FROM town_players WHERE btct_address = $1', [addr]);
    const inv = await pool.query('SELECT item_id, quantity, equipped FROM town_inventory WHERE btct_address = $1', [addr]);
    res.json({ bit_balance: updated.rows[0].bit_balance, inventory: inv.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Use consumable item
router.post('/town/item/use', async (req, res) => {
  try {
    const addr = (req.body.address || '').replace(/^0x/, '').toLowerCase();
    const itemId = req.body.itemId;
    if (!addr || !itemId) return res.status(400).json({ error: 'Invalid params' });

    const inv = await pool.query('SELECT quantity FROM town_inventory WHERE btct_address = $1 AND item_id = $2', [addr, itemId]);
    if (inv.rows.length === 0 || inv.rows[0].quantity <= 0) return res.status(400).json({ error: 'Item not owned' });

    // Decrease quantity
    await pool.query(
      'UPDATE town_inventory SET quantity = quantity - 1 WHERE btct_address = $1 AND item_id = $2',
      [addr, itemId]
    );
    // Remove 0 quantity rows
    await pool.query('DELETE FROM town_inventory WHERE btct_address = $1 AND item_id = $2 AND quantity <= 0', [addr, itemId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

