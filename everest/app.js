// app.js — Everest ALT Vault (ALT stake -> ALT rewards) — BASE TEST VERSION
// Everest Test Vault: 0x42EDDCe0ab1269c8eC614A6bDc2ba16dC8445424
// ALT:                0x90678C02823b21772fa7e91B27EE70490257567B

// ====== CONFIG ======
const FARM_ADDRESS = "0x058454daD10a8d7cbE1f05e6168d61cc69AF2eaF";
const ALT = "0x90678C02823b21772fa7e91B27EE70490257567B";

const DEX_CHAIN = "base";
const PAIR_ALT_WETH = "0xd57f6e7d7ec911ba8defcf93d3682bb76959e950";

const REFRESH_MS = 30 * 1000;

// ====== ABIs ======
const farmABI = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function updatePool()",
  "function syncRewards()",

  "function pendingRewards(address user) view returns (uint256)",
  "function totalStaked() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",

  "function rewardBalance() view returns (uint256)",
  "function allocatedBalance() view returns (uint256)",
  "function availableRewards() view returns (uint256)",
  "function dailyDripEstimate() view returns (uint256)",
  "function yearlyDripEstimate() view returns (uint256)",
  "function currentAprBps() view returns (uint256)",
  "function isSolvent() view returns (bool)",
];

const erc20ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// ====== STATE ======
let provider;
let signer;
let user;
let farm;
let alt;

let tokenDecimals = 18;

let cachedAltPriceUsd = null;
let lastPriceTs = 0;
let refreshTimer = null;

// ====== DOM HELPERS ======
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);

  if (el) {
    el.innerText = text;
  }
}

function fmtUsd(n) {
  if (
    n === null ||
    Number.isNaN(n) ||
    !Number.isFinite(n)
  ) {
    return "-";
  }

  if (
    Math.abs(n) > 0 &&
    Math.abs(n) < 0.01
  ) {
    return "$" + n.toFixed(6);
  }

  return (
    "$" +
    n.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })
  );
}

function fmtPct(n) {
  if (
    n === null ||
    Number.isNaN(n) ||
    !Number.isFinite(n)
  ) {
    return "-";
  }

  return n.toFixed(2) + "%";
}

// Shows small balances without them looking like zero too early.
function fmtUnitsSmart(
  valueWei,
  decimals,
  displayDecimals = 8
) {
  try {
    const s = ethers.formatUnits(
      valueWei,
      decimals
    );

    if (!s.includes(".")) {
      return s;
    }

    const [a, b] = s.split(".");
    const cut = b.slice(
      0,
      displayDecimals
    );

    const isZeroDisplay =
      (a === "0" || a === "-0") &&
      cut.length > 0 &&
      /^0+$/.test(cut);

    if (
      isZeroDisplay &&
      valueWei > 0n
    ) {
      return (
        "<" +
        (
          1 /
          10 ** displayDecimals
        ).toFixed(displayDecimals)
      );
    }

    const trimmed =
      cut.replace(/0+$/, "");

    return trimmed.length
      ? `${a}.${trimmed}`
      : a;
  } catch {
    return "-";
  }
}

function shortAddress(address) {
  return `${address.slice(
    0,
    6
  )}…${address.slice(-4)}`;
}

function setStatus(text) {
  setText("status", text);
}

// ====== PRICE ======
async function fetchDexScreenerPair(
  chain,
  pairAddress
) {
  const url =
    `https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddress}`;

  const res = await fetch(
    url,
    {
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(
      `DexScreener HTTP ${res.status}`
    );
  }

  const data =
    await res.json();

  if (
    !data ||
    !data.pair
  ) {
    throw new Error(
      "DexScreener: missing pair"
    );
  }

  return data.pair;
}

async function updatePrice() {
  const now = Date.now();

  if (
    now - lastPriceTs < 10_000 &&
    cachedAltPriceUsd !== null
  ) {
    return;
  }

  try {
    const altPair =
      await fetchDexScreenerPair(
        DEX_CHAIN,
        PAIR_ALT_WETH
      );

    cachedAltPriceUsd =
      parseFloat(
        altPair.priceUsd
      );

    lastPriceTs = now;

    setText(
      "altPrice",
      fmtUsd(
        cachedAltPriceUsd
      )
    );
  } catch (e) {
    console.error(
      "ALT price error:",
      e
    );

    if (
      cachedAltPriceUsd === null
    ) {
      setText(
        "altPrice",
        "Unavailable"
      );
    }
  }
}

// ====== CONNECT ======
async function ensureBase() {
  if (!window.ethereum) {
    return;
  }

  const current =
    await window.ethereum.request({
      method: "eth_chainId",
    });

  if (
    current.toLowerCase() ===
    "0x2105"
  ) {
    return;
  }

  try {
    await window.ethereum.request({
      method:
        "wallet_switchEthereumChain",
      params: [
        {
          chainId: "0x2105",
        },
      ],
    });
  } catch (e) {
    if (e.code !== 4902) {
      throw e;
    }

    await window.ethereum.request({
      method:
        "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: [
            "https://mainnet.base.org",
          ],
          blockExplorerUrls: [
            "https://basescan.org",
          ],
        },
      ],
    });
  }
}

