// app.js — Altitude Reflections Dashboard V2
// Lightweight /reflections/ version
//
// ALT:
// 0x90678C02823b21772fa7e91b27ee70490257567B
//
// Hidden 100 ALT benchmark wallet:
// 0x2Dc03F9e6E3CE6DAdBb472442f82f13B3F3CF767
//
// IMPORTANT:
// At Restored launch, replace RESTORED_START_BLOCK = 0n
// with the exact Base block where reflections are activated.

// ============================================================
// CONFIG
// ============================================================

const TOKEN_ADDRESS =
  "0x90678c02823b21772fa7e91b27ee70490257567b";

const REFERENCE_WALLET =
  "0x2dc03f9e6e3ce6dadbb472442f82f13b3f3cf767";

const RPC_URL =
  "https://base-mainnet.g.alchemy.com/v2/alch__zE5qmVQGBJgMK0e_KRAm";

// When Restored goes live, replace 0n with the actual Base block.
const RESTORED_START_BLOCK = 0n;

// Temporary test mode:
// how far back we look for the benchmark wallet's first ALT transfer.
const AUTO_SEED_SCAN_DAYS = 90n;

// Base averages roughly 2 second blocks.
const APPROX_BLOCK_SECONDS = 2n;

const BASE_CHAIN_ID_HEX = "0x2105";

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const BALANCE_OF_SELECTOR = "70a08231";
const DECIMALS_SELECTOR = "313ce567";


// ============================================================
// STATE
// ============================================================

let tokenDecimals = 18;

let latestBlock = 0n;
let trackingStartBlock = 0n;

let connectedAddress = null;

let walletProvider = null;

// Historical balance cache.
// Key = address:block
const balanceCache = new Map();


// ============================================================
// DOM HELPERS
// ============================================================

const $ = (id) =>
  document.getElementById(id);


function setText(id, value) {
  const el = $(id);

  if (el) {
    el.textContent = value;
  }
}


function setStatus(
  id,
  message,
  state = ""
) {
  const el = $(id);

  if (!el) {
    return;
  }

  el.textContent = message;

  el.classList.remove(
    "success",
    "error",
    "loading"
  );

  if (state) {
    el.classList.add(state);
  }
}


function shortAddress(address) {
  return (
    address.slice(0, 6) +
    "…" +
    address.slice(-4)
  );
}


function setConnectButtons(
  text,
  disabled = false
) {
  const ids = [
    "btnConnect",
    "btnConnect2"
  ];

  for (const id of ids) {
    const btn = $(id);

    if (!btn) {
      continue;
    }

    btn.textContent = text;
    btn.disabled = disabled;
  }
}


// ============================================================
// FORMATTERS
// ============================================================

function formatPercent(value) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  if (value === 0) {
    return "0.00%";
  }

  if (Math.abs(value) < 0.01) {
    return value.toFixed(4) + "%";
  }

  return value.toFixed(2) + "%";
}


function formatAlt(
  value,
  maxDecimals = 8
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return "—";
  }

  if (value === 0) {
    return "0 ALT";
  }

  const tiny =
    1 / (10 ** maxDecimals);

  if (
    value > 0 &&
    value < tiny
  ) {
    return (
      "<" +
      tiny.toFixed(maxDecimals) +
      " ALT"
    );
  }

  return (
    value.toLocaleString(
      undefined,
      {
        maximumFractionDigits:
          maxDecimals
      }
    ) +
    " ALT"
  );
}


// ============================================================
// BASIC RPC
// ============================================================

async function rpc(
  method,
  params
) {
  const response =
    await fetch(
      RPC_URL,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify({
          jsonrpc: "2.0",
          id:
            Date.now() +
            Math.floor(
              Math.random() * 1000
            ),
          method,
          params
        })
      }
    );

  if (!response.ok) {
    throw new Error(
      `Base RPC HTTP ${response.status}`
    );
  }

  const json =
    await response.json();

  if (json.error) {
    throw new Error(
      json.error.message ||
      "Base RPC error"
    );
  }

  return json.result;
}


function blockTag(block) {
  return (
    "0x" +
    block.toString(16)
  );
}


