# BTCT/DOGE 탈중앙화 거래소 아키텍처 문서

**프로젝트**: BTCT ↔ DOGE 아토믹 스왑 탈중앙화 거래소  
**URL**: https://dex.btc-time.com  
**버전**: 1.0 (2026-02-17)  
**분류**: Non-custodial P2P 거래 플랫폼

---

## 1. 프로젝트 개요

### 목적
BTCT(Bitcoin Time)와 DOGE(Dogecoin) 간의 신뢰 불필요한(trustless) 아토믹 스왑을 가능하게 하는 P2P 암호화폐 거래 플랫폼. 중앙화된 관리자(custodian) 없음.

### 핵심 원칙
- **Non-custodial**: 서버는 사용자의 개인키를 보관하지도, 저장하지도, 수신하지도 않음
- **탈중앙화**: 모든 자금은 블록체인 스마트 컨트랙트(HTLC)에 잠김
- **신뢰 불필요**: 아토믹 스왑 메커니즘이 "전부 실행 또는 전부 취소"를 보장
- **수수료 제로**: 플랫폼이 거래 수수료를 수취하지 않음

---

## 2. 기술 아키텍처

### 시스템 구성

```
┌─────────────────────────────────────────────────────┐
│                프론트엔드 (브라우저)                    │
│  - 웹 UI (SPA)                                      │
│  - 개인키 저장 (localStorage)                        │
│  - 트랜잭션 서명 (bitcore-doge.js, Krypton)         │
│  - 블록체인 직접 통신                                 │
└──────────────────┬──────────────────────────────────┘
                   │ (HTTPS)
┌──────────────────┴──────────────────────────────────┐
│             백엔드 서버 (Node.js)                     │
│  - 광고 게시판 (PostgreSQL)                          │
│  - 블록체인 데이터 조회 (RPC/API)                     │
│  - 실시간 업데이트 (WebSocket)                        │
│  - 개인키 접근 없음                                   │
└──────────────────┬──────────────────────────────────┘
                   │
     ┌─────────────┴─────────────┐
     │                           │
┌────▼─────┐              ┌─────▼──────┐
│   BTCT   │              │    DOGE    │
│ 풀노드   │              │Blockcypher │
│  (RPC)   │              │    API     │
└──────────┘              └────────────┘
```

### 기술 스택
- **백엔드**: Node.js + Express + PostgreSQL
- **프론트엔드**: 순수 JavaScript (SPA)
- **BTCT**: bitcoinkrypton-seed 라이브러리 (HTLC 지원)
- **DOGE**: bitcore-lib-doge (클라이언트 서명) + Blockcypher API
- **통신**: Socket.IO (WebSocket), REST API
- **배포**: PM2 프로세스 관리자, Nginx 리버스 프록시, SSL

---

## 3. Non-Custodial 아키텍처

### 개인키 관리

**클라이언트 측 (브라우저)**
- 개인키는 `localStorage`에 저장 (사용자 기기에만 존재)
- 트랜잭션 서명은 브라우저에서 수행:
  - BTCT: `krypton-offline.js` (Web3 스타일 서명)
  - DOGE: `bitcore-doge.js` (browserify 번들)
- 개인키는 **절대** 서버로 전송되지 않음

**서버 측**
- 서버는 개인키를 저장하지도, 수신하지도, 처리하지도 **않음**
- 오직 다음만 처리:
  - 서명된 트랜잭션 (블록체인으로 브로드캐스트)
  - 공개 주소 (읽기 전용 잔액 조회)
  - 광고 목록 (PostgreSQL 데이터베이스)

### API 엔드포인트 (프라이버시 우선)

**BTCT**
- `POST /btct/broadcast` → 서명된 raw 트랜잭션 hex만 수신
- `GET /btct/balance/:address` → 공개 주소 잔액 조회
- `GET /btct/account/:address` → 공개 계정 정보

**DOGE**
- `GET /doge/utxos/:address` → 주소의 미사용 출력(UTXO) 조회
- `POST /doge/broadcast` → 서명된 raw 트랜잭션 hex만 수신
- (WIF/개인키 엔드포인트 없음)

---

## 4. 아토믹 스왑 플로우 (5단계)

### 개요
거래는 **해시 타임 락 컨트랙트(HTLC)**를 사용하여 원자성(atomic) 실행 보장:
- 양측 모두 완료되거나, 양측 모두 환불됨
- 제3자 에스크로 불필요