async function connect() {
  if (!window.ethereum) {
    alert(
      "No wallet found. Install MetaMask / Coinbase Wallet."
    );

    return;
  }

  try {
    await ensureBase();

    provider =
      new ethers.BrowserProvider(
        window.ethereum
      );

    await provider.send(
      "eth_requestAccounts",
      []
    );

    signer =
      await provider.getSigner();

    user =
      await signer.getAddress();

    // Same pattern as the original working USDC dApp:
    // reads and writes use the connected wallet provider.
    farm =
      new ethers.Contract(
        FARM_ADDRESS,
        farmABI,
        signer
      );

    alt =
      new ethers.Contract(
        ALT,
        erc20ABI,
        signer
      );

    tokenDecimals =
      Number(
        await alt.decimals()
      );

    setText(
      "btnConnect",
      shortAddress(user)
    );

    setStatus(
      `Connected: ${shortAddress(
        user
      )}`
    );

    await Promise.all([
      updatePrice(),
      refresh(),
    ]);

    if (refreshTimer) {
      clearInterval(
        refreshTimer
      );
    }

    refreshTimer =
      setInterval(
        async () => {
          await updatePrice();
          await refresh();
        },
        REFRESH_MS
      );
  } catch (e) {
    console.error(
      "Connect error:",
      e
    );

    setStatus(
      e.shortMessage ||
        e.message ||
        "Connection failed"
    );
  }
}

