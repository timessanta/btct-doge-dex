// ======================== Town Mining Module ========================
// Pool mining via Krypton NanoPoolMiner for BTCT Town
// Uses wss://pool.btc-time.com:12712

const TownMiner = (() => {
  const POOL_HOST = 'pool.btc-time.com';
  const POOL_PORT = 12712;
  const SATOSHI = 1e11; // 1 BTCT = 1e11 satoshi

  let _consensus = null;
  let _miner = null;
  let _mining = false;
  let _hashrate = 0;
  let _balance = 0;
  let _confirmedBalance = 0;
  let _payoutRequestActive = false;
  let _connectionState = 'closed'; // closed, connecting, connected
  let _consensusState = 'connecting'; // connecting, syncing, established
  let _threads = 1;
  let _maxThreads = Math.max(1, navigator.hardwareConcurrency || 4);
  let _initPromise = null;
  let _address = null; // Krypton Address object
  let _addressHex = ''; // hex string
  let _onUpdate = null; // callback for UI updates
  let _headHeight = 0;

  // Format hashrate with units
  function formatHashrate(hr) {
    if (hr === 0) return '0 H/s';
    const units = ['H/s', 'KH/s', 'MH/s', 'GH/s'];
    let idx = 0, val = hr;
    while (val >= 1000 && idx < units.length - 1) { val /= 1000; idx++; }
    return val.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
  }

  // Format balance (satoshi → BTCT)
  function formatBalance(sat) {
    if (!sat) return '0';
    const btct = Number(sat) / SATOSHI;
    return btct.toFixed(5);
  }

  // Initialize Krypton SDK and nano consensus
  async function init() {
    if (_initPromise) return _initPromise;
    _initPromise = _doInit();
    return _initPromise;
  }

  function _doInit() {
    return new Promise(async (resolve, reject) => {
      if (typeof Krypton === 'undefined') {
        reject(new Error('Krypton SDK not loaded'));
        return;
      }

      try {
        // Ensure WASM is loaded
        await Krypton.WasmHelper.doImport();

        // Initialize genesis config for mainnet
        try { Krypton.GenesisConfig.main(); } catch (e) {
          // Already initialized — OK
        }

        // Also set kryptonReady for existing offline signing
        if (typeof kryptonReady !== 'undefined') {
          kryptonReady = true;
        }

        // Create light consensus (for pool mining — NanoPoolMiner needs blockchain.getNextTarget)
        _consensus = await Krypton.Consensus.light();

        // Track consensus state
        _consensus.on('established', () => {
          _consensusState = 'established';
          _fireUpdate();
          console.log('[TownMiner] Consensus established');
        });
        _consensus.on('syncing', () => {
          _consensusState = 'syncing';
          _fireUpdate();
        });

        // Track head height
        _consensus.on('head-changed', () => {
          _headHeight = _consensus.blockchain.height;
          _fireUpdate();
        });

        // Connect to P2P network
        _consensus.network.connect();
        _headHeight = _consensus.blockchain.height;

        console.log('[TownMiner] Initialized (light consensus, head=' + _headHeight + ')');
        resolve();
      } catch (e) {
        console.error('[TownMiner] Init error:', e);
        reject(e);
      }
    });
  }

  // Start mining with given BTCT address
  async function startMining(hexAddr) {
    if (_mining) return;
    if (!_consensus) {
      await init();
    }

    // Parse address
    _addressHex = (hexAddr || '').replace(/^0x/, '');
    if (!_addressHex || _addressHex.length !== 40) {
      throw new Error('Invalid BTCT address');
    }

    try {
      _address = Krypton.Address.fromHex(_addressHex);
    } catch (e) {
      throw new Error('Invalid BTCT address: ' + e.message);
    }

    // Generate device ID
    const deviceId = Krypton.BasePoolMiner.generateDeviceId(_consensus.network.config);

    // Create NanoPoolMiner
    _miner = new Krypton.NanoPoolMiner(
      _consensus.blockchain,
      _consensus.network.time,
      _address,
      deviceId
    );

    // Set threads
    _miner.threads = _threads;

    // Hashrate updates
    _miner.on('hashrate-changed', (hr) => {
      _hashrate = hr;
      _fireUpdate();
    });

    // Balance updates
    _miner.on('balance', (bal) => {
      _balance = bal;
      _fireUpdate();
    });
    _miner.on('confirmed-balance', (bal) => {
      _confirmedBalance = bal;
      _fireUpdate();
    });

    // Connection state changes
    _miner.on('connection-state', (state) => {
      switch (state) {
        case Krypton.BasePoolMiner.ConnectionState.CONNECTED:
          _connectionState = 'connected';
          console.log('[TownMiner] Pool connected, starting work...');
          _miner.startWork();
          break;
        case Krypton.BasePoolMiner.ConnectionState.CONNECTING:
          _connectionState = 'connecting';
          break;
        case Krypton.BasePoolMiner.ConnectionState.CLOSED:
          _connectionState = 'closed';
          break;
      }
      _fireUpdate();
    });

    // Connect to pool
    _connectionState = 'connecting';
    _mining = true;
    _fireUpdate();

    _miner.connect(POOL_HOST, POOL_PORT);
    console.log('[TownMiner] Connecting to pool ' + POOL_HOST + ':' + POOL_PORT);
  }

  // Stop mining
  function stopMining() {
    if (!_miner) return;
    _mining = false;
    _hashrate = 0;
    try {
      _miner.disconnect();
    } catch (e) {
      console.warn('[TownMiner] Disconnect error:', e);
    }
    _miner = null;
    _connectionState = 'closed';
    _fireUpdate();
    console.log('[TownMiner] Stopped');
  }

  // Set thread count
  function setThreads(n) {
    n = Math.max(1, Math.min(n, _maxThreads));
    _threads = n;
    if (_miner) {
      _miner.threads = n;
    }
    _fireUpdate();
  }

  // Request payout from pool
  function requestPayout() {
    if (_miner && _miner.isConnected()) {
      _miner.requestPayout();
      _payoutRequestActive = true;
      _fireUpdate();
    }
  }

  // Get current state
  function getState() {
    return {
      mining: _mining,
      hashrate: _hashrate,
      hashrateFormatted: formatHashrate(_hashrate),
      balance: _balance,
      balanceFormatted: formatBalance(_balance),
      confirmedBalance: _confirmedBalance,
      confirmedBalanceFormatted: formatBalance(_confirmedBalance),
      payoutRequestActive: _payoutRequestActive,
      connectionState: _connectionState,
      consensusState: _consensusState,
      threads: _threads,
      maxThreads: _maxThreads,
      address: _addressHex,
      headHeight: _headHeight,
      poolHost: POOL_HOST,
    };
  }

  // Set update callback
  function onUpdate(fn) {
    _onUpdate = fn;
  }

  function _fireUpdate() {
    if (_onUpdate) {
      try { _onUpdate(getState()); } catch (e) { console.warn(e); }
    }
  }

  // Public API
  return {
    init,
    startMining,
    stopMining,
    setThreads,
    requestPayout,
    getState,
    onUpdate,
    formatHashrate,
    formatBalance,
    get mining() { return _mining; },
    get maxThreads() { return _maxThreads; },
  };
})();
