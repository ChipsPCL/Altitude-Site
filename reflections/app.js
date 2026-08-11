// app.js — Altitude Reflections Dashboard V3
// Alchemy Transfers API version
//
// ALT:
// 0x90678C02823b21772fa7e91b27ee70490257567B
//
// Hidden 100 ALT benchmark wallet:
// 0x2Dc03F9e6E3CE6DAdBb472442f82f13B3F3CF767
//
// This version does NOT use eth_getLogs.
// Wallet transfer history comes from alchemy_getAssetTransfers.

// ============================================================
// CONFIG
// ============================================================

const TOKEN_ADDRESS =
  "0x90678c02823b21772fa7e91b27ee70490257567b";

const REFERENCE_WALLET =
  "0x2dc03f9e6e3ce6dadbb472442f82f13b3f3cf767";

const RPC_URL =
  "https://base-mainnet.g.alchemy.com/v2/alch__zE5qmVQGBJgMK0e_KRAm";

// At Restored launch:
//
// Change this from 0n to the exact Base block where
// the restored reflection system goes live.
//
// Until then, the dApp automatically uses the first ALT
// transfer into the benchmark wallet as the test baseline.

const RESTORED_START_BLOCK = 0n;

const BASE_CHAIN_ID_HEX = "0x2105";

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


// Cache historical balances so the same block is not
// repeatedly requested during 7D / 30D / 1Y calculations.

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
  for (
    const id of
    ["btnConnect", "btnConnect2"]
  ) {
    const button = $(id);

    if (!button) {
      continue;
    }

    button.textContent = text;

    button.disabled = disabled;
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

  if (
    Math.abs(value) <
    0.01
  ) {
    return (
      value.toFixed(4) +
      "%"
    );
  }

  return (
    value.toFixed(2) +
    "%"
  );
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
    1 /
    (10 ** maxDecimals);

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
// ALCHEMY RPC
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
              Math.random() *
              10000
            ),

          method,

          params
        })
      }
    );

  if (!response.ok) {
    let detail = "";

    try {
      detail =
        await response.text();
    } catch {}

    console.error(
      "Alchemy HTTP error:",
      response.status,
      detail
    );

    throw new Error(
      `Alchemy HTTP ${response.status}`
    );
  }

  const json =
    await response.json();

  if (json.error) {
    console.error(
      "Alchemy RPC error:",
      json.error
    );

    throw new Error(
      json.error.message ||
      "Alchemy RPC error"
    );
  }

  return json.result;
}


// ============================================================
// BASIC CONTRACT READS
// ============================================================

function blockTag(block) {
  return (
    "0x" +
    block.toString(16)
  );
}