function addressTopic(address) {
  return (
    "0x" +
    address
      .toLowerCase()
      .replace(/^0x/, "")
      .padStart(64, "0")
  );
}


function encodeBalanceOf(address) {
  return (
    "0x" +
    BALANCE_OF_SELECTOR +
    address
      .toLowerCase()
      .replace(/^0x/, "")
      .padStart(64, "0")
  );
}


async function ethCall(
  data,
  block = "latest"
) {
  return rpc(
    "eth_call",
    [
      {
        to: TOKEN_ADDRESS,
        data
      },

      typeof block === "bigint"
        ? blockTag(block)
        : block
    ]
  );
}


// ============================================================
// BLOCK / TOKEN READS
// ============================================================

async function getLatestBlock() {
  const raw =
    await rpc(
      "eth_blockNumber",
      []
    );

  latestBlock =
    BigInt(raw);

  return latestBlock;
}


async function getTokenDecimals() {
  try {
    const raw =
      await ethCall(
        "0x" +
        DECIMALS_SELECTOR
      );

    tokenDecimals =
      Number(BigInt(raw));
  } catch (error) {
    console.warn(
      "Could not read decimals. Using 18.",
      error
    );

    tokenDecimals = 18;
  }
}


function rawToNumber(raw) {
  return (
    Number(raw) /
    (10 ** tokenDecimals)
  );
}


async function getBalanceRaw(
  address,
  block = "latest"
) {
  const cacheKey =
    typeof block === "bigint"
      ? (
          address.toLowerCase() +
          ":" +
          block.toString()
        )
      : null;

  if (
    cacheKey &&
    balanceCache.has(cacheKey)
  ) {
    return balanceCache.get(
      cacheKey
    );
  }

  const raw =
    await ethCall(
      encodeBalanceOf(address),
      block
    );

  const value =
    BigInt(raw);

  if (cacheKey) {
    balanceCache.set(
      cacheKey,
      value
    );
  }

  return value;
}


async function getBalance(
  address,
  block = "latest"
) {
  return rawToNumber(
    await getBalanceRaw(
      address,
      block
    )
  );
}


// ============================================================
// BLOCK ESTIMATION
// ============================================================

function blocksForSeconds(seconds) {
  return (
    seconds /
    APPROX_BLOCK_SECONDS
  );
}


function blockAgo(
  currentBlock,
  secondsAgo
) {
  const blocksAgo =
    blocksForSeconds(
      secondsAgo
    );

  if (
    currentBlock >
    blocksAgo
  ) {
    return (
      currentBlock -
      blocksAgo
    );
  }

  return 0n;
}


function estimatedDaysBetween(
  startBlock,
  endBlock
) {
  if (
    endBlock <=
    startBlock
  ) {
    return 0;
  }

  const blocks =
    endBlock -
    startBlock;

  const seconds =
    blocks *
    APPROX_BLOCK_SECONDS;

  return (
    Number(seconds) /
    86400
  );
}


// ============================================================
// LOG QUERY
// ============================================================

async function getLogs(
  filter
) {
  return rpc(
    "eth_getLogs",
    [filter]
  );
}


// Query logs in smaller chunks.
// This avoids giant requests and keeps Alchemy happier.
async function getLogsChunked(
  baseFilter,
  fromBlock,
  toBlock,
  chunkSize = 500000n
) {
  if (
    fromBlock >
    toBlock
  ) {
    return [];
  }

  const allLogs = [];

  let start =
    fromBlock;

  while (
    start <=
    toBlock
  ) {
    let end =
      start +
      chunkSize -
      1n;

    if (
      end >
      toBlock
    ) {
      end =
        toBlock;
    }

    const logs =
      await getLogs({
        ...baseFilter,

        fromBlock:
          blockTag(start),

        toBlock:
          blockTag(end)
      });

    allLogs.push(
      ...logs
    );

    start =
      end + 1n;
  }

  return allLogs;
}


// ============================================================
// BENCHMARK START DISCOVERY
// ============================================================

