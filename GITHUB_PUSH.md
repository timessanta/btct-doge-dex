# GitHub Push Guide

## 1. Create .env file (DO NOT COMMIT THIS)

```bash
cd /home/krypton/exchange-dex
cp .env.example .env
nano .env
```

Fill in your actual values:
```env
DB_PASSWORD=your_database_password
ADMIN_ID=your_admin_username
ADMIN_PASSWORD_HASH=your_bcrypt_hash
JWT_SECRET=your_jwt_secret_min_32_chars
BLOCKCYPHER_TOKEN=your_blockcypher_api_token
```

## 2. Initialize Git

```bash
cd /home/krypton/exchange-dex
git init
git add .
git status  # Make sure .env is NOT listed (should be ignored)
```

## 3. First Commit

```bash
git commit -m "Initial commit: BTCT/DOGE DEX reference implementation

- Non-custodial atomic swap platform
- HTLC-based trustless swaps
- Client-side transaction signing
- Rate limiting for AML compliance
- Educational/reference purposes only"
```

## 4. Connect to GitHub

```bash
git branch -M main
git remote add origin https://github.com/timessanta/btct-doge-dex.git
```

## 5. Push to GitHub

**You will need a GitHub Personal Access Token (PAT):**

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes: `repo` (all sub-options)
4. Click "Generate token"
5. **COPY THE TOKEN** (you'll only see it once!)

Then push:
```bash
git push -u origin main
```

When prompted for password, paste your **Personal Access Token** (not your GitHub password).

## 6. Verify

Visit: https://github.com/timessanta/btct-doge-dex

You should see:
- ✅ README.md displayed
- ✅ All source files
- ❌ NO .env file (should be ignored)
- ❌ NO ecosystem.config.js (should be ignored)

---

## Future Updates

```bash
cd /home/krypton/exchange-dex
git add .
git commit -m "Your commit message"
git push
```

---

## Security Checklist

Before pushing, ensure:
- [ ] .env is NOT staged (check with `git status`)
- [ ] ecosystem.config.js is NOT staged
- [ ] No passwords in code
- [ ] No API tokens in code
- [ ] DISCLAIMER.md is included
- [ ] README.md includes legal warnings
