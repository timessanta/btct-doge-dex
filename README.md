# BTCT/DOGE Decentralized Exchange (DEX)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)

**⚠️ DISCLAIMER: This is a reference implementation for educational purposes only.**

**Running this software in jurisdictions with Virtual Asset Service Provider (VASP) regulations may carry legal risks. The original developers do not operate any public instance of this software. Users are solely responsible for compliance with applicable laws and regulations.**

---

## Overview

A non-custodial, peer-to-peer atomic swap platform for exchanging BTCT (Bitcoin Time) and DOGE (Dogecoin) using Hash Time-Locked Contracts (HTLC).

### Key Features

- ✅ **Non-custodial**: Server never holds, accesses, or stores private keys
- ✅ **Trustless**: HTLC ensures atomic execution (all-or-nothing)
- ✅ **Zero fees**: Platform does not charge trading fees
- ✅ **Client-side signing**: All transactions signed in the browser
- ✅ **Rate limiting**: Built-in AML compliance measures (50,000 BTCT/24h per wallet)
- ✅ **Open source**: Auditable code

---

## Architecture

```
┌─────────────────────────────────────────┐
│        Frontend (Browser)                │
│  - Private keys (localStorage)          │
│  - Transaction signing (client-side)    │
│  - HTLC contracts                        │
└──────────────┬──────────────────────────┘
               │ HTTPS
┌──────────────┴──────────────────────────┐
│        Backend (Node.js)                 │
│  - Bulletin board (PostgreSQL)          │
│  - Blockchain RPC relay                 │
│  - WebSocket chat                       │
│  - NO private key access                │
└──────────────┬──────────────────────────┘
               │
      ┌────────┴────────┐
      │                 │
┌─────▼─────┐    ┌──────▼──────┐
│   BTCT    │    │    DOGE     │
│ Full Node │    │Blockcypher  │
│   (RPC)   │    │    API      │
└───────────┘    └─────────────┘
```

---

## Prerequisites

- **Node.js** >= 16.0.0
- **PostgreSQL** >= 12
- **BTCT Full Node** (bitcoinkrypton-seed)
- **PM2** (optional, for production)

---

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/timessanta/btct-doge-dex.git
cd btct-doge-dex
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
nano .env
```

Edit `.env` with your configuration:
```env
PORT=3030
DB_HOST=localhost
DB_NAME=btct_dex
DB_USER=exchange
DB_PASSWORD=your_secure_password

# Optional: Admin panel
ADMIN_ID=admin
ADMIN_PASSWORD_HASH=$2b$10$... (use bcrypt)
JWT_SECRET=your_random_32char_secret

# Optional: Blockcypher token for higher DOGE API limits
BLOCKCYPHER_TOKEN=your_token

# BTCT Node RPC URL
BTCT_RPC_URL=http://127.0.0.1:12211
```

### 4. Set up PostgreSQL database
```bash
sudo -u postgres psql
CREATE DATABASE btct_dex;
CREATE USER exchange WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE btct_dex TO exchange;
\q
```

### 5. Initialize database schema
```bash
node server/db/init.js
```

### 6. Generate admin password hash (optional)
```bash
node -e "console.log(require('bcryptjs').hashSync('your_password', 10))"
```

---

## Running

### Development
```bash
npm run dev
```

### Production (with PM2)
```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Access at: `http://localhost:3030`

---

## BTCT Node Setup

You need a running BTCT full node with RPC enabled.

### Example `peer.conf`:
```json
{
  "host": "0.0.0.0",
  "port": 12011,
  "rpcServer": {
    "enabled": "yes",
    "port": 12211,
    "allowip": ["127.0.0.1"]
  },
  "wallet": {
    "address": "your_btct_address"
  }
}
```

Start the node:
```bash
cd bitcoinkrypton-seed/rpc
./launch.sh
```

---

## Security Considerations

### What the server does:
- Stores trade listings (PostgreSQL)
- Relays signed transactions to blockchain
- Provides blockchain data lookups
- Facilitates WebSocket chat

### What the server does NOT do:
- ❌ Store private keys
- ❌ Control user funds
- ❌ Execute trades on behalf of users
- ❌ Act as escrow or intermediary
- ❌ Charge fees

### Rate Limiting (AML Compliance)
- 50,000 BTCT per wallet per 24 hours
- 30 swaps per wallet per 24 hours
- 20 listings per wallet per 24 hours

---

## API Endpoints

### Public
- `GET /api/status` - Network status
- `GET /api/ads` - List active ads
- `GET /api/trades?address=<addr>` - User's trades
- `POST /api/ads` - Create ad
- `POST /api/trades` - Initiate swap

### Blockchain (Read-only)
- `GET /api/btct/balance/:address`
- `GET /api/doge/balance/:address`
- `POST /api/btct/broadcast` - Broadcast signed TX
- `POST /api/doge/broadcast` - Broadcast signed TX

### Admin (JWT Required)
- `POST /api/admin/login`
- `GET /api/admin/stats`
- `GET /api/admin/ads`
- `GET /api/admin/trades`

---

## Client-Side Libraries

- **BTCT**: `krypton-offline.js` (included in `public/`)
- **DOGE**: `bitcore-doge.js` (browserify bundle, ~2MB)

All transaction signing happens in the browser. Private keys never leave the user's device.

---

## Architecture Documentation

See [DEX-ARCHITECTURE.md](DEX-ARCHITECTURE.md) for detailed technical documentation (Korean).

---

## Legal Notice

**This software is provided for educational and research purposes only.**

- The server does NOT custody user funds
- The server does NOT execute trades algorithmically
- Users retain full control of their private keys
- Platform operators are NOT parties to swaps

**Regulatory Compliance**: Users are responsible for ensuring compliance with local laws, including but not limited to:
- Virtual Asset Service Provider (VASP) regulations
- Anti-Money Laundering (AML) requirements
- Know Your Customer (KYC) obligations
- Securities laws

**No Warranty**: This software is provided "as is" without warranty of any kind. See [LICENSE](LICENSE) for details.

---

## Contributing

This is a reference implementation. Contributions are welcome via pull requests.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Contact

- **Project**: Bitcoin Time (BTCT)
- **Website**: https://btc-time.com

---

**⚠️ The original developers do not operate any public instance of this software. Use at your own risk.**