async function findBenchmarkSeedBlock(
  currentBlock
) {
  if (
    RESTORED_START_BLOCK >
    0n
  ) {
    return RESTORED_START_BLOCK;
  }

  const scanSeconds =
    AUTO_SEED_SCAN_DAYS *
    24n *
    60n *
    60n;

  const oldestBlock =
    blockAgo(
      currentBlock,
      scanSeconds
    );

  const targetTopic =
    addressTopic(
      REFERENCE_WALLET
    );

  // Search forwards in manageable chunks.
  // Once we find an incoming benchmark transfer,
  // that becomes the temporary test baseline.
  const chunkSize =
    300000n;

  let start =
    oldestBlock;

  let earliest =
    null;

  while (
    start <=
    currentBlock
  ) {
    let end =
      start +
      chunkSize -
      1n;

    if (
      end >
      currentBlock
    ) {
      end =
        currentBlock;
    }

    const logs =
      await getLogs({
        address:
          TOKEN_ADDRESS,

        fromBlock:
          blockTag(start),

        toBlock:
          blockTag(end),

        topics: [
          TRANSFER_TOPIC,
          null,
          targetTopic
        ]
      });

    if (
      logs &&
      logs.length
    ) {
      logs.sort(
        (a, b) => {
          const aa =
            BigInt(
              a.blockNumber
            );

          const bb =
            BigInt(
              b.blockNumber
            );

          if (aa < bb) {
            return -1;
          }

          if (aa > bb) {
            return 1;
          }

          return 0;
        }
      );

      earliest =
        BigInt(
          logs[0].blockNumber
        );

      break;
    }

    start =
      end + 1n;
  }

  if (
    earliest === null
  ) {
    throw new Error(
      "Benchmark seed transfer not found."
    );
  }

  return earliest;
}


// ============================================================
// GLOBAL REFLECTION APR
// ============================================================

function annualise(
  returnFraction,
  days
) {
  if (
    days <= 0
  ) {
    return 0;
  }

  return (
    returnFraction *
    (365 / days) *
    100
  );
}


async function calculateBenchmarkApr(
  startBlock,
  endBlock,
  days
) {
  const [
    startBalance,
    endBalance
  ] =
    await Promise.all([
      getBalance(
        REFERENCE_WALLET,
        startBlock
      ),

      getBalance(
        REFERENCE_WALLET,
        endBlock
      )
    ]);

  if (
    startBalance <= 0
  ) {
    throw new Error(
      "Benchmark start balance is zero."
    );
  }

  const returnFraction =
    (
      endBalance /
      startBalance
    ) - 1;

  return annualise(
    returnFraction,
    days
  );
}


