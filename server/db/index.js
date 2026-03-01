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

    // DOGE HTLC P2SH columns (added for true atomic swap)
    await client.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS seller_doge_address VARCHAR(50)`);
    await client.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS buyer_doge_address VARCHAR(50)`);
    await client.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS doge_redeem_script TEXT`);

    // IP tracking
    await client.query(`ALTER TABLE trade_ads ADD COLUMN IF NOT EXISTS creator_ip VARCHAR(45)`);
    await client.query(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS initiator_ip VARCHAR(45)`);

    // Town RPG — BIT (in-game currency) and player stats
    await client.query(`
      CREATE TABLE IF NOT EXISTS town_players (
        btct_address VARCHAR(42) PRIMARY KEY,
        bit_balance BIGINT DEFAULT 0,
        hp INT DEFAULT 100,
        max_hp INT DEFAULT 100,
        atk INT DEFAULT 10,
        def INT DEFAULT 0,
        level INT DEFAULT 1,
        exp BIGINT DEFAULT 0,
        mobs_killed INT DEFAULT 0,
        deaths INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Town RPG — inventory items
    await client.query(`
      CREATE TABLE IF NOT EXISTS town_inventory (
        id SERIAL PRIMARY KEY,
        btct_address VARCHAR(42) NOT NULL,
        item_id VARCHAR(30) NOT NULL,
        quantity INT DEFAULT 1,
        equipped BOOLEAN DEFAULT false,
        UNIQUE(btct_address, item_id)
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