// ====== REFRESH ======
async function refresh() {
  if (
    !farm ||
    !user
  ) {
    return;
  }

  try {
    const [
      u,
      pending,
      totalStaked,
      walletAlt,
      rewardBal,
      allocatedBal,
      availableBal,
      dripDay,
      dripYear,
      solvent,
    ] =
      await Promise.all([
        farm.users(user),
        farm.pendingRewards(
          user
        ),
        farm.totalStaked(),
        alt.balanceOf(user),
        farm.rewardBalance(),
        farm.allocatedBalance(),
        farm.availableRewards(),
        farm.dailyDripEstimate(),
        farm.yearlyDripEstimate(),
        farm.isSolvent(),
      ]);

    // Same named-return style as the old USDC dApp.
    const userStaked =
      u.amount;

    // ===== USER =====
    const stakedText =
      fmtUnitsSmart(
        userStaked,
        tokenDecimals,
        8
      );

    const pendingText =
      fmtUnitsSmart(
        pending,
        tokenDecimals,
        8
      );

    const walletText =
      fmtUnitsSmart(
        walletAlt,
        tokenDecimals,
        8
      );

    setText(
      "deposited",
      `${stakedText} ALT`
    );

    setText(
      "pending",
      `${pendingText} ALT`
    );

    setText(
      "walletBalance",
      `Wallet balance: ${walletText} ALT`
    );

    // ===== VAULT =====
    const reserveText =
      fmtUnitsSmart(
        availableBal,
        tokenDecimals,
        8
      );

    const totalStakedText =
      fmtUnitsSmart(
        totalStaked,
        tokenDecimals,
        8
      );

    const dripDayText =
      fmtUnitsSmart(
        dripDay,
        tokenDecimals,
        8
      );

    setText(
      "reserve",
      `${reserveText} ALT`
    );

    setText(
      "vaultTvlAlt",
      `${totalStakedText} ALT`
    );

    setText(
      "dailyRewards",
      `${dripDayText} ALT`
    );

    // ===== USD VALUES =====
    const p =
      cachedAltPriceUsd;

    if (
      p !== null &&
      Number.isFinite(p)
    ) {
      const stakedNum =
        parseFloat(
          ethers.formatUnits(
            userStaked,
            tokenDecimals
          )
        );

      const pendingNum =
        parseFloat(
          ethers.formatUnits(
            pending,
            tokenDecimals
          )
        );

      const reserveNum =
        parseFloat(
          ethers.formatUnits(
            availableBal,
            tokenDecimals
          )
        );

      const totalStakedNum =
        parseFloat(
          ethers.formatUnits(
            totalStaked,
            tokenDecimals
          )
        );

      const dripDayNum =
        parseFloat(
          ethers.formatUnits(
            dripDay,
            tokenDecimals
          )
        );

      const dripYearNum =
        parseFloat(
          ethers.formatUnits(
            dripYear,
            tokenDecimals
          )
        );

      setText(
        "depositedUsd",
        fmtUsd(
          stakedNum * p
        )
      );

      setText(
        "pendingUsd",
        fmtUsd(
          pendingNum * p
        )
      );

      setText(
        "reserveUsd",
        fmtUsd(
          reserveNum * p
        )
      );

      setText(
        "vaultTvlUsd",
        fmtUsd(
          totalStakedNum * p
        )
      );

      setText(
        "dailyRewardsUsd",
        fmtUsd(
          dripDayNum * p
        )
      );

      // USD-based APR:
      //
      // annual reward value in USD
      // divided by
      // current total staked value in USD
      //
      // Because both stake and reward asset are ALT,
      // the ALT price mathematically cancels out.
      // But displaying the USD values makes the APR
      // easier for users to understand.
      const tvlUsd =
        totalStakedNum * p;

      const annualRewardsUsd =
        dripYearNum * p;

      const apr =
        tvlUsd > 0
          ? (
              annualRewardsUsd /
              tvlUsd
            ) * 100
          : null;

      setText(
        "apr",
        fmtPct(apr)
      );

      if (apr !== null) {
        setText(
          "aprUsdBasis",
          `${fmtUsd(
            annualRewardsUsd
          )}/yr rewards ÷ ${fmtUsd(
            tvlUsd
          )} staked`
        );
      } else {
        setText(
          "aprUsdBasis",
          "No ALT currently staked"
        );
      }
    } else {
      setText(
        "depositedUsd",
        "-"
      );

      setText(
        "pendingUsd",
        "-"
      );

      setText(
        "reserveUsd",
        "-"
      );

      setText(
        "vaultTvlUsd",
        "-"
      );

      setText(
        "dailyRewardsUsd",
        "-"
      );

      // Price-feed fallback:
      // contract already exposes current APR.
      const aprBps =
        await farm.currentAprBps();

      setText(
        "apr",
        fmtPct(
          Number(aprBps) /
            100
        )
      );

      setText(
        "aprUsdBasis",
        "ALT price temporarily unavailable"
      );
    }

    if (!solvent) {
      setStatus(
        "WARNING: vault reports insolvent"
      );
    } else {
      setStatus(
        `Connected: ${shortAddress(
          user
        )}`
      );
    }

    setText(
      "lastUpdate",
      `Updated ${new Date().toLocaleTimeString()}`
    );

    console.debug(
      "Everest refresh",
      {
        user,
        staked:
          ethers.formatUnits(
            userStaked,
            tokenDecimals
          ),
        pending:
          ethers.formatUnits(
            pending,
            tokenDecimals
          ),
        totalStaked:
          ethers.formatUnits(
            totalStaked,
            tokenDecimals
          ),
        availableRewards:
          ethers.formatUnits(
            availableBal,
            tokenDecimals
          ),
        rewardBalance:
          ethers.formatUnits(
            rewardBal,
            tokenDecimals
          ),
        allocatedRewards:
          ethers.formatUnits(
            allocatedBal,
            tokenDecimals
          ),
        solvent,
      }
    );
  } catch (e) {
    console.error(
      "Refresh error:",
      e
    );

    setStatus(
      "Refresh failed — check console"
    );
  }
}

