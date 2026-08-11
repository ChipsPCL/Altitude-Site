// app.js — Altitude Reflections Dashboard
// Standalone /reflections/ dApp
//
// ALT token:
// 0x90678C02823b21772fa7e91b27ee70490257567B
//
// Internal benchmark wallet:
// 0x2Dc03F9e6E3CE6DAdBb472442f82f13B3F3CF767
//
// This wallet is intentionally NOT displayed in the UI.
// The dashboard automatically finds its first incoming ALT transfer within
// the scan window and uses that seed block as the test tracking baseline.
//
// IMPORTANT FOR RESTORED LAUNCH:
// Set RESTORED_START_BLOCK to the exact Base block at which the restored
// reflection tax goes live. Once set, that fixed block overrides auto-test mode.

(() => {
  "use strict";

  // ====== CONFIG ======
  const TOKEN_ADDRESS = "0x90678c02823b21772fa7e91b27ee70490257567b";
  const REFERENCE_WALLET = "0x2dc03f9e6e3ce6dadbb472442f82f13b3f3cf767";

  // PRODUCTION:
  // Replace 0n with the Restored activation block.
  const RESTORED_START_BLOCK = 0n;

  // In test mode, scan backwards this many days to find the benchmark seed transfer.
  const AUTO_SEED_SCAN_DAYS = 90n;

  // Public Base RPC: fine for testing/light traffic.
  // A dedicated archive-capable Base RPC is recommended for production.
  const RPC_URL = "const RPC_URL = "https://base-mainnet.g.alchemy.com/v2/alch__zE5qmVQGBJgMK0e_KRAm";

  const BASE_CHAIN_ID_HEX = "0x2105";
  const APPROX_BLOCK_SECONDS = 2n;

  const TRANSFER_TOPIC =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  const SELECTORS = {
    balanceOf: "70a08231",
    decimals: "313ce567"
  };

  const PERIODS = {
    d7: { days: 7, seconds: 7n * 24n * 60n * 60n },
    d30: { days: 30, seconds: 30n * 24n * 60n * 60n },
    y1: { days: 365, seconds: 365n * 24n * 60n * 60n }
  };

  // ====== STATE ======
  let decimals = 18;
  let trackingStartBlock = 0n;
  let latestBlockCache = 0n;
  let referenceCheckedTo = 0n;
  let currentConnectedAddress = null;
  let refreshTimer = null;

  // ====== DOM ======
  const $ = (id) => document.getElementById(id);

  function setText(id, text) {
    const node = $(id);
    if (node) node.textContent = text;
  }

  function setStatus(id, text, state = "") {
    const node = $(id);
    if (!node) return;

    node.textContent = text;
    node.classList.remove("success", "error", "loading");

    if (state) node.classList.add(state);
  }

  function setNotice(text) {
    setText("trackingNotice", text);
  }

  function setConnectButtons(text, disabled = false) {
    for (const id of ["btnConnect", "btnConnect2"]) {
      const button = $(id);
      if (!button) continue;
      button.textContent = text;
      button.disabled = disabled;
    }
  }

  function shortAddress(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }

  function formatToken(value, maxDecimals = 6) {
    if (!Number.isFinite(value)) return "—";

    if (value > 0 && value < 1 / (10 ** maxDecimals)) {
      return `<${(1 / (10 ** maxDecimals)).toFixed(maxDecimals)} ALT`;
    }

    return value.toLocaleString(undefined, {
      maximumFractionDigits: maxDecimals
    }) + " ALT";
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0.00%";
    if (Math.abs(value) < 0.01) return value.toFixed(4) + "%";
    return value.toFixed(2) + "%";
  }

  // ====== RPC ======
  function blockTag(block) {
    return "0x" + block.toString(16);
  }

  function topicAddress(address) {
    return "0x" + address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  }

  function encodeBalanceOf(address) {
    return (
      "0x" +
      SELECTORS.balanceOf +
      address.toLowerCase().replace(/^0x/, "").padStart(64, "0")
    );
  }

  async function rpc(method, params) {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now() + Math.floor(Math.random() * 1000),
        method,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`Base RPC HTTP ${response.status}`);
    }

    const json = await response.json();

    if (json.error) {
      throw new Error(json.error.message || "Base RPC error");
    }

    return json.result;
  }

  async function ethCall(data, block = "latest") {
    return rpc("eth_call", [
      {
        to: TOKEN_ADDRESS,
        data
      },
      typeof block === "bigint" ? blockTag(block) : block
    ]);
  }

  async function getDecimals() {
    const raw = await ethCall("0x" + SELECTORS.decimals);
    return Number(BigInt(raw));
  }

  async function getBalanceRaw(address, block = "latest") {
    const raw = await ethCall(encodeBalanceOf(address), block);
    return BigInt(raw);
  }

  function rawToNumber(raw) {
    return Number(raw) / (10 ** decimals);
  }

  async function getBalance(address, block = "latest") {
    return rawToNumber(await getBalanceRaw(address, block));
  }

  async function getLatestBlock() {
    latestBlockCache = BigInt(await rpc("eth_blockNumber", []));
    return latestBlockCache;
  }

  function estimatedBlockAgo(latest, secondsAgo) {
    const blocksAgo = secondsAgo / APPROX_BLOCK_SECONDS;
    return latest > blocksAgo ? latest - blocksAgo : 0n;
  }

  // ====== LOGS ======
  async function getLogsAdaptive(filter, fromBlock, toBlock) {
    if (fromBlock > toBlock) return [];

    try {
      return await rpc("eth_getLogs", [{
        ...filter,
        fromBlock: blockTag(fromBlock),
        toBlock: blockTag(toBlock)
      }]);
    } catch (err) {
      const span = toBlock - fromBlock;

      if (span <= 1500n) {
        throw err;
      }

      const mid = fromBlock + span / 2n;

      const [left, right] = await Promise.all([
        getLogsAdaptive(filter, fromBlock, mid),
        getLogsAdaptive(filter, mid + 1n, toBlock)
      ]);

      return left.concat(right);
    }
  }

  async function getWalletTransferLogs(address, fromBlock, toBlock) {
    const addressTopic = topicAddress(address);

    const outgoingFilter = {
      address: TOKEN_ADDRESS,
      topics: [TRANSFER_TOPIC, addressTopic]
    };

    const incomingFilter = {
      address: TOKEN_ADDRESS,
      topics: [TRANSFER_TOPIC, null, addressTopic]
    };

    const [outgoing, incoming] = await Promise.all([
      getLogsAdaptive(outgoingFilter, fromBlock, toBlock),
      getLogsAdaptive(incomingFilter, fromBlock, toBlock)
    ]);

    const unique = new Map();

    for (const log of outgoing.concat(incoming)) {
      const key = `${log.transactionHash}:${log.logIndex}`;
      unique.set(key, log);
    }

    return [...unique.values()].sort((a, b) => {
      const ab = BigInt(a.blockNumber);
      const bb = BigInt(b.blockNumber);

      if (ab < bb) return -1;
      if (ab > bb) return 1;

      const ai = BigInt(a.logIndex);
      const bi = BigInt(b.logIndex);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }

  async function getWalletActivityBlocks(address, fromBlock, toBlock) {
    const logs = await getWalletTransferLogs(address, fromBlock, toBlock);
    const blocks = new Set(logs.map((log) => BigInt(log.blockNumber).toString()));

    return [...blocks]
      .map((v) => BigInt(v))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  // ====== TRACKING BASELINE ======
  async function discoverReferenceSeedBlock(latest) {
    const scanSeconds = AUTO_SEED_SCAN_DAYS * 24n * 60n * 60n;
    const fromBlock = estimatedBlockAgo(latest, scanSeconds);
    const addressTopic = topicAddress(REFERENCE_WALLET);

    const incoming = await getLogsAdaptive(
      {
        address: TOKEN_ADDRESS,
        topics: [TRANSFER_TOPIC, null, addressTopic]
      },
      fromBlock,
      latest
    );

    if (!incoming.length) {
      throw new Error(
        `No benchmark seed transfer found in the last ${AUTO_SEED_SCAN_DAYS.toString()} days.`
      );
    }

    incoming.sort((a, b) => {
      const aa = BigInt(a.blockNumber);
      const bb = BigInt(b.blockNumber);
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });

    return BigInt(incoming[0].blockNumber);
  }

  async function initialiseTrackingStart() {
    const latest = await getLatestBlock();

    if (RESTORED_START_BLOCK > 0n) {
      trackingStartBlock = RESTORED_START_BLOCK;

      setNotice(
        "LIVE RESTORED TRACKING · Reflection history is measured from the fixed Restored activation block."
      );

      return latest;
    }

    trackingStartBlock = await discoverReferenceSeedBlock(latest);

    setNotice(
      "TEST TRACKING · The dashboard is live using the benchmark wallet's seed block. At Restored launch this will be replaced by the exact activation block."
    );

    return latest;
  }

  async function assertReferenceWalletClean(latest) {
    if (trackingStartBlock === 0n) return;

    if (referenceCheckedTo >= latest) return;

    const scanFrom =
      referenceCheckedTo > trackingStartBlock
        ? referenceCheckedTo + 1n
        : trackingStartBlock + 1n;

    if (scanFrom <= latest) {
      const activity = await getWalletActivityBlocks(
        REFERENCE_WALLET,
        scanFrom,
        latest
      );

      if (activity.length > 0) {
        throw new Error(
          "Benchmark wallet has received or sent ALT since tracking began. APR display stopped to prevent corrupted data."
        );
      }
    }

    referenceCheckedTo = latest;
  }

  // ====== APR ======
  function annualiseSimple(periodReturn, days) {
    return periodReturn * (365 / days) * 100;
  }

  async function aprForPeriod(latest, requestedStart, days) {
    if (trackingStartBlock === 0n) {
      return { ready: false };
    }

    if (requestedStart < trackingStartBlock) {
      return { ready: false };
    }

    const [startBal, endBal] = await Promise.all([
      getBalance(REFERENCE_WALLET, requestedStart),
      getBalance(REFERENCE_WALLET, latest)
    ]);

    if (!(startBal > 0) || !(endBal >= startBal)) {
      throw new Error("Benchmark wallet returned an invalid historical balance.");
    }

    const periodReturn = endBal / startBal - 1;

    return {
      ready: true,
      returnPct: periodReturn * 100,
      aprPct: annualiseSimple(periodReturn, days)
    };
  }

  async function loadGlobalApr() {
    try {
      setStatus("globalStatus", "Reading on-chain reflection history…", "loading");

      let latest = await getLatestBlock();

      if (trackingStartBlock === 0n) {
        latest = await initialiseTrackingStart();
      }

      await assertReferenceWalletClean(latest);

      const start7 = estimatedBlockAgo(latest, PERIODS.d7.seconds);
      const start30 = estimatedBlockAgo(latest, PERIODS.d30.seconds);
      const start1y = estimatedBlockAgo(latest, PERIODS.y1.seconds);

      const [r7, r30, r1y] = await Promise.all([
        aprForPeriod(latest, start7, PERIODS.d7.days),
        aprForPeriod(latest, start30, PERIODS.d30.days),
        aprForPeriod(latest, start1y, PERIODS.y1.days)
      ]);

      setText("apr7d", r7.ready ? formatPercent(r7.aprPct) : "Collecting data");
      setText("apr30d", r30.ready ? formatPercent(r30.aprPct) : "Collecting data");
      setText("apr1y", r1y.ready ? formatPercent(r1y.aprPct) : "Collecting data");

      if (r30.ready) {
        setText("aprMain", formatPercent(r30.aprPct));
        setText("aprMainLabel", "30 Day Reflection APR");
      } else if (r7.ready) {
        setText("aprMain", formatPercent(r7.aprPct));
        setText("aprMainLabel", "7 Day Reflection APR");
      } else {
        const [startBal, currentBal] = await Promise.all([
          getBalance(REFERENCE_WALLET, trackingStartBlock),
          getBalance(REFERENCE_WALLET, latest)
        ]);

        const elapsedBlocks = latest - trackingStartBlock;
        const elapsedDays =
          Number(elapsedBlocks * APPROX_BLOCK_SECONDS) / 86400;

        const periodReturn =
          startBal > 0 ? currentBal / startBal - 1 : 0;

        const annualised =
          elapsedDays > 0
            ? annualiseSimple(periodReturn, elapsedDays)
            : 0;

        setText("aprMain", formatPercent(annualised));
        setText(
          "aprMainLabel",
          RESTORED_START_BLOCK > 0n
            ? "Annualised Since Restored"
            : "Annualised Since Tracker Started"
        );
      }

      setStatus(
        "globalStatus",
        "Calculated from actual ALT balance growth in the untouched benchmark wallet.",
        "success"
      );
    } catch (err) {
      console.error("Global APR error:", err);

      setText("aprMain", "Unavailable");
      setText("apr7d", "—");
      setText("apr30d", "—");
      setText("apr1y", "—");

      setStatus(
        "globalStatus",
        err.message || "Unable to read reflection history.",
        "error"
      );
    }
  }

  // ====== PERSONAL REFLECTIONS ======
  async function calculatePersonalReflections(address, startBlock, endBlock) {
    if (startBlock >= endBlock) return 0;

    const activityBlocks = await getWalletActivityBlocks(
      address,
      startBlock + 1n,
      endBlock
    );

    let earned = 0;
    let baseBlock = startBlock;

    let [baseUserBalance, baseRefBalance] = await Promise.all([
      getBalance(address, baseBlock),
      getBalance(REFERENCE_WALLET, baseBlock)
    ]);

    for (const activityBlock of activityBlocks) {
      const preBlock =
        activityBlock > baseBlock ? activityBlock - 1n : baseBlock;

      if (
        preBlock > baseBlock &&
        baseUserBalance > 0 &&
        baseRefBalance > 0
      ) {
        const preRefBalance =
          await getBalance(REFERENCE_WALLET, preBlock);

        const growthFactor =
          preRefBalance / baseRefBalance;

        if (growthFactor >= 1) {
          earned += baseUserBalance * (growthFactor - 1);
        }
      }

      // Reset AFTER user activity so transfers/buys/sells do not count as reflections.
      [baseUserBalance, baseRefBalance] = await Promise.all([
        getBalance(address, activityBlock),
        getBalance(REFERENCE_WALLET, activityBlock)
      ]);

      baseBlock = activityBlock;
    }

    if (
      endBlock > baseBlock &&
      baseUserBalance > 0 &&
      baseRefBalance > 0
    ) {
      const endRefBalance =
        await getBalance(REFERENCE_WALLET, endBlock);

      const growthFactor =
        endRefBalance / baseRefBalance;

      if (growthFactor >= 1) {
        earned += baseUserBalance * (growthFactor - 1);
      }
    }

    return Math.max(0, earned);
  }

  async function personalForPeriod(address, latest, requestedStart) {
    if (requestedStart < trackingStartBlock) {
      return { ready: false, earned: 0 };
    }

    return {
      ready: true,
      earned: await calculatePersonalReflections(
        address,
        requestedStart,
        latest
      )
    };
  }

  async function loadWallet(address) {
    if (!trackingStartBlock) {
      await initialiseTrackingStart();
    }

    try {
      setStatus(
        "walletStatus",
        "Calculating your reflection history…",
        "loading"
      );

      const latest = await getLatestBlock();
      await assertReferenceWalletClean(latest);

      const start7 = estimatedBlockAgo(latest, PERIODS.d7.seconds);
      const start30 = estimatedBlockAgo(latest, PERIODS.d30.seconds);
      const start1y = estimatedBlockAgo(latest, PERIODS.y1.seconds);

      const [balance, r7, r30, r1y, lifetime] = await Promise.all([
        getBalance(address, latest),
        personalForPeriod(address, latest, start7),
        personalForPeriod(address, latest, start30),
        personalForPeriod(address, latest, start1y),
        calculatePersonalReflections(address, trackingStartBlock, latest)
      ]);

      setText("walletBalance", formatToken(balance));

      setText(
        "user7d",
        r7.ready ? "+" + formatToken(r7.earned, 8) : "Collecting data"
      );

      setText(
        "user30d",
        r30.ready ? "+" + formatToken(r30.earned, 8) : "Collecting data"
      );

      setText(
        "user1y",
        r1y.ready ? "+" + formatToken(r1y.earned, 8) : "Collecting data"
      );

      setText(
        "userLifetime",
        "+" + formatToken(lifetime, 8)
      );

      setStatus(
        "walletStatus",
        "Buys, sells and transfers are separated from passive balance growth.",
        "success"
      );
    } catch (err) {
      console.error("Wallet reflection error:", err);

      setStatus(
        "walletStatus",
        err.message || "Unable to calculate wallet reflection history.",
        "error"
      );
    }
  }

  // ====== WALLET ======
  async function ensureBase() {
    const chainId = await window.ethereum.request({
      method: "eth_chainId"
    });

    if (chainId.toLowerCase() === BASE_CHAIN_ID_HEX) {
      return;
    }

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_ID_HEX }]
      });
    } catch (err) {
      if (err.code !== 4902) throw err;

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_CHAIN_ID_HEX,
          chainName: "Base",
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18
          },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"]
        }]
      });
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus(
        "walletStatus",
        "No browser wallet detected. Open in MetaMask/Coinbase Wallet or install a compatible wallet.",
        "error"
      );
      return;
    }

    try {
      setConnectButtons("Connecting…", true);

      await ensureBase();

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts"
      });

      const address = accounts?.[0];

      if (!address) {
        throw new Error("No wallet account returned.");
      }

      currentConnectedAddress = address;

      setText("walletAddress", shortAddress(address));
      setConnectButtons(shortAddress(address), false);

      await loadWallet(address);
    } catch (err) {
      console.error("Wallet connect error:", err);

      setStatus(
        "walletStatus",
        err.message || "Wallet connection failed.",
        "error"
      );

      setConnectButtons("Connect Wallet", false);
    }
  }

  // ====== INITIALISE ======
  async function initialise() {
    try {
      decimals = await getDecimals();
    } catch (err) {
      console.warn("ALT decimals lookup failed; using 18.", err);
    }

    for (const id of ["btnConnect", "btnConnect2"]) {
      const button = $(id);
      if (button) button.addEventListener("click", connectWallet);
    }

    await loadGlobalApr();

    // Reflection values do not need second-by-second refreshing.
    refreshTimer = setInterval(async () => {
      await loadGlobalApr();

      if (currentConnectedAddress) {
        await loadWallet(currentConnectedAddress);
      }
    }, 5 * 60 * 1000);

    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", async (accounts) => {
        if (!accounts?.length) {
          currentConnectedAddress = null;

          setText("walletAddress", "Wallet not connected");
          setText("walletBalance", "—");
          setText("user7d", "—");
          setText("user30d", "—");
          setText("user1y", "—");
          setText("userLifetime", "—");
          setStatus(
            "walletStatus",
            "Connect a Base wallet to view your reflection history."
          );
          setConnectButtons("Connect Wallet", false);
          return;
        }

        currentConnectedAddress = accounts[0];
        setText("walletAddress", shortAddress(accounts[0]));
        setConnectButtons(shortAddress(accounts[0]), false);
        await loadWallet(accounts[0]);
      });

      window.ethereum.on("chainChanged", () => window.location.reload());
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialise);
  } else {
    initialise();
  }
})();
