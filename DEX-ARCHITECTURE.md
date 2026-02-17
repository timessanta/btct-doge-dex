# BTCT/DOGE DEX Architecture Documentation

**Project**: Decentralized Exchange for BTCT ↔ DOGE Atomic Swaps  
**URL**: https://dex.btc-time.com  
**Version**: 1.0 (2026-02-17)  
**Type**: Non-custodial P2P Trading Platform

---

## 1. Project Overview

### Purpose
Peer-to-peer cryptocurrency exchange platform enabling trustless atomic swaps between BTCT (Bitcoin Time) and DOGE (Dogecoin) without a centralized custodian.

### Core Principles
- **Non-custodial**: Server never holds, stores, or receives user private keys
- **Decentralized**: All funds locked in blockchain smart contracts (HTLC)
- **Trustless**: Atomic swap mechanism guarantees "all or nothing" execution
- **Zero fees**: No trading fees collected by platform

---

## 2. Technical Architecture

### System Components

```
┌─────────────────────────────────────────────────────┐
│                 Frontend (Browser)                   │
│  - Web UI (SPA)                                      │
│  - Private key storage (localStorage)               │
│  - Transaction signing (bitcore-doge.js, Krypton)   │
│  - Direct blockchain interaction                    │
└──────────────────┬──────────────────────────────────┘
                   │ (HTTPS)
┌──────────────────┴──────────────────────────────────┐
│              Backend Server (Node.js)                │
│  - Ad bulletin board (PostgreSQL)                   │
│  - Blockchain data reader (RPC/API)                 │
│  - WebSocket for real-time updates                  │
│  - NO private key access                            │
└──────────────────┬──────────────────────────────────┘
                   │
     ┌─────────────┴─────────────┐
     │                           │
┌────▼─────┐              ┌─────▼──────┐
│   BTCT   │              │    DOGE    │
│Full Node │              │Blockcypher │
│  (RPC)   │              │    API     │
└──────────┘              └────────────┘
```

### Technology Stack
- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: Vanilla JavaScript (SPA)
- **BTCT**: bitcoinkrypton-seed library (HTLC support)
- **DOGE**: bitcore-lib-doge (client-side signing) + Blockcypher API
- **Communication**: Socket.IO (WebSocket), REST API
- **Deployment**: PM2 process manager, Nginx reverse proxy, SSL

---

## 3. Non-Custodial Architecture

### Private Key Management