// ====== TX HELPERS ======
async function approveIfNeeded(
  amountWei
) {
  const allowance =
    await alt.allowance(
      user,
      FARM_ADDRESS
    );

  if (
    allowance >= amountWei
  ) {
    return;
  }

  setStatus(
    "Approve ALT in your wallet..."
  );

  const tx =
    await alt.approve(
      FARM_ADDRESS,
      amountWei
    );

  await tx.wait();
}

async function stake() {
  if (
    !farm ||
    !user
  ) {
    return alert(
      "Connect wallet first"
    );
  }

  const input =
    $("depositAmount");

  const val =
    input
      ? input.value
      : "";

  if (
    !val ||
    Number(val) <= 0
  ) {
    return alert(
      "Enter stake amount"
    );
  }

  try {
    const amountWei =
      ethers.parseUnits(
        val,
        tokenDecimals
      );

    await approveIfNeeded(
      amountWei
    );

    setStatus(
      "Confirm deposit..."
    );

    const tx =
      await farm.deposit(
        amountWei
      );

    await tx.wait();

    if (input) {
      input.value = "";
    }

    setStatus(
      "Deposit confirmed"
    );

    await refresh();
  } catch (e) {
    console.error(
      "Deposit error:",
      e
    );

    setStatus(
      e.shortMessage ||
        e.message ||
        "Deposit failed"
    );
  }
}

async function withdraw() {
  if (
    !farm ||
    !user
  ) {
    return alert(
      "Connect wallet first"
    );
  }

  const input =
    $("withdrawAmount");

  const val =
    input
      ? input.value
      : "";

  if (
    !val ||
    Number(val) <= 0
  ) {
    return alert(
      "Enter withdraw amount"
    );
  }

  try {
    const amountWei =
      ethers.parseUnits(
        val,
        tokenDecimals
      );

    setStatus(
      "Confirm withdrawal..."
    );

    const tx =
      await farm.withdraw(
        amountWei
      );

    await tx.wait();

    if (input) {
      input.value = "";
    }

    setStatus(
      "Withdrawal confirmed"
    );

    await refresh();
  } catch (e) {
    console.error(
      "Withdraw error:",
      e
    );

    setStatus(
      e.shortMessage ||
        e.message ||
        "Withdrawal failed"
    );
  }
}

async function claim() {
  if (
    !farm ||
    !user
  ) {
    return alert(
      "Connect wallet first"
    );
  }

  try {
    setStatus(
      "Confirm claim..."
    );

    const tx =
      await farm.claim();

    await tx.wait();

    setStatus(
      "ALT rewards claimed"
    );

    await refresh();
  } catch (e) {
    console.error(
      "Claim error:",
      e
    );

    setStatus(
      e.shortMessage ||
        e.message ||
        "Claim failed"
    );
  }
}

async function updatePool() {
  if (
    !farm ||
    !user
  ) {
    return alert(
      "Connect wallet first"
    );
  }

  try {
    setStatus(
      "Confirm pool update..."
    );

    const tx =
      await farm.updatePool();

    await tx.wait();

    setStatus(
      "Pool updated"
    );

    await refresh();
  } catch (e) {
    console.error(
      "Update error:",
      e
    );

    setStatus(
      e.shortMessage ||
        e.message ||
        "Update failed"
    );
  }
}

// ====== BIND UI ======
document.addEventListener(
  "DOMContentLoaded",
  () => {
    const btnConnect =
      $("btnConnect");

    const btnDeposit =
      $("btnDeposit");

    const btnWithdraw =
      $("btnWithdraw");

    const btnClaim =
      $("btnClaim");

    const btnUpdate =
      $("btnUpdate");

    if (btnConnect) {
      btnConnect.onclick =
        connect;
    }

    if (btnDeposit) {
      btnDeposit.onclick =
        stake;
    }

    if (btnWithdraw) {
      btnWithdraw.onclick =
        withdraw;
    }

    if (btnClaim) {
      btnClaim.onclick =
        claim;
    }

    if (btnUpdate) {
      btnUpdate.onclick =
        updatePool;
    }

    if (
      window.ethereum?.on
    ) {
      window.ethereum.on(
        "accountsChanged",
        () =>
          window.location.reload()
      );

      window.ethereum.on(
        "chainChanged",
        () =>
          window.location.reload()
      );
    }
  }
);
