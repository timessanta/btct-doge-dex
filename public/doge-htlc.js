// DOGE HTLC P2SH Library — Client-side atomic swap for Dogecoin
// Uses bitcore-lib-doge (loaded as window.bitcoreDoge)
// Non-custodial: all signing happens in the browser

const DogeHTLC = (function() {
  'use strict';

  const HTLC_TIMEOUT_SEC = 43200; // 12 hours (must be < BTCT 24h timeout)
  const FEE_SAT = 1000000; // 0.01 DOGE

  function getBitcore() {
    const b = window.bitcoreDoge;
    if (!b) throw new Error('bitcore-doge not loaded');
    return b;
  }

  /**
   * Encode an integer as a Bitcoin Script number (minimal little-endian signed magnitude)
   */
  function encodeScriptNum(num) {
    if (num === 0) return Buffer.alloc(0);
    const neg = num < 0;
    let abs = Math.abs(num);
    const result = [];
    while (abs > 0) {
      result.push(abs & 0xff);
      abs = Math.floor(abs / 256);
    }
    if (result[result.length - 1] & 0x80) {
      result.push(neg ? 0x80 : 0x00);
    } else if (neg) {
      result[result.length - 1] |= 0x80;
    }
    return Buffer.from(result);
  }

  /**
   * Create HTLC Redeem Script
   *
   * OP_IF
   *   OP_SHA256 <hashLock> OP_EQUALVERIFY
   *   OP_DUP OP_HASH160 <sellerPKH> OP_EQUALVERIFY OP_CHECKSIG
   * OP_ELSE
   *   <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
   *   OP_DUP OP_HASH160 <buyerPKH> OP_EQUALVERIFY OP_CHECKSIG
   * OP_ENDIF
   *
   * @param {string} hashLockHex - SHA256 hash of the secret (64 hex chars)
   * @param {string} sellerDogeAddr - Seller's DOGE address (receives DOGE when claiming with secret)
   * @param {string} buyerDogeAddr - Buyer's DOGE address (can refund after timeout)
   * @param {number} locktime - Unix timestamp for timeout
   * @returns {{ redeemScript, redeemScriptHex, p2shAddress, locktime }}
   */
  function createHTLC(hashLockHex, sellerDogeAddr, buyerDogeAddr, locktime) {
    const bitcore = getBitcore();

    const sellerAddr = new bitcore.Address(sellerDogeAddr);
    const buyerAddr = new bitcore.Address(buyerDogeAddr);
    const hashLockBuf = Buffer.from(hashLockHex, 'hex');
    const locktimeBuf = encodeScriptNum(locktime);

    // Build redeem script
    const script = new bitcore.Script();
    script.add('OP_IF');
    script.add('OP_SHA256');
    script.add(hashLockBuf);
    script.add('OP_EQUALVERIFY');
    script.add('OP_DUP');
    script.add('OP_HASH160');
    script.add(sellerAddr.hashBuffer);
    script.add('OP_EQUALVERIFY');
    script.add('OP_CHECKSIG');
    script.add('OP_ELSE');
    script.add(locktimeBuf);
    script.add('OP_CHECKLOCKTIMEVERIFY');
    script.add('OP_DROP');
    script.add('OP_DUP');
    script.add('OP_HASH160');
    script.add(buyerAddr.hashBuffer);
    script.add('OP_EQUALVERIFY');
    script.add('OP_CHECKSIG');
    script.add('OP_ENDIF');

    const p2shAddr = bitcore.Address.payingTo(script, 'livenet');

    return {
      redeemScript: script,
      redeemScriptHex: script.toHex(),
      p2shAddress: p2shAddr.toString(),
      locktime: locktime
    };
  }

  /**
   * Build a transaction funding the HTLC P2SH address
   * (Buyer sends DOGE to P2SH)
   *
   * @param {string} wif - Buyer's DOGE private key (WIF)
   * @param {string} p2shAddress - HTLC P2SH address
   * @param {number} amountSat - Amount in satoshis to lock
   * @param {Array} utxos - UTXOs from /doge/utxos API
   * @returns {string} Serialized transaction hex
   */
  function buildFundingTx(wif, p2shAddress, amountSat, utxos) {
    const bitcore = getBitcore();

    const privateKey = new bitcore.PrivateKey(wif);
    const fromAddress = privateKey.toAddress().toString();

    if (!utxos || utxos.length === 0) throw new Error('No UTXOs available');
    const totalSat = utxos.reduce((sum, u) => sum + u.satoshis, 0);
    if (totalSat < amountSat + FEE_SAT) {
      throw new Error('Insufficient DOGE. Have: ' + (totalSat / 1e8).toFixed(8) +
        ', need: ' + ((amountSat + FEE_SAT) / 1e8).toFixed(8));
    }

    const tx = new bitcore.Transaction()
      .from(utxos)
      .to(p2shAddress, amountSat)
      .fee(FEE_SAT)
      .change(fromAddress)
      .sign(privateKey);

    return tx.serialize();
  }

  /**
   * Build a transaction to redeem DOGE from HTLC P2SH (Seller claims with secret)
   *
   * scriptSig: <signature> <pubkey> <secret> OP_TRUE <redeemScript>
   *
   * @param {string} wif - Seller's DOGE private key (WIF)
   * @param {string} redeemScriptHex - Hex-encoded redeem script
   * @param {string} secretHex - The preimage (secret) in hex
   * @param {Array} utxos - UTXOs on the P2SH address
   * @returns {string} Serialized transaction hex
   */
  function buildRedeemTx(wif, redeemScriptHex, secretHex, utxos) {
    const bitcore = getBitcore();

    const privateKey = new bitcore.PrivateKey(wif);
    const publicKey = privateKey.toPublicKey();
    const toAddress = privateKey.toAddress().toString();
    const redeemScript = new bitcore.Script(redeemScriptHex);

    // P2SH output script: OP_HASH160 <hash(redeemScript)> OP_EQUAL
    const p2shOutScript = bitcore.Script.buildScriptHashOut(redeemScript);

    if (!utxos || utxos.length === 0) throw new Error('No UTXOs on HTLC P2SH address');

    // Sum all UTXOs
    const totalSat = utxos.reduce((sum, u) => sum + u.satoshis, 0);
    if (totalSat <= FEE_SAT) throw new Error('HTLC balance too low to cover fee');

    // Build transaction
    const tx = new bitcore.Transaction();

    // Add input(s) from P2SH
    for (const utxo of utxos) {
      tx.addInput(new bitcore.Transaction.Input({
        prevTxId: utxo.txId,
        outputIndex: utxo.outputIndex,
        script: new bitcore.Script(), // empty placeholder — we replace after signing
        output: new bitcore.Transaction.Output({
          script: p2shOutScript,
          satoshis: utxo.satoshis
        })
      }));
    }

    // Output to seller's address
    tx.addOutput(new bitcore.Transaction.Output({
      script: bitcore.Script.buildPublicKeyHashOut(new bitcore.Address(toAddress)),
      satoshis: totalSat - FEE_SAT
    }));

    // nLockTime = 0 for claim (not using CLTV path)
    tx.nLockTime = 0;

    // Sign each input and set custom scriptSig
    const hashType = bitcore.crypto.Signature.SIGHASH_ALL;
    for (let i = 0; i < tx.inputs.length; i++) {
      tx.inputs[i].sequenceNumber = 0xffffffff;

      const sig = bitcore.Transaction.Sighash.sign(
        tx, privateKey, hashType, i, redeemScript
      );

      const inputScript = new bitcore.Script();
      inputScript.add(sig.toTxFormat());
      inputScript.add(publicKey.toBuffer());
      inputScript.add(Buffer.from(secretHex, 'hex'));
      inputScript.add('OP_TRUE'); // enter IF branch
      inputScript.add(redeemScript.toBuffer());

      tx.inputs[i].setScript(inputScript);
    }

    return tx.uncheckedSerialize();
  }

  /**
   * Build a transaction to refund DOGE from HTLC P2SH (Buyer reclaims after timeout)
   *
   * scriptSig: <signature> <pubkey> OP_FALSE <redeemScript>
   * nLockTime >= locktime, nSequence < 0xffffffff
   *
   * @param {string} wif - Buyer's DOGE private key (WIF)
   * @param {string} redeemScriptHex - Hex-encoded redeem script
   * @param {number} locktime - Unix timestamp from HTLC creation
   * @param {Array} utxos - UTXOs on the P2SH address
   * @returns {string} Serialized transaction hex
   */
  function buildRefundTx(wif, redeemScriptHex, locktime, utxos) {
    const bitcore = getBitcore();

    const privateKey = new bitcore.PrivateKey(wif);
    const publicKey = privateKey.toPublicKey();
    const toAddress = privateKey.toAddress().toString();
    const redeemScript = new bitcore.Script(redeemScriptHex);
    const p2shOutScript = bitcore.Script.buildScriptHashOut(redeemScript);

    if (!utxos || utxos.length === 0) throw new Error('No UTXOs on HTLC P2SH address');

    const totalSat = utxos.reduce((sum, u) => sum + u.satoshis, 0);
    if (totalSat <= FEE_SAT) throw new Error('HTLC balance too low to cover fee');

    const tx = new bitcore.Transaction();

    for (const utxo of utxos) {
      tx.addInput(new bitcore.Transaction.Input({
        prevTxId: utxo.txId,
        outputIndex: utxo.outputIndex,
        script: new bitcore.Script(),
        output: new bitcore.Transaction.Output({
          script: p2shOutScript,
          satoshis: utxo.satoshis
        })
      }));
    }

    tx.addOutput(new bitcore.Transaction.Output({
      script: bitcore.Script.buildPublicKeyHashOut(new bitcore.Address(toAddress)),
      satoshis: totalSat - FEE_SAT
    }));

    // nLockTime MUST be >= locktime for CLTV
    tx.nLockTime = locktime;

    const hashType = bitcore.crypto.Signature.SIGHASH_ALL;
    for (let i = 0; i < tx.inputs.length; i++) {
      // nSequence < 0xffffffff to enable nLockTime
      tx.inputs[i].sequenceNumber = 0xfffffffe;

      const sig = bitcore.Transaction.Sighash.sign(
        tx, privateKey, hashType, i, redeemScript
      );

      const inputScript = new bitcore.Script();
      inputScript.add(sig.toTxFormat());
      inputScript.add(publicKey.toBuffer());
      inputScript.add('OP_FALSE'); // enter ELSE branch (timeout refund)
      inputScript.add(redeemScript.toBuffer());

      tx.inputs[i].setScript(inputScript);
    }

    return tx.uncheckedSerialize();
  }

  /**
   * Get default locktime (current time + 12 hours)
   */
  function getDefaultLocktime() {
    return Math.floor(Date.now() / 1000) + HTLC_TIMEOUT_SEC;
  }

  /**
   * Check if HTLC timeout has passed
   */
  function isTimedOut(locktime) {
    return Math.floor(Date.now() / 1000) >= locktime;
  }

  /**
   * Format remaining time until timeout
   */
  function formatTimeRemaining(locktime) {
    const now = Math.floor(Date.now() / 1000);
    const diff = locktime - now;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  // Public API
  return {
    createHTLC,
    buildFundingTx,
    buildRedeemTx,
    buildRefundTx,
    getDefaultLocktime,
    isTimedOut,
    formatTimeRemaining,
    FEE_SAT,
    HTLC_TIMEOUT_SEC
  };

})();