### 단계별 프로세스

#### 1단계: 해시 공개 (판매자)
- **행위자**: BTCT 판매자
- **행동**: 랜덤 비밀값(32바이트) 생성, SHA256 해시 계산
- **저장**: 비밀값은 브라우저 `localStorage`에만 저장
- **서버**: 해시만 받음 (비밀값은 받지 않음)

```
비밀값: 0xabc123... (클라이언트에만 존재)
해시:   0xdef456... (서버에 공개)
```

#### 2단계: BTCT HTLC 잠금 (판매자)
- **행위자**: BTCT 판매자
- **행동**: BTCT 블록체인에 HTLC 컨트랙트 생성
  - 수신자: 구매자의 BTCT 주소
  - 해시 락: 1단계의 SHA256 해시
  - 타임아웃: ~24시간 (1440 블록)
  - 금액: 합의된 BTCT 수량
- **실행**: 클라이언트가 트랜잭션 서명 → 서버가 BTCT 노드로 브로드캐스트
- **결과**: BTCT가 스마트 컨트랙트 주소에 잠김 (예: `0x123abc...`)

**컨트랙트 규칙**:
- 구매자는 올바른 비밀값으로 인출 가능
- 판매자는 타임아웃 후 환불 가능

#### 3단계: DOGE 전송 (구매자)
- **행위자**: DOGE 구매자
- **행동**: 판매자 주소로 DOGE 전송
  - 금액: 합의된 DOGE 수량
  - 서명: 클라이언트 측 (bitcore-doge.js)
  - 브로드캐스트: 서버 중계를 통해 Blockcypher API로 직접 전송
- **UI**: "Send DOGE" 버튼 → 자동 실행
- **참고**: DOGE HTLC (P2SH)는 향후 계획; 현재는 직접 전송

#### 4단계: 판매자 DOGE 수령 (비밀값 공개)
- **행위자**: BTCT 판매자
- **행동**: DOGE 수령 확인 (현재 버전에서는 수동)
- **부작용**: 비밀값이 온체인에서 공개됨 (P2SH 구현 시)
- **서버**: 비밀값을 데이터베이스에 기록하여 구매자가 볼 수 있게 함

#### 5단계: 구매자 BTCT 수령 (아토믹 완료)
- **행위자**: DOGE 구매자
- **행동**: 공개된 비밀값으로 HTLC 컨트랙트에서 BTCT 인출
- **실행**: 
  - 클라이언트가 비밀값을 증명으로 하는 HTLC 상환 트랜잭션 생성
  - 서명하여 BTCT 블록체인으로 브로드캐스트
- **결과**: 구매자가 BTCT를 받고, 거래 완료

### 타임아웃 & 안전장치
- 구매자가 DOGE를 보내지 않으면 (3단계 실패):
  - 판매자는 타임아웃까지 대기 → HTLC에서 BTCT 환불
- 판매자가 비밀값을 공개하지 않으면 (4단계 실패):
  - 판매자는 DOGE를 잃음 (이미 전송됨)
  - 구매자는 BTCT를 인출할 수 없음 (비밀값 없음)
  - 판매자는 타임아웃 후 BTCT 환불
- 구매자가 BTCT를 인출하지 않으면 (5단계 실패):
  - 구매자의 과실; BTCT는 결국 두 번째 타임아웃 후 판매자에게 환불

---

## 5. 서버 역할 & 법적 준수

### 면책 조항 (Disclaimer)
본 플랫폼은 **소프트웨어 도구 및 정보 게시판**만을 제공합니다:
- 모든 트랜잭션은 **사용자가 개인키로 직접 서명**합니다
- 서버는 사용자를 대신하여 자금을 이동시키지 않습니다
- 거래의 성사 여부는 전적으로 사용자 간의 합의에 달려 있습니다
- 플랫폼 운영자는 거래 당사자가 아니며, 거래 결과에 책임지지 않습니다

### 서버가 하는 일
1. **광고 게시판**: 사용자가 매수/매도 광고 게시 (가격, 수량, 주소)
2. **블록체인 조회**: 잔액, 블록 높이, 트랜잭션 상태 조회
3. **메시지 중계**: 거래 당사자 간 WebSocket 채팅
4. **트랜잭션 브로드캐스트**: 서명된 트랜잭션을 블록체인 노드로 전달

