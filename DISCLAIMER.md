# ⚠️ LEGAL DISCLAIMER

## This Software is for Educational Purposes Only

**THE ORIGINAL DEVELOPERS DO NOT OPERATE ANY PUBLIC INSTANCE OF THIS SOFTWARE.**

This software is provided as a **reference implementation** for educational, research, and development purposes only.

---

## What This Software Does

This software provides:
- A bulletin board for users to post swap listings
- A relay for signed blockchain transactions
- WebSocket infrastructure for peer-to-peer chat
- Read-only blockchain data queries

---

## What This Software Does NOT Do

This software does NOT:
- ❌ Store or access private keys
- ❌ Custody user funds
- ❌ Execute swaps on behalf of users
- ❌ Act as an intermediary or escrow
- ❌ Charge fees or generate revenue
- ❌ Provide financial advice

---

## Legal Responsibilities

### Users
Users are solely responsible for:
- Complying with applicable laws in their jurisdiction
- Understanding how atomic swaps and HTLC contracts work
- Securing their own private keys
- Verifying counterparty information
- Reporting taxes and capital gains
- Assessing risks before swapping

### Deployers/Operators
Anyone deploying or operating this software must:
- Understand local Virtual Asset Service Provider (VASP) regulations
- Implement appropriate AML/KYC measures if required by law
- Consult legal counsel before operation
- Comply with securities laws
- Register with financial authorities if required

---

## Jurisdictional Risks

This software may be subject to regulatory oversight in certain jurisdictions, including but not limited to:

- **South Korea**: 특정 금융거래정보의 보고 및 이용 등에 관한 법률 (Act on Reporting and Using Specified Financial Transaction Information, "특금법")
- **United States**: Bank Secrecy Act, FinCEN regulations for Money Service Businesses (MSBs)
- **European Union**: 5th Anti-Money Laundering Directive (5AMLD), Markets in Crypto-Assets (MiCA)
- **Japan**: Payment Services Act (資金決済法)
- **United Kingdom**: Financial Services and Markets Act 2000

**Operators are responsible for determining if their use case requires registration as a VASP or equivalent entity.**

---

## No Warranty

This software is provided "AS IS", WITHOUT WARRANTY OF ANY KIND, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

In no event shall the authors or copyright holders be liable for any claim, damages, or other liability arising from the use of this software.

---

## Cryptocurrency Risks

Cryptocurrency swaps carry inherent risks including but not limited to:
- Price volatility
- Transaction delays or failures
- Network congestion
- Smart contract bugs
- Counterparty risk (DOGE side is not HTLC-protected in current version)
- Loss of funds due to user error

**Users acknowledge these risks by using this software.**

---

## Regulatory Compliance

Depending on your jurisdiction and use case, you may need to:
- Register as a Money Service Business (MSB)
- Implement Know Your Customer (KYC) procedures
- Conduct Anti-Money Laundering (AML) checks
- Report suspicious activities
- Obtain licenses from financial authorities

**This software does NOT provide compliance infrastructure. Operators must implement these separately.**

---

## Rate Limiting is Not AML Compliance

While this software includes basic rate limiting (50,000 BTCT/24h per wallet), this is NOT a substitute for proper AML/KYC compliance.

Operators in regulated jurisdictions must implement:
- Identity verification
- Source of funds checks
- Transaction monitoring
- Suspicious Activity Reports (SARs)
- Record keeping

---

## Intellectual Property

This software is licensed under the MIT License. See [LICENSE](LICENSE) file.

Use of this software does not grant:
- Trademark rights to "Bitcoin Time" or "BTCT"
- Endorsement by the original developers
- Right to claim affiliation with the Bitcoin Time project

---

## Contact for Legal Inquiries

For legal questions regarding:
- **This software**: See [LICENSE](LICENSE) and contact the repository maintainers
- **Bitcoin Time blockchain**: Visit https://btc-time.com
- **Specific deployment**: Contact the operator of that specific instance

---

**BY USING THIS SOFTWARE, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO THIS DISCLAIMER.**

Last Updated: 2026-02-18