function encodeBalanceOf(
  address
) {
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

      typeof block ===
      "bigint"
        ? blockTag(block)
        : block
    ]
  );
}


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
      Number(
        BigInt(raw)
      );

  } catch (error) {
    console.warn(
      "Decimals lookup failed. Using 18.",
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
    typeof block ===
    "bigint"
      ? (
          address.toLowerCase() +
          ":" +
          block.toString()
        )
      : null;

  if (
    cacheKey &&
    balanceCache.has(
      cacheKey
    )
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
  const raw =
    await getBalanceRaw(
      address,
      block
    );

  return rawToNumber(raw);
}


// ============================================================
// REAL BLOCK TIMESTAMPS
// ============================================================
//
// Instead of assuming Base always produces exactly one block
// every X seconds, find the historical block by timestamp.
//
// This makes 7D / 30D / 1Y considerably more accurate.
// ============================================================

async function getBlock(
  block
) {
  return rpc(
    "eth_getBlockByNumber",
    [
      typeof block === "bigint"
        ? blockTag(block)
        : block,
      false
    ]
  );
}


async function getBlockTimestamp(
  block
) {
  const data =
    await getBlock(block);

  if (!data) {
    throw new Error(
      "Unable to read block."
    );
  }

  return BigInt(
    data.timestamp
  );
}


// Find approximately the first block at or after
// a requested Unix timestamp using binary search.

async function findBlockAtTimestamp(
  targetTimestamp,
  highBlock
) {
  let low = 1n;

  let high =
    highBlock;

  while (
    low < high
  ) {
    const mid =
      (low + high) /
      2n;

    const midTimestamp =
      await getBlockTimestamp(
        mid
      );

    if (
      midTimestamp <
      targetTimestamp
    ) {
      low =
        mid + 1n;
    } else {
      high =
        mid;
    }
  }

  return low;
}


// ============================================================
// ALCHEMY TRANSFERS API
// ============================================================
//
// This replaces eth_getLogs completely.
//
// Alchemy directly tells us which ERC20 transfers involved
// the requested wallet.
// ============================================================

function isAltitudeTransfer(
  transfer
) {
  const contract =
    transfer?.rawContract
      ?.address;

  if (!contract) {
    return false;
  }

  return (
    contract.toLowerCase() ===
    TOKEN_ADDRESS
  );
}


// Fetch ONE direction:
//
// incoming:
//   toAddress = wallet
//
// outgoing:
//   fromAddress = wallet
//
// Alchemy can paginate large histories using pageKey.

async function fetchTransferDirection(
  address,
  direction,
  fromBlock = "0x0",
  toBlock = "latest"
) {
  let pageKey = null;

  const collected = [];

  do {
    const request = {
      fromBlock:
        typeof fromBlock ===
        "bigint"
          ? blockTag(fromBlock)
          : fromBlock,

      toBlock:
        typeof toBlock ===
        "bigint"
          ? blockTag(toBlock)
          : toBlock,

      category: [
        "erc20"
      ],

      withMetadata: false,

      excludeZeroValue: false,

      maxCount: "0x3e8"
    };


    if (
      direction ===
      "incoming"
    ) {
      request.toAddress =
        address;
    } else {
      request.fromAddress =
        address;
    }


    if (pageKey) {
      request.pageKey =
        pageKey;
    }


    const result =
      await rpc(
        "alchemy_getAssetTransfers",
        [request]
      );


    const transfers =
      result?.transfers ||
      [];


    for (
      const transfer of
      transfers
    ) {
      if (
        isAltitudeTransfer(
          transfer
        )
      ) {
        collected.push(
          transfer
        );
      }
    }


    pageKey =
      result?.pageKey ||
      null;

  } while (pageKey);


  return collected;
}


// Fetch both incoming and outgoing ALT transfers
// for one wallet.

async function getAltitudeTransfers(
  address,
  fromBlock = "0x0",
  toBlock = "latest"
) {
  // Sequential deliberately:
  // we don't need to burst the free RPC.

  const incoming =
    await fetchTransferDirection(
      address,
      "incoming",
      fromBlock,
      toBlock
    );


  const outgoing =
    await fetchTransferDirection(
      address,
      "outgoing",
      fromBlock,
      toBlock
    );


  const unique =
    new Map();


  for (
    const transfer of
    incoming.concat(
      outgoing
    )
  ) {
    const key =
      transfer.uniqueId ||
      (
        transfer.hash +
        ":" +
        transfer.blockNum +
        ":" +
        transfer.from +
        ":" +
        transfer.to
      );


    unique.set(
      key,
      transfer
    );
  }


  const transfers =
    [...unique.values()];


  transfers.sort(
    (a, b) => {
      const aa =
        BigInt(
          a.blockNum
        );

      const bb =
        BigInt(
          b.blockNum
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


  return transfers;
}


function activityBlocksFromTransfers(
  transfers
) {
  const unique =
    new Set();


  for (
    const transfer of
    transfers
  ) {
    unique.add(
      BigInt(
        transfer.blockNum
      ).toString()
    );
  }


  return (
    [...unique]
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
// FIND BENCHMARK SEED
// ============================================================
//
// No log scanning.
//
// Ask Alchemy:
// "Show me ERC20 transfers TO this benchmark wallet."
//
// Then find the first ALT transfer.
// ============================================================

async function findBenchmarkSeedBlock() {
  if (
    RESTORED_START_BLOCK >
    0n
  ) {
    return RESTORED_START_BLOCK;
  }


  const transfers =
    await fetchTransferDirection(
      REFERENCE_WALLET,
      "incoming",
      "0x0",
      "latest"
    );


  if (
    !transfers.length
  ) {
    throw new Error(
      "Benchmark ALT seed transfer not found."
    );
  }


  transfers.sort(
    (a, b) => {
      const aa =
        BigInt(
          a.blockNum
        );

      const bb =
        BigInt(
          b.blockNum
        );

      return (
        aa < bb
          ? -1
          : aa > bb
            ? 1
            : 0
      );
    }
  );


  return BigInt(
    transfers[0].blockNum
  );
}


// ============================================================
// ENSURE BENCHMARK HAS NOT BEEN CONTAMINATED
// ============================================================
//
// The benchmark wallet should receive its original seed,
// then never intentionally send/receive ALT again.
//
// Reflections themselves do NOT create Transfer events.
// ============================================================

async function checkBenchmarkClean(
  startBlock,
  endBlock
) {
  const afterSeed =
    startBlock + 1n;


  if (
    afterSeed >
    endBlock
  ) {
    return true;
  }


  const transfers =
    await getAltitudeTransfers(
      REFERENCE_WALLET,
      afterSeed,
      endBlock
    );


  if (
    transfers.length >
    0
  ) {
    throw new Error(
      "Benchmark wallet has had an ALT transfer since tracking began. APR paused to protect accuracy."
    );
  }


  return true;
}


// ============================================================
// TRACKER INITIALISATION
// ============================================================

async function ensureTrackingStart() {
  if (
    trackingStartBlock >
    0n
  ) {
    return trackingStartBlock;
  }


  trackingStartBlock =
    await findBenchmarkSeedBlock();


  return trackingStartBlock;
}


// ============================================================
// APR MATHS
// ============================================================

function annualiseSimple(
  returnFraction,
  elapsedDays
) {
  if (
    elapsedDays <= 0
  ) {
    return 0;
  }


  return (
    returnFraction *
    (
      365 /
      elapsedDays
    ) *
    100
  );
}


function daysBetweenTimestamps(
  startTimestamp,
  endTimestamp
) {
  return (
    Number(
      endTimestamp -
      startTimestamp
    ) /
    86400
  );
}


async function benchmarkAprBetween(
  startBlock,
  endBlock
) {
  const [
    startBalance,
    endBalance,
    startTimestamp,
    endTimestamp
  ] =
    await Promise.all([
      getBalance(
        REFERENCE_WALLET,
        startBlock
      ),

      getBalance(
        REFERENCE_WALLET,
        endBlock
      ),

      getBlockTimestamp(
        startBlock
      ),

      getBlockTimestamp(
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


  const elapsedDays =
    daysBetweenTimestamps(
      startTimestamp,
      endTimestamp
    );


  const returnFraction =
    (
      endBalance /
      startBalance
    ) - 1;


  return {
    apr:
      annualiseSimple(
        returnFraction,
        elapsedDays
      ),

    returnPct:
      returnFraction *
      100,

    days:
      elapsedDays,

    startBalance,

    endBalance
  };
}


// ============================================================
// GLOBAL APR
// ============================================================

async function loadGlobalApr() {
  try {
    setStatus(
      "globalStatus",
      "Reading reflection benchmark…",
      "loading"
    );


    const current =
      await getLatestBlock();


    const start =
      await ensureTrackingStart();


    // Make sure somebody has not transferred ALT into or
    // out of the benchmark wallet after the initial seed.

    await checkBenchmarkClean(
      start,
      current
    );


    const [
      currentTimestamp,
      startTimestamp
    ] =
      await Promise.all([
        getBlockTimestamp(
          current
        ),

        getBlockTimestamp(
          start
        )
      ]);


    const trackerAgeDays =
      daysBetweenTimestamps(
        startTimestamp,
        currentTimestamp
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
        "TEST TRACKING · The untouched 100 ALT benchmark wallet is measuring live reflection performance."
      );
    }


    // ========================================================
    // SINCE TRACKER START
    // ========================================================

    const since =
      await benchmarkAprBetween(
        start,
        current
      );


    setText(
      "aprMain",
      formatPercent(
        since.apr
      )
    );


    setText(
      "aprMainLabel",
      RESTORED_START_BLOCK >
        0n
        ? "Annualised Since Restored"
        : "Annualised Since Tracker Started"
    );


    // ========================================================
    // 7 DAY APR
    // ========================================================

    if (
      trackerAgeDays >=
      7
    ) {
      const timestamp7 =
        currentTimestamp -
        (
          7n *
          86400n
        );


      const block7 =
        await findBlockAtTimestamp(
          timestamp7,
          current
        );


      const result7 =
        await benchmarkAprBetween(
          block7,
          current
        );


      setText(
        "apr7d",
        formatPercent(
          result7.apr
        )
      );

    } else {
      setText(
        "apr7d",
        "Collecting data"
      );
    }


    // ========================================================
    // 30 DAY APR
    // ========================================================

    if (
      trackerAgeDays >=
      30
    ) {
      const timestamp30 =
        currentTimestamp -
        (
          30n *
          86400n
        );


      const block30 =
        await findBlockAtTimestamp(
          timestamp30,
          current
        );


      const result30 =
        await benchmarkAprBetween(
          block30,
          current
        );


      setText(
        "apr30d",
        formatPercent(
          result30.apr
        )
      );


      // Once genuine 30-day data exists,
      // make that the headline APR.

      setText(
        "aprMain",
        formatPercent(
          result30.apr
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


    // ========================================================
    // 1 YEAR APR
    // ========================================================

    if (
      trackerAgeDays >=
      365
    ) {
      const timestamp1y =
        currentTimestamp -
        (
          365n *
          86400n
        );


      const block1y =
        await findBlockAtTimestamp(
          timestamp1y,
          current
        );


      const result1y =
        await benchmarkAprBetween(
          block1y,
          current
        );


      setText(
        "apr1y",
        formatPercent(
          result1y.apr
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
      `Benchmark active for ${trackerAgeDays.toFixed(1)} days.`,
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
      "Unable to calculate reflection APR.",
      "error"
    );
  }
}


// ============================================================
// PERSONAL REFLECTION CALCULATION
// ============================================================
//
// Principle:
//
// 1. Get user's ALT transaction blocks from Alchemy.
//
// 2. Between user transactions, their ALT balance can only
//    change through reflections.
//
// 3. Use the untouched benchmark wallet to measure the
//    reflection growth factor for that period.
//
// 4. Reset the user's balance at every transaction block,
//    preventing buys/sells/transfers being counted as rewards.
// ============================================================

async function calculateReflections(
  address,
  startBlock,
  endBlock,
  activityBlocks
) {
  if (
    startBlock >=
    endBlock
  ) {
    return 0;
  }


  const relevant =
    activityBlocks.filter(
      block =>
        block >
          startBlock &&
        block <=
          endBlock
    );


  let reflections = 0;


  let checkpointBlock =
    startBlock;


  let [
    checkpointUserBalance,
    checkpointBenchmarkBalance
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


  // ==========================================================
  // PROCESS EACH USER TRANSACTION BLOCK
  // ==========================================================

  for (
    const activityBlock of
    relevant
  ) {
    const beforeBlock =
      activityBlock >
        0n
        ? activityBlock - 1n
        : activityBlock;


    // --------------------------------------------------------
    // Passive reflection period before transaction
    // --------------------------------------------------------

    if (
      beforeBlock >
      checkpointBlock &&
      checkpointUserBalance >
        0 &&
      checkpointBenchmarkBalance >
        0
    ) {
      const benchmarkBefore =
        await getBalance(
          REFERENCE_WALLET,
          beforeBlock
        );


      const growthFactor =
        benchmarkBefore /
        checkpointBenchmarkBalance;


      if (
        growthFactor >= 1
      ) {
        reflections +=
          checkpointUserBalance *
          (
            growthFactor -
            1
          );
      }
    }


    // --------------------------------------------------------
    // Transaction happened.
    //
    // Reset to actual balances at the end of this block.
    // Therefore the transfer itself is NOT counted as a
    // reflection reward.
    // --------------------------------------------------------

    [
      checkpointUserBalance,
      checkpointBenchmarkBalance
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


  // ==========================================================
  // FINAL PASSIVE PERIOD → CURRENT BLOCK
  // ==========================================================

  if (
    endBlock >
      checkpointBlock &&
    checkpointUserBalance >
      0 &&
    checkpointBenchmarkBalance >
      0
  ) {
    const benchmarkEnd =
      await getBalance(
        REFERENCE_WALLET,
        endBlock
      );


    const growthFactor =
      benchmarkEnd /
      checkpointBenchmarkBalance;


    if (
      growthFactor >=
      1
    ) {
      reflections +=
        checkpointUserBalance *
        (
          growthFactor -
          1
        );
    }
  }


  return Math.max(
    reflections,
    0
  );
}


// ============================================================
// PERSONAL WALLET HISTORY
// ============================================================

async function loadWalletHistory(
  address
) {
  try {
    setStatus(
      "walletStatus",
      "Loading your ALT activity…",
      "loading"
    );


    const current =
      await getLatestBlock();


    const trackerStart =
      await ensureTrackingStart();


    const [
      currentTimestamp,
      trackerStartTimestamp
    ] =
      await Promise.all([
        getBlockTimestamp(
          current
        ),

        getBlockTimestamp(
          trackerStart
        )
      ]);


    const trackerAgeDays =
      daysBetweenTimestamps(
        trackerStartTimestamp,
        currentTimestamp
      );


    // ========================================================
    // GET USER'S ALT TRANSACTIONS ONCE
    // ========================================================

    setStatus(
      "walletStatus",
      "Reading your ALT transaction history…",
      "loading"
    );


    const transfers =
      await getAltitudeTransfers(
        address,
        trackerStart,
        current
      );


    const activityBlocks =
      activityBlocksFromTransfers(
        transfers
      );


    // ========================================================
    // SINCE RESTORED / TRACKER START
    // ========================================================

    setText(
      "userLifetime",
      "Calculating…"
    );


    const sinceStart =
      await calculateReflections(
        address,
        trackerStart,
        current,
        activityBlocks
      );


    setText(
      "userLifetime",
      "+" +
      formatAlt(
        sinceStart
      )
    );


    // ========================================================
    // LAST 7 DAYS
    // ========================================================

    if (
      trackerAgeDays >=
      7
    ) {
      setText(
        "user7d",
        "Calculating…"
      );


      const target7 =
        currentTimestamp -
        (
          7n *
          86400n
        );


      const block7 =
        await findBlockAtTimestamp(
          target7,
          current
        );


      const reflections7 =
        await calculateReflections(
          address,
          block7,
          current,
          activityBlocks
        );


      setText(
        "user7d",
        "+" +
        formatAlt(
          reflections7
        )
      );

    } else {
      setText(
        "user7d",
        "Collecting data"
      );
    }


    // ========================================================
    // LAST 30 DAYS
    // ========================================================

    if (
      trackerAgeDays >=
      30
    ) {
      setText(
        "user30d",
        "Calculating…"
      );


      const target30 =
        currentTimestamp -
        (
          30n *
          86400n
        );


      const block30 =
        await findBlockAtTimestamp(
          target30,
          current
        );


      const reflections30 =
        await calculateReflections(
          address,
          block30,
          current,
          activityBlocks
        );


      setText(
        "user30d",
        "+" +
        formatAlt(
          reflections30
        )
      );

    } else {
      setText(
        "user30d",
        "Collecting data"
      );
    }


    // ========================================================
    // LAST 1 YEAR
    // ========================================================

    if (
      trackerAgeDays >=
      365
    ) {
      setText(
        "user1y",
        "Calculating…"
      );


      const target1y =
        currentTimestamp -
        (
          365n *
          86400n
        );


      const block1y =
        await findBlockAtTimestamp(
          target1y,
          current
        );


      const reflections1y =
        await calculateReflections(
          address,
          block1y,
          current,
          activityBlocks
        );


      setText(
        "user1y",
        "+" +
        formatAlt(
          reflections1y
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
      `Reflection history calculated from ${activityBlocks.length} ALT activity checkpoint${activityBlocks.length === 1 ? "" : "s"}.`,
      "success"
    );

  } catch (error) {
    console.error(
      "Wallet reflection history error:",
      error
    );


    setStatus(
      "walletStatus",
      error.message ||
      "Unable to calculate reflection history.",
      "error"
    );
  }
}


// ============================================================
// FAST CURRENT WALLET BALANCE
// ============================================================
//
// Uses the connected wallet RPC.
//
// Therefore even if Alchemy history analytics fails,
// wallet connect + current ALT balance still works.
// ============================================================

async function loadCurrentWalletBalance(
  address
) {
  try {
    const data =
      encodeBalanceOf(
        address
      );


    let raw;


    if (walletProvider) {
      raw =
        await walletProvider.request({
          method:
            "eth_call",

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
      "Current wallet balance error:",
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


    // ========================================================
    // CURRENT BALANCE FIRST
    // ========================================================

    setStatus(
      "walletStatus",
      "Wallet connected. Loading ALT balance…",
      "loading"
    );


    await loadCurrentWalletBalance(
      connectedAddress
    );


    // ========================================================
    // HISTORY SECOND
    //
    // Not awaited deliberately.
    // Wallet stays responsive while analytics calculates.
    // ========================================================

    setStatus(
      "walletStatus",
      "Wallet connected. Calculating reflections…",
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
// ACCOUNT CHANGE
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
// INITIALISE
// ============================================================

async function initialise() {
  // ==========================================================
  // CONNECT BUTTONS FIRST
  //
  // RPC analytics can never block wallet functionality.
  // ==========================================================

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


  // ==========================================================
  // WALLET EVENTS
  // ==========================================================

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


  // ==========================================================
  // LIGHTWEIGHT CONTRACT INITIALISATION
  // ==========================================================

  await getTokenDecimals();


  // ==========================================================
  // GLOBAL APR
  //
  // Runs separately and never blocks wallet interaction.
  // ==========================================================

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