### 서버가 하지 않는 일
1. ❌ 개인키 저장 또는 접근
2. ❌ 사용자 자금 통제
3. ❌ 사용자를 대신한 거래 실행
4. ❌ 거래 수수료 수취
5. ❌ 중개자 또는 에스크로 역할
6. ❌ 거래 강제 실행 또는 취소
7. ❌ 분쟁 중재 또는 환불 처리

### 법적 분류

**한국 특정 금융거래정보의 보고 및 이용 등에 관한 법률(특금법)상 "가상자산사업자(VASP)"에 해당하지 않음**

**근거**:
- 고객의 가상자산을 "보관·관리·통제"하지 않음 (법 제2조 제3항)
- 개인키를 보관하지 않음
- 알고리즘적으로 거래를 실행하지 않음
- 오직 다음만 제공:
  - 정보 서비스 (광고 게시판)
  - 기술 인프라 (블록체인 API 중계)

**유사 사례**:
- Localbitcoins.com (P2P 광고 게시판)
- Bisq (탈중앙화 거래소)
- 암호화폐 관련 중개 광고 플랫폼

---

## 6. 보안 설계

### 클라이언트 측 보안
- 개인키가 브라우저 밖으로 나가지 않음
- 트랜잭션 서명이 브라우저 내에서 수행 (오프라인 가능)
- 사용자가 트랜잭션 서명 시점을 통제

### 서버 측 보안
- 개인키 미저장 = 키 탈취 위험 없음
- PostgreSQL로 광고 데이터만 저장 (민감한 암호화폐 데이터 없음)
- JWT 인증 관리자 패널 (읽기 전용 분석)
- API 엔드포인트 속도 제한

### 블록체인 보안
- HTLC 컨트랙트는 온체인에서 감사 가능
- 타임아웃 메커니즘으로 무기한 잠금 방지
- 아토믹 스왑이 거래상대방 위험 제거

---

## 7. 기술 사양

### BTCT (Bitcoin Time)
- **네트워크**: 커스텀 블록체인 (Nimiq 기반)
- **블록 시간**: ~60초
- **정밀도**: 1 BTCT = 10^11 Satoshi
- **HTLC**: ExtendedTransaction을 통한 네이티브 지원 (CONTRACT_CREATION)
- **주소 형식**: 40자 hex (20바이트)
- **노드**: 로컬 풀노드 (RPC 포트 12211)

### DOGE (Dogecoin)
- **네트워크**: Dogecoin 메인넷
- **블록 시간**: ~60초
- **정밀도**: 1 DOGE = 10^8 Satoshi
- **주소 형식**: Base58Check ('D'로 시작)
- **UTXO 모델**: 비트코인 호환
- **API**: Blockcypher 공개 API (토큰 있을 시 시간당 2000 요청)