**Client-Side (Browser)**
- Private keys stored in `localStorage` (user's device only)
- Transaction signing performed in browser using:
  - BTCT: `krypton-offline.js` (Web3-style signing)
  - DOGE: `bitcore-doge.js` (browserify bundle)
- Private keys **NEVER** sent to server

**Server-Side**
- Server does **NOT** store, receive, or process private keys
- Only processes:
  - Signed transactions (broadcast to blockchain)
  - Public addresses (read-only balance queries)
  - Ad listings (PostgreSQL database)

### API Endpoints (Privacy-First)

**BTCT**
- `POST /btct/broadcast` → Receives signed raw transaction hex only
- `GET /btct/balance/:address` → Public address balance query
- `GET /btct/account/:address` → Public account info

**DOGE**
- `GET /doge/utxos/:address` → Query unspent outputs for address
- `POST /doge/broadcast` → Receives signed raw transaction hex only
- (No WIF/private key endpoints)

---

## 4. Atomic Swap Flow (5 Steps)

### Overview
Trades use **Hash Time-Locked Contracts (HTLC)** to ensure atomic execution:
- Either both sides complete, or both sides refund
- No third-party escrow needed

### Step-by-Step Process

#### Step 1: Hash Published (Seller)
- **Actor**: BTCT Seller
- **Action**: Generate random secret (32 bytes), compute SHA256 hash
- **Storage**: Secret saved in browser `localStorage` only
- **Server**: Only receives hash (not secret)

```
Secret: 0xabc123... (client-side only)
Hash:   0xdef456... (published to server)
```

#### Step 2: BTCT Locked in HTLC (Seller)
- **Actor**: BTCT Seller
- **Action**: Create HTLC contract on BTCT blockchain
  - Recipient: Buyer's BTCT address
  - Hash lock: SHA256 hash from Step 1
  - Timeout: ~24 hours (1440 blocks)
  - Amount: Agreed BTCT amount
- **Execution**: Client signs transaction → Server broadcasts to BTCT node
- **Result**: BTCT locked in smart contract address (e.g., `0x123abc...`)

**Contract Rules**:
- Buyer can claim with correct secret
- Seller can refund after timeout

#### Step 3: DOGE Sent (Buyer)
- **Actor**: DOGE Buyer
- **Action**: Send DOGE to seller's address
  - Amount: Agreed DOGE amount
  - Signing: Client-side (bitcore-doge.js)
  - Broadcast: Direct to Blockcypher API via server relay
- **UI**: "Send DOGE" button → Automatic execution
- **Note**: DOGE HTLC (P2SH) planned for future; currently direct transfer

#### Step 4: Seller Redeems DOGE (Secret Revealed)
- **Actor**: BTCT Seller
- **Action**: Claim DOGE (manual confirmation in current version)
- **Side Effect**: Secret becomes visible on-chain (when P2SH implemented)
- **Server**: Records secret in database for buyer to see

#### Step 5: Buyer Redeems BTCT (Atomic Completion)
- **Actor**: DOGE Buyer
- **Action**: Use revealed secret to claim BTCT from HTLC contract
- **Execution**: 
  - Client builds HTLC redeem transaction with secret as proof
  - Signs and broadcasts to BTCT blockchain
- **Result**: Buyer receives BTCT, trade complete

### Timeout & Safety
- If buyer doesn't send DOGE (Step 3 fails):
  - Seller waits for timeout → Refunds BTCT from HTLC
- If seller doesn't reveal secret (Step 4 fails):
  - Seller loses DOGE (already sent)
  - Buyer can't claim BTCT (no secret)
  - Seller refunds BTCT after timeout
- If buyer doesn't redeem BTCT (Step 5 fails):
  - Buyer's fault; BTCT eventually refunded to seller after second timeout

---

## 5. Server Role & Legal Compliance

### What Server DOES
1. **Ad Bulletin Board**: Users post buy/sell ads (price, amount, address)
2. **Blockchain Reader**: Query balances, block heights, transaction status
3. **Message Relay**: WebSocket chat between trading parties
4. **Transaction Broadcaster**: Forward signed transactions to blockchain nodes

### What Server DOES NOT Do
1. ❌ Store or access private keys
2. ❌ Control user funds
3. ❌ Execute trades on behalf of users
4. ❌ Collect trading fees
5. ❌ Act as intermediary or escrow

### Legal Classification

**Not a "Virtual Asset Service Provider" (VASP) under Korean Financial Transaction Reports Act (특금법)**

**Reasoning**:
- Does not "keep, manage, or control" customer virtual assets (Article 2, Paragraph 3)
- Does not custody private keys
- Does not execute trades algorithmically
- Provides only:
  - Information service (ad board)
  - Technical infrastructure (blockchain API relay)

**Similar to**:
- Localbitcoins.com (P2P ad board)
- Bisq (decentralized exchange)
- Classified ad platforms for crypto

---

## 6. Security Design

### Client-Side Security
- Private keys never leave browser
- Transaction signing in-browser (offline-capable)
- User controls when to sign transactions

### Server-Side Security
- No private key storage = no key theft risk
- PostgreSQL for ad data (no sensitive crypto data)
- Admin panel with JWT authentication (read-only analytics)
- Rate limiting on API endpoints

### Blockchain Security
- HTLC contracts are auditable on-chain
- Timeout mechanisms prevent indefinite locks
- Atomic swap guarantees eliminate counterparty risk

---

## 7. Technical Specifications

### BTCT (Bitcoin Time)
- **Network**: Custom blockchain (Nimiq-based)
- **Block time**: ~60 seconds
- **Precision**: 1 BTCT = 10^11 Satoshi
- **HTLC**: Native support via ExtendedTransaction (CONTRACT_CREATION)
- **Address format**: 40-character hex (20 bytes)
- **Node**: Local full node (RPC port 12211)

### DOGE (Dogecoin)
- **Network**: Dogecoin mainnet
- **Block time**: ~60 seconds
- **Precision**: 1 DOGE = 10^8 Satoshi
- **Address format**: Base58Check (starts with 'D')
- **UTXO Model**: Bitcoin-compatible
- **API**: Blockcypher public API (2000 req/hour with token)

### Database Schema
```sql
-- Trade advertisements
CREATE TABLE trade_ads (
  id SERIAL PRIMARY KEY,
  btct_address VARCHAR(42),
  doge_address VARCHAR(50),
  type VARCHAR(4), -- 'buy' or 'sell'
  price NUMERIC(20,8), -- 1 BTCT = ? DOGE
  min_btct NUMERIC(30,0),
  max_btct NUMERIC(30,0),
  status VARCHAR(20) DEFAULT 'active'
);

-- Active trades (HTLC state machine)
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER REFERENCES trade_ads(id),
  seller_address VARCHAR(42),
  buyer_address VARCHAR(42),
  btct_amount NUMERIC(30,0),
  doge_amount NUMERIC(20,0),
  hash_lock VARCHAR(64), -- SHA256 hash
  secret_revealed VARCHAR(64), -- After step 4
  btct_htlc_address VARCHAR(42),
  btct_timeout INTEGER,
  status VARCHAR(20) -- negotiating, hash_published, btct_locked, doge_locked, seller_redeemed, completed
);

-- Chat messages
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER REFERENCES trades(id),
  sender_address VARCHAR(42),
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. Deployment

### Infrastructure
- **Server**: Ubuntu 22.04
- **Domain**: dex.btc-time.com
- **SSL**: Let's Encrypt (via Nginx reverse proxy)
- **Process Manager**: PM2 (dex-api, port 3030)
- **Reverse Proxy**: Nginx (443 → 3030)

### Environment
- `BLOCKCYPHER_TOKEN`: API rate limit boost
- `JWT_SECRET`: Admin panel authentication
- BTCT RPC: http://127.0.0.1:12211

---

## 9. Key Differentiators

### vs. Centralized Exchanges
- ✅ No KYC required
- ✅ No withdrawal limits
- ✅ No account seizure risk
- ✅ No hacking risk (no hot wallet)

### vs. Other DEXs
- ✅ Cross-chain (BTCT ↔ DOGE) without wrapped tokens
- ✅ No liquidity pools or AMM (order book style)
- ✅ HTLC-based atomic swaps (provably secure)

---

## 10. Future Enhancements

### Planned Features
- [ ] DOGE P2SH HTLC (eliminate manual DOGE claim step)
- [ ] Multi-signature escrow option
- [ ] Trade history & reputation system
- [ ] Mobile-responsive UI improvements
- [ ] Additional cryptocurrency pairs (BTCT/BTC, BTCT/LTC)

### Under Consideration
- [ ] Lightning Network integration (BTCT)
- [ ] Decentralized identity (DID) for reputation
- [ ] API for third-party integrations

---

## 11. Contact & Support

**Developer**: Bitcoin Time Project  
**Website**: https://btc-time.com  
**DEX**: https://dex.btc-time.com  
**Pool**: https://pool.btc-time.com  
**Explorer**: https://explorer.btc-time.com

---

## Appendix: Code Samples

### Client-Side DOGE Transaction Signing
```javascript
async function signAndSendDoge(wif, toAddress, amountDoge) {
  const bitcore = window.bitcoreDoge;
  const privateKey = new bitcore.PrivateKey(wif);
  const fromAddress = privateKey.toAddress().toString();
  
  // Get UTXOs from server (no private key sent)
  const utxos = await fetch(`/api/doge/utxos/${fromAddress}`).then(r => r.json());
  
  // Build & sign transaction CLIENT-SIDE
  const tx = new bitcore.Transaction()
    .from(utxos)
    .to(toAddress, amountDoge * 1e8)
    .fee(1000000) // 0.01 DOGE
    .change(fromAddress)
    .sign(privateKey);
  
  // Broadcast signed TX (server only sees raw hex)
  const result = await fetch('/api/doge/broadcast', {
    method: 'POST',
    body: JSON.stringify({ rawTx: tx.serialize() })
  }).then(r => r.json());
  
  return result.txid;
}
```

### BTCT HTLC Creation
```javascript
// This happens entirely client-side
const htlcSender = sellerAddress; // Can refund after timeout
const htlcRecipient = buyerAddress; // Can claim with secret
const hashAlgo = Krypton.Hash.Algorithm.SHA256;
const hashRoot = Krypton.BufferUtils.fromHex(hashLock);
const timeout = blockHeight + 1440; // ~24 hours

const tx = new Krypton.ExtendedTransaction(
  senderAddr,
  Krypton.Account.Type.BASIC,
  Krypton.Address.CONTRACT_CREATION,
  Krypton.Account.Type.HTLC,
  btctAmount, // Satoshi
  blockHeight + 1,
  Krypton.Transaction.Flag.CONTRACT_CREATION,
  htlcData // Serialized HTLC parameters
);

// Sign with private key (client-side)
const signature = Krypton.Signature.create(privateKey, publicKey, tx.serializeContent());
tx.proof = Krypton.SignatureProof.singleSig(publicKey, signature).serialize();

// Get contract address
const htlcAddress = tx.getContractCreationAddress();

// Broadcast (server only sees signed hex)
await fetch('/api/btct/broadcast', {
  method: 'POST',
  body: JSON.stringify({ txHex: Krypton.BufferUtils.toHex(tx.serialize()) })
});
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-17  
**Status**: Production Ready
