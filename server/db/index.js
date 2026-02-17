// Database Schema for DEX (minimal — no user accounts, no private keys)
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'exchange',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'btct_dex',
  password: process.env.DB_PASSWORD || 'change_this_password',
  port: process.env.DB_PORT || 5432,
});

async function initDB() {
  const client = await pool.connect();
  try {
    // Trade Ads — public billboard
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_ads (
        id SERIAL PRIMARY KEY,
        btct_address VARCHAR(42) NOT NULL,
        type VARCHAR(4) NOT NULL,          -- 'buy' or 'sell' (BTCT perspective)
        price NUMERIC(20,8) NOT NULL,      -- 1 BTCT = ? DOGE
        min_btct NUMERIC(30,0) NOT NULL,   -- min BTCT amount (satoshi)
        max_btct NUMERIC(30,0) NOT NULL,   -- max BTCT amount (satoshi)
        remaining NUMERIC(30,0) NOT NULL,  -- remaining BTCT (satoshi)
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Trades — coordination only, NO private keys stored
    await client.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        ad_id INT REFERENCES trade_ads(id),
        seller_address VARCHAR(42) NOT NULL,
        buyer_address VARCHAR(42) NOT NULL,
        btct_amount NUMERIC(30,0) NOT NULL,  -- satoshi
        doge_amount NUMERIC(20,0) NOT NULL,  -- satoshi
        price NUMERIC(20,8) NOT NULL,

        -- HTLC public data (server never knows the secret)
        hash_lock VARCHAR(64),               -- SHA256 hash of secret (public)
        btct_htlc_tx VARCHAR(70),            -- BTCT HTLC creation TX hash
        btct_htlc_address VARCHAR(42),       -- BTCT HTLC contract address
        btct_timeout INT,                    -- BTCT HTLC timeout block height
        doge_htlc_tx VARCHAR(70),            -- DOGE HTLC creation TX hash (P2SH)
        doge_htlc_address VARCHAR(70),       -- DOGE P2SH HTLC address
        doge_timeout INT,                    -- DOGE HTLC timeout (unix timestamp)

        -- Completion
        btct_redeem_tx VARCHAR(70),          -- Buyer redeems BTCT
        doge_redeem_tx VARCHAR(70),          -- Seller redeems DOGE
        secret_revealed VARCHAR(64),         -- Secret revealed on-chain

        -- Status
        status VARCHAR(20) DEFAULT 'negotiating',
        -- negotiating → hash_published → btct_locked → doge_locked →
        -- seller_redeemed → completed / expired / cancelled

        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `);

    // Chat messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        trade_id INT REFERENCES trades(id),
        sender_address VARCHAR(42) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('[DB] Tables initialized');
  } catch (err) {
    console.error('[DB] Init error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