async function loadGlobalApr() {
  setStatus(
    "globalStatus",
    "Reading reflection benchmark…",
    "loading"
  );

  try {
    const current =
      await getLatestBlock();

    if (
      trackingStartBlock ===
      0n
    ) {
      trackingStartBlock =
        await findBenchmarkSeedBlock(
          current
        );
    }

    const trackerAgeDays =
      estimatedDaysBetween(
        trackingStartBlock,
        current
      );

    if (
      RESTORED_START_BLOCK >
      0n
    ) {
      setText(
        "trackingNotice",
        "LIVE RESTORED TRACKING · Reflection performance is measured from the Restored activation block."
      );
    } else {
      setText(
        "trackingNotice",
        "TEST TRACKING · The benchmark wallet is being used as the temporary reflection baseline. At Restored launch this will be replaced by the exact activation block."
      );
    }

    // --------------------------------------------------------
    // SINCE TRACKER STARTED
    // --------------------------------------------------------

    const [
      startBalance,
      currentBalance
    ] =
      await Promise.all([
        getBalance(
          REFERENCE_WALLET,
          trackingStartBlock
        ),

        getBalance(
          REFERENCE_WALLET,
          current
        )
      ]);

    let sinceApr = 0;

    if (
      startBalance > 0 &&
      trackerAgeDays > 0
    ) {
      const growth =
        (
          currentBalance /
          startBalance
        ) - 1;

      sinceApr =
        annualise(
          growth,
          trackerAgeDays
        );
    }

    setText(
      "aprMain",
      formatPercent(
        sinceApr
      )
    );

    setText(
      "aprMainLabel",
      "Annualised Since Tracker Started"
    );


    // --------------------------------------------------------
    // 7 DAYS
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 7
    ) {
      const start7 =
        blockAgo(
          current,
          7n *
          24n *
          60n *
          60n
        );

      const apr7 =
        await calculateBenchmarkApr(
          start7,
          current,
          7
        );

      setText(
        "apr7d",
        formatPercent(
          apr7
        )
      );
    } else {
      setText(
        "apr7d",
        "Collecting data"
      );
    }


    // --------------------------------------------------------
    // 30 DAYS
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 30
    ) {
      const start30 =
        blockAgo(
          current,
          30n *
          24n *
          60n *
          60n
        );

      const apr30 =
        await calculateBenchmarkApr(
          start30,
          current,
          30
        );

      setText(
        "apr30d",
        formatPercent(
          apr30
        )
      );

      // Once we have a genuine 30-day period,
      // make that the headline number.
      setText(
        "aprMain",
        formatPercent(
          apr30
        )
      );

      setText(
        "aprMainLabel",
        "30 Day Reflection APR"
      );
    } else {
      setText(
        "apr30d",
        "Collecting data"
      );
    }


    // --------------------------------------------------------
    // 1 YEAR
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 365
    ) {
      const startYear =
        blockAgo(
          current,
          365n *
          24n *
          60n *
          60n
        );

      const aprYear =
        await calculateBenchmarkApr(
          startYear,
          current,
          365
        );

      setText(
        "apr1y",
        formatPercent(
          aprYear
        )
      );
    } else {
      setText(
        "apr1y",
        "Collecting data"
      );
    }

    setStatus(
      "globalStatus",
      `Benchmark active for approximately ${trackerAgeDays.toFixed(1)} days.`,
      "success"
    );

  } catch (error) {
    console.error(
      "Global APR error:",
      error
    );

    setText(
      "aprMain",
      "Unavailable"
    );

    setText(
      "aprMainLabel",
      "Reflection history unavailable"
    );

    setText(
      "apr7d",
      "—"
    );

    setText(
      "apr30d",
      "—"
    );

    setText(
      "apr1y",
      "—"
    );

    setStatus(
      "globalStatus",
      error.message ||
      "Unable to read reflection benchmark.",
      "error"
    );
  }
}


// ============================================================
// WALLET TRANSFER HISTORY
// ============================================================

async function getWalletTransfers(
  address,
  fromBlock,
  toBlock
) {
  const topic =
    addressTopic(address);

  const incomingFilter = {
    address:
      TOKEN_ADDRESS,

    topics: [
      TRANSFER_TOPIC,
      null,
      topic
    ]
  };

  const outgoingFilter = {
    address:
      TOKEN_ADDRESS,

    topics: [
      TRANSFER_TOPIC,
      topic
    ]
  };

  // Run them sequentially rather than blasting RPC concurrently.
  const incoming =
    await getLogsChunked(
      incomingFilter,
      fromBlock,
      toBlock
    );

  const outgoing =
    await getLogsChunked(
      outgoingFilter,
      fromBlock,
      toBlock
    );

  const unique =
    new Map();

  for (
    const log of
    incoming.concat(outgoing)
  ) {
    const key =
      (
        log.transactionHash ||
        ""
      ) +
      ":" +
      (
        log.logIndex ||
        ""
      );

    unique.set(
      key,
      log
    );
  }

  const logs =
    [...unique.values()];

  logs.sort(
    (a, b) => {
      const blockA =
        BigInt(
          a.blockNumber
        );

      const blockB =
        BigInt(
          b.blockNumber
        );

      if (
        blockA <
        blockB
      ) {
        return -1;
      }

      if (
        blockA >
        blockB
      ) {
        return 1;
      }

      return 0;
    }
  );

  return logs;
}


function uniqueActivityBlocks(
  logs
) {
  const set =
    new Set();

  for (
    const log of logs
  ) {
    set.add(
      BigInt(
        log.blockNumber
      ).toString()
    );
  }

  return (
    [...set]
      .map(
        value =>
          BigInt(value)
      )
      .sort(
        (a, b) =>
          a < b
            ? -1
            : a > b
              ? 1
              : 0
      )
  );
}