### 데이터베이스 스키마
```sql
-- 거래 광고
CREATE TABLE trade_ads (
  id SERIAL PRIMARY KEY,
  btct_address VARCHAR(42),
  doge_address VARCHAR(50),
  type VARCHAR(4), -- 'buy' 또는 'sell'
  price NUMERIC(20,8), -- 1 BTCT = ? DOGE
  min_btct NUMERIC(30,0),
  max_btct NUMERIC(30,0),
  status VARCHAR(20) DEFAULT 'active'
);

-- 진행 중인 거래 (HTLC 상태 머신)
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  ad_id INTEGER REFERENCES trade_ads(id),
  seller_address VARCHAR(42),
  buyer_address VARCHAR(42),
  btct_amount NUMERIC(30,0),
  doge_amount NUMERIC(20,0),
  hash_lock VARCHAR(64), -- SHA256 해시
  secret_revealed VARCHAR(64), -- 4단계 이후
  btct_htlc_address VARCHAR(42),
  btct_timeout INTEGER,
  status VARCHAR(20) -- negotiating, hash_published, btct_locked, doge_locked, seller_redeemed, completed
);

-- 채팅 메시지
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  trade_id INTEGER REFERENCES trades(id),
  sender_address VARCHAR(42),
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 8. 배포 환경

### 인프라
- **서버**: Ubuntu 22.04 (Hyper-V VM)
- **IP**: 192.168.219.110
- **도메인**: dex.btc-time.com
- **SSL**: Let's Encrypt (Nginx를 통해 192.168.219.101에서)
- **프로세스 관리자**: PM2 (dex-api, 포트 3030)
- **리버스 프록시**: Nginx (443 → 3030)

### 환경 변수
- `BLOCKCYPHER_TOKEN`: API 속도 제한 증가
- `JWT_SECRET`: 관리자 패널 인증
- BTCT RPC: http://127.0.0.1:12211

---

## 9. 주요 차별점

### 중앙화 거래소 대비
- ✅ KYC 불필요
- ✅ 출금 한도 없음
- ✅ 계정 압류 위험 없음
- ✅ 해킹 위험 없음 (핫월렛 없음)

### 다른 DEX 대비
- ✅ 크로스체인 (BTCT ↔ DOGE) 래핑 토큰 없이
- ✅ 유동성 풀이나 AMM 없음 (오더북 방식)
- ✅ HTLC 기반 아토믹 스왑 (증명 가능한 보안)

---

## 10. 향후 개선 사항

### 계획된 기능
- [ ] DOGE P2SH HTLC (수동 DOGE 수령 단계 제거)
- [ ] 다중 서명 에스크로 옵션
- [ ] 거래 이력 & 평판 시스템
- [ ] 모바일 반응형 UI 개선
- [ ] 추가 암호화폐 쌍 (BTCT/BTC, BTCT/LTC)

### 검토 중
- [ ] 라이트닝 네트워크 통합 (BTCT)
- [ ] 탈중앙화 신원(DID) 평판용
- [ ] 제3자 통합을 위한 API

---

## 11. 연락처 & 지원

**개발자**: Bitcoin Time Project  
**웹사이트**: https://btc-time.com  
**DEX**: https://dex.btc-time.com  
**풀**: https://pool.btc-time.com  
**익스플로러**: https://explorer.btc-time.com

---

## 부록: 코드 샘플

### 클라이언트 측 DOGE 트랜잭션 서명
```javascript
async function signAndSendDoge(wif, toAddress, amountDoge) {
  const bitcore = window.bitcoreDoge;
  const privateKey = new bitcore.PrivateKey(wif);
  const fromAddress = privateKey.toAddress().toString();
  
  // 서버에서 UTXO 가져오기 (개인키는 전송 안 됨)
  const utxos = await fetch(`/api/doge/utxos/${fromAddress}`).then(r => r.json());
  
  // 트랜잭션 생성 & 서명 - 클라이언트에서만 수행
  const tx = new bitcore.Transaction()
    .from(utxos)
    .to(toAddress, amountDoge * 1e8)
    .fee(1000000) // 0.01 DOGE
    .change(fromAddress)
    .sign(privateKey);
  
  // 서명된 TX 브로드캐스트 (서버는 raw hex만 봄, 개인키 절대 안 봄)
  const result = await fetch('/api/doge/broadcast', {
    method: 'POST',
    body: JSON.stringify({ rawTx: tx.serialize() })
  }).then(r => r.json());
  
  return result.txid;
}
```

### BTCT HTLC 생성
```javascript
// 모두 클라이언트 측에서 수행됨
const htlcSender = sellerAddress; // 타임아웃 후 환불 가능
const htlcRecipient = buyerAddress; // 비밀값으로 인출 가능
const hashAlgo = Krypton.Hash.Algorithm.SHA256;
const hashRoot = Krypton.BufferUtils.fromHex(hashLock);
const timeout = blockHeight + 1440; // ~24시간

const tx = new Krypton.ExtendedTransaction(
  senderAddr,
  Krypton.Account.Type.BASIC,
  Krypton.Address.CONTRACT_CREATION,
  Krypton.Account.Type.HTLC,
  btctAmount, // Satoshi
  blockHeight + 1,
  Krypton.Transaction.Flag.CONTRACT_CREATION,
  htlcData // 직렬화된 HTLC 파라미터
);

// 개인키로 서명 (클라이언트 측)
const signature = Krypton.Signature.create(privateKey, publicKey, tx.serializeContent());
tx.proof = Krypton.SignatureProof.singleSig(publicKey, signature).serialize();

// 컨트랙트 주소 획득
const htlcAddress = tx.getContractCreationAddress();

// 브로드캐스트 (서버는 서명된 hex만 봄)
await fetch('/api/btct/broadcast', {
  method: 'POST',
  body: JSON.stringify({ txHex: Krypton.BufferUtils.toHex(tx.serialize()) })
});
```

---

**문서 버전**: 1.0  
**최종 업데이트**: 2026-02-17  
**상태**: 프로덕션 준비 완료