// ============================================================
// PERSONAL REFLECTION CALCULATION
// ============================================================

async function calculateReflections(
  address,
  startBlock,
  endBlock,
  allActivityBlocks
) {
  if (
    startBlock >=
    endBlock
  ) {
    return 0;
  }

  const relevantBlocks =
    allActivityBlocks.filter(
      block =>
        block >
          startBlock &&
        block <=
          endBlock
    );

  let earned = 0;

  let checkpointBlock =
    startBlock;

  let [
    checkpointUserBalance,
    checkpointReferenceBalance
  ] =
    await Promise.all([
      getBalance(
        address,
        checkpointBlock
      ),

      getBalance(
        REFERENCE_WALLET,
        checkpointBlock
      )
    ]);


  // ----------------------------------------------------------
  // Each wallet transfer becomes a checkpoint.
  //
  // Balance growth between checkpoints is treated as reflections.
  // The actual buy/sell/transfer itself is excluded.
  // ----------------------------------------------------------

  for (
    const activityBlock
    of relevantBlocks
  ) {
    const beforeBlock =
      activityBlock > 0n
        ? activityBlock - 1n
        : activityBlock;

    if (
      beforeBlock >
      checkpointBlock
    ) {
      const beforeReference =
        await getBalance(
          REFERENCE_WALLET,
          beforeBlock
        );

      if (
        checkpointUserBalance >
          0 &&
        checkpointReferenceBalance >
          0 &&
        beforeReference >=
          checkpointReferenceBalance
      ) {
        const growthFactor =
          beforeReference /
          checkpointReferenceBalance;

        earned +=
          checkpointUserBalance *
          (
            growthFactor - 1
          );
      }
    }

    // Reset balances after the user's transaction.
    [
      checkpointUserBalance,
      checkpointReferenceBalance
    ] =
      await Promise.all([
        getBalance(
          address,
          activityBlock
        ),

        getBalance(
          REFERENCE_WALLET,
          activityBlock
        )
      ]);

    checkpointBlock =
      activityBlock;
  }


  // ----------------------------------------------------------
  // Final segment from last wallet activity → current block
  // ----------------------------------------------------------

  if (
    endBlock >
    checkpointBlock
  ) {
    const finalReference =
      await getBalance(
        REFERENCE_WALLET,
        endBlock
      );

    if (
      checkpointUserBalance >
        0 &&
      checkpointReferenceBalance >
        0 &&
      finalReference >=
        checkpointReferenceBalance
    ) {
      const growthFactor =
        finalReference /
        checkpointReferenceBalance;

      earned +=
        checkpointUserBalance *
        (
          growthFactor - 1
        );
    }
  }

  return Math.max(
    0,
    earned
  );
}


// ============================================================
// LOAD CONNECTED WALLET HISTORY
// ============================================================

async function loadWalletHistory(
  address
) {
  try {
    if (
      trackingStartBlock ===
      0n
    ) {
      setStatus(
        "walletStatus",
        "Waiting for reflection tracker baseline…",
        "loading"
      );

      const current =
        await getLatestBlock();

      trackingStartBlock =
        await findBenchmarkSeedBlock(
          current
        );
    }

    const current =
      await getLatestBlock();

    const trackerAgeDays =
      estimatedDaysBetween(
        trackingStartBlock,
        current
      );

    setStatus(
      "walletStatus",
      "Reading your ALT transaction history…",
      "loading"
    );

    // --------------------------------------------------------
    // One transfer-history query.
    // Reuse these activity blocks for all reflection periods.
    // --------------------------------------------------------

    const logs =
      await getWalletTransfers(
        address,
        trackingStartBlock,
        current
      );

    const activityBlocks =
      uniqueActivityBlocks(
        logs
      );


    // --------------------------------------------------------
    // SINCE TRACKER START
    // --------------------------------------------------------

    setText(
      "userLifetime",
      "Calculating…"
    );

    const lifetime =
      await calculateReflections(
        address,
        trackingStartBlock,
        current,
        activityBlocks
      );

    setText(
      "userLifetime",
      "+" +
      formatAlt(
        lifetime
      )
    );


    // --------------------------------------------------------
    // 7 DAYS
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 7
    ) {
      setText(
        "user7d",
        "Calculating…"
      );

      const start7 =
        blockAgo(
          current,
          7n *
          24n *
          60n *
          60n
        );

      const earned7 =
        await calculateReflections(
          address,
          start7,
          current,
          activityBlocks
        );

      setText(
        "user7d",
        "+" +
        formatAlt(
          earned7
        )
      );
    } else {
      setText(
        "user7d",
        "Collecting data"
      );
    }


    // --------------------------------------------------------
    // 30 DAYS
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 30
    ) {
      setText(
        "user30d",
        "Calculating…"
      );

      const start30 =
        blockAgo(
          current,
          30n *
          24n *
          60n *
          60n
        );

      const earned30 =
        await calculateReflections(
          address,
          start30,
          current,
          activityBlocks
        );

      setText(
        "user30d",
        "+" +
        formatAlt(
          earned30
        )
      );
    } else {
      setText(
        "user30d",
        "Collecting data"
      );
    }


    // --------------------------------------------------------
    // 1 YEAR
    // --------------------------------------------------------

    if (
      trackerAgeDays >= 365
    ) {
      setText(
        "user1y",
        "Calculating…"
      );

      const startYear =
        blockAgo(
          current,
          365n *
          24n *
          60n *
          60n
        );

      const earnedYear =
        await calculateReflections(
          address,
          startYear,
          current,
          activityBlocks
        );

      setText(
        "user1y",
        "+" +
        formatAlt(
          earnedYear
        )
      );
    } else {
      setText(
        "user1y",
        "Collecting data"
      );
    }


    setStatus(
      "walletStatus",
      `Reflection history calculated using ${activityBlocks.length} wallet activity checkpoint${activityBlocks.length === 1 ? "" : "s"}.`,
      "success"
    );

  } catch (error) {
    console.error(
      "Wallet history error:",
      error
    );

    setStatus(
      "walletStatus",
      error.message ||
      "Reflection history temporarily unavailable.",
      "error"
    );
  }
}


// ============================================================
// FAST CURRENT WALLET BALANCE
// ============================================================

async function loadCurrentWalletBalance(
  address
) {
  try {
    // This is intentionally independent of the historical APR loader.
    //
    // Even if historical RPC analytics fail,
    // the connected-wallet experience still works.

    const data =
      encodeBalanceOf(
        address
      );

    let raw;

    if (walletProvider) {
      raw =
        await walletProvider.request({
          method: "eth_call",

          params: [
            {
              to:
                TOKEN_ADDRESS,
              data
            },
            "latest"
          ]
        });
    } else {
      raw =
        await ethCall(
          data,
          "latest"
        );
    }

    const balance =
      rawToNumber(
        BigInt(raw)
      );

    setText(
      "walletBalance",
      formatAlt(
        balance,
        6
      )
    );

  } catch (error) {
    console.error(
      "Current balance error:",
      error
    );

    setText(
      "walletBalance",
      "Unavailable"
    );
  }
}


// ============================================================
// BASE NETWORK
// ============================================================

async function ensureBase() {
  if (
    !window.ethereum
  ) {
    throw new Error(
      "No browser wallet detected."
    );
  }

  const chainId =
    await window.ethereum.request({
      method:
        "eth_chainId"
    });

  if (
    chainId.toLowerCase() ===
    BASE_CHAIN_ID_HEX
  ) {
    return;
  }

  try {
    await window.ethereum.request({
      method:
        "wallet_switchEthereumChain",

      params: [
        {
          chainId:
            BASE_CHAIN_ID_HEX
        }
      ]
    });

  } catch (error) {

    if (
      error.code !==
      4902
    ) {
      throw error;
    }

    await window.ethereum.request({
      method:
        "wallet_addEthereumChain",

      params: [
        {
          chainId:
            BASE_CHAIN_ID_HEX,

          chainName:
            "Base",

          nativeCurrency: {
            name:
              "Ether",
            symbol:
              "ETH",
            decimals:
              18
          },

          rpcUrls: [
            "https://mainnet.base.org"
          ],

          blockExplorerUrls: [
            "https://basescan.org"
          ]
        }
      ]
    });
  }
}


// ============================================================
// CONNECT WALLET
// ============================================================

async function connectWallet() {
  if (
    !window.ethereum
  ) {
    setStatus(
      "walletStatus",
      "No compatible wallet detected. Install MetaMask or Coinbase Wallet.",
      "error"
    );

    return;
  }

  try {
    setConnectButtons(
      "Connecting…",
      true
    );

    walletProvider =
      window.ethereum;

    await ensureBase();

    const accounts =
      await walletProvider.request({
        method:
          "eth_requestAccounts"
      });

    if (
      !accounts ||
      !accounts.length
    ) {
      throw new Error(
        "No wallet account returned."
      );
    }

    connectedAddress =
      accounts[0];

    setText(
      "walletAddress",
      shortAddress(
        connectedAddress
      )
    );

    setConnectButtons(
      shortAddress(
        connectedAddress
      ),
      false
    );

    // --------------------------------------------------------
    // FIRST:
    // show current wallet balance immediately.
    // --------------------------------------------------------

    setStatus(
      "walletStatus",
      "Wallet connected. Loading current ALT balance…",
      "loading"
    );

    await loadCurrentWalletBalance(
      connectedAddress
    );


    // --------------------------------------------------------
    // SECOND:
    // historical analytics run separately.
    // A failure here cannot disconnect the wallet.
    // --------------------------------------------------------

    setStatus(
      "walletStatus",
      "Wallet connected. Calculating reflection history…",
      "loading"
    );

    loadWalletHistory(
      connectedAddress
    );

  } catch (error) {
    console.error(
      "Wallet connection error:",
      error
    );

    setConnectButtons(
      "Connect Wallet",
      false
    );

    setStatus(
      "walletStatus",
      error.shortMessage ||
      error.message ||
      "Wallet connection failed.",
      "error"
    );
  }
}


// ============================================================
// ACCOUNT CHANGES
// ============================================================

async function handleAccountsChanged(
  accounts
) {
  if (
    !accounts ||
    !accounts.length
  ) {
    connectedAddress =
      null;

    setConnectButtons(
      "Connect Wallet",
      false
    );

    setText(
      "walletAddress",
      "Wallet not connected"
    );

    setText(
      "walletBalance",
      "—"
    );

    setText(
      "user7d",
      "—"
    );

    setText(
      "user30d",
      "—"
    );

    setText(
      "user1y",
      "—"
    );

    setText(
      "userLifetime",
      "—"
    );

    setStatus(
      "walletStatus",
      "Connect a Base wallet to view your reflection history."
    );

    return;
  }

  connectedAddress =
    accounts[0];

  setText(
    "walletAddress",
    shortAddress(
      connectedAddress
    )
  );

  setConnectButtons(
    shortAddress(
      connectedAddress
    ),
    false
  );

  await loadCurrentWalletBalance(
    connectedAddress
  );

  loadWalletHistory(
    connectedAddress
  );
}


// ============================================================
// INITIAL PAGE LOAD
// ============================================================

async function initialise() {
  // IMPORTANT:
  // Bind wallet buttons FIRST.
  //
  // The wallet remains usable even if Alchemy/history fails.
  const connect1 =
    $("btnConnect");

  const connect2 =
    $("btnConnect2");

  if (connect1) {
    connect1.addEventListener(
      "click",
      connectWallet
    );
  }

  if (connect2) {
    connect2.addEventListener(
      "click",
      connectWallet
    );
  }


  // Wallet event listeners also initialise independently.
  if (
    window.ethereum &&
    window.ethereum.on
  ) {
    window.ethereum.on(
      "accountsChanged",
      handleAccountsChanged
    );

    window.ethereum.on(
      "chainChanged",
      () => {
        window.location.reload();
      }
    );
  }


  // Token decimals is a lightweight call.
  await getTokenDecimals();


  // Start the global reflection dashboard separately.
  //
  // DO NOT await it before enabling the wallet.
  loadGlobalApr();
}


// ============================================================
// START
// ============================================================

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initialise
  );
} else {
  initialise();
}
