// Everest ALT Vault dApp — plain HTML/JavaScript
// Test deployment. For production, changing EVEREST_ADDRESS and TEST_MODE is enough
// provided the final contract uses the same EverestVaultALT ABI.

const EVEREST_ADDRESS = "0x42EDDCe0ab1269c8eC614A6bDc2ba16dC8445424";
const ALTITUDE_ADDRESS = "0x90678C02823b21772fa7e91B27EE70490257567B";

const TEST_MODE = true;

const BASE_CHAIN_ID = 8453n;
const GECKO_URL = `https://api.geckoterminal.com/api/v2/networks/base/tokens/${ALTITUDE_ADDRESS}`;
const DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${ALTITUDE_ADDRESS}`;

const VAULT_ABI = [
  "function altitudeToken() view returns (address)",
  "function totalStaked() view returns (uint256)",
  "function rewardReserve() view returns (uint256)",
  "function allocatedRewards() view returns (uint256)",
  "function feesAccrued() view returns (uint256)",
  "function vaultBalance() view returns (uint256)",
  "function availableRewards() view returns (uint256)",
  "function allocatedBalance() view returns (uint256)",
  "function rewardBalance() view returns (uint256)",
  "function accountedBalance() view returns (uint256)",
  "function untrackedRewards() view returns (uint256)",
  "function isSolvent() view returns (bool)",
  "function dailyDripEstimate() view returns (uint256)",
  "function yearlyDripEstimate() view returns (uint256)",
  "function currentAprBps() view returns (uint256)",
  "function users(address) view returns (uint256 amount, uint256 rewardDebt)",
  "function pendingRewards(address) view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function updatePool()",
  "function syncRewards()"
];

const TOKEN_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

let provider;
let signer;
let account;
let vaultRead;
let vaultWrite;
let tokenRead;
let tokenWrite;
let decimals = 18;
let altPriceUsd = 0;

const $ = (id) => document.getElementById(id);

function fmtToken(raw, maxDecimals = 2) {
  const n = Number(ethers.formatUnits(raw ?? 0n, decimals));
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

function fmtTokenNumber(n, maxDecimals = 2) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

function fmtUsd(n) {
  const value = Number(n || 0);
  if (!Number.isFinite(value)) return "$0.00";
  if (Math.abs(value) < 0.01 && value !== 0) return "$" + value.toFixed(6);
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").style.color = isError ? "#ff8ba3" : "";
}

function shortAddress(a) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function setBusy(busy) {
  ["btnConnect","btnDeposit","btnWithdraw","btnClaim","btnUpdate"].forEach(id => {
    const b = $(id);
    if (b) b.disabled = busy;
  });
}

async function fetchAltPrice() {
  try {
    const r = await fetch(GECKO_URL);
    if (!r.ok) throw new Error("GeckoTerminal unavailable");
    const j = await r.json();
    const p = Number(j?.data?.attributes?.price_usd);
    if (!Number.isFinite(p) || p <= 0) throw new Error("No GeckoTerminal price");
    altPriceUsd = p;
    return p;
  } catch (e) {
    console.warn("GeckoTerminal price failed; trying Dexscreener.", e);
  }

  try {
    const r = await fetch(DEXSCREENER_URL);
    if (!r.ok) throw new Error("Dexscreener unavailable");
    const j = await r.json();
    const best = (j?.pairs || [])
      .filter(p => p.chainId === "base" && Number(p.priceUsd) > 0)
      .sort((a,b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0];

    if (!best) throw new Error("No Base pair price");
    altPriceUsd = Number(best.priceUsd);
    return altPriceUsd;
  } catch (e) {
    console.error("ALT price unavailable", e);
    altPriceUsd = 0;
    return 0;
  }
}

async function getReadProvider() {
  if (provider) return provider;
  provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
  return provider;
}

async function initReadContracts() {
  const p = await getReadProvider();
  vaultRead = new ethers.Contract(EVEREST_ADDRESS, VAULT_ABI, p);
  tokenRead = new ethers.Contract(ALTITUDE_ADDRESS, TOKEN_ABI, p);
  decimals = Number(await tokenRead.decimals());

  // Safety check: test vault must point at the intended ALT contract.
  const configuredToken = (await vaultRead.altitudeToken()).toLowerCase();
  if (configuredToken !== ALTITUDE_ADDRESS.toLowerCase()) {
    throw new Error("Vault token mismatch");
  }
}

async function refreshVault() {
  try {
    if (!vaultRead) await initReadContracts();

    const [
      totalStakedRaw,
      reserveRaw,
      dailyRaw,
      solvent
    ] = await Promise.all([
      vaultRead.totalStaked(),
      vaultRead.availableRewards(),
      vaultRead.dailyDripEstimate(),
      vaultRead.isSolvent()
    ]);

    await fetchAltPrice();

    const totalStaked = Number(ethers.formatUnits(totalStakedRaw, decimals));
    const reserve = Number(ethers.formatUnits(reserveRaw, decimals));
    const daily = Number(ethers.formatUnits(dailyRaw, decimals));

    $("reserve").textContent = `${fmtTokenNumber(reserve)} ALT`;
    $("reserveUsd").textContent = fmtUsd(reserve * altPriceUsd);

    $("vaultTvlAlt").textContent = `${fmtTokenNumber(totalStaked)} ALT`;
    $("vaultTvlUsd").textContent = fmtUsd(totalStaked * altPriceUsd);

    $("dailyRewards").textContent = `${fmtTokenNumber(daily, 4)} ALT`;
    $("dailyRewardsUsd").textContent = fmtUsd(daily * altPriceUsd);

    $("altPrice").textContent = altPriceUsd > 0
      ? (altPriceUsd < 0.01 ? "$" + altPriceUsd.toFixed(7) : fmtUsd(altPriceUsd))
      : "Unavailable";

    // USD-value APR:
    // projected annual reward value / current USD value of total staked.
    // Both are ALT-valued at the same live market price, but this presentation
    // explicitly expresses the yield against the dollar value of the vault.
    if (totalStaked > 0 && altPriceUsd > 0) {
      const tvlUsd = totalStaked * altPriceUsd;
      const annualRewardsUsd = daily * 365 * altPriceUsd;
      const apr = (annualRewardsUsd / tvlUsd) * 100;

      $("apr").textContent = `${apr.toFixed(2)}%`;
      $("aprUsdBasis").textContent =
        `${fmtUsd(annualRewardsUsd)}/yr rewards ÷ ${fmtUsd(tvlUsd)} staked`;
    } else if (totalStaked > 0) {
      // Price unavailable: percentage is still mathematically the same because
      // both the reward and stake asset are ALT. We don't label it USD basis.
      const apr = (daily * 365 / totalStaked) * 100;
      $("apr").textContent = `${apr.toFixed(2)}%`;
      $("aprUsdBasis").textContent = "ALT price unavailable — token ratio shown";
    } else {
      $("apr").textContent = "—";
      $("aprUsdBasis").textContent = "No ALT currently staked";
    }

    if (!solvent) {
      setStatus("Warning: vault accounting reports insolvency.", true);
    }

    $("lastUpdate").textContent = `Updated ${new Date().toLocaleTimeString()}`;

    if (account) await refreshUser();
  } catch (err) {
    console.error(err);
    $("lastUpdate").textContent = "Vault data unavailable";
  }
}

async function refreshUser() {
  if (!account || !vaultRead || !tokenRead) return;

  try {
    const [u, pendingRaw, walletRaw] = await Promise.all([
      vaultRead.users(account),
      vaultRead.pendingRewards(account),
      tokenRead.balanceOf(account)
    ]);

    const stakedRaw = u.amount;
    const staked = Number(ethers.formatUnits(stakedRaw, decimals));
    const pending = Number(ethers.formatUnits(pendingRaw, decimals));
    const wallet = Number(ethers.formatUnits(walletRaw, decimals));

    $("deposited").textContent = `${fmtTokenNumber(staked)} ALT`;
    $("depositedUsd").textContent = fmtUsd(staked * altPriceUsd);

    $("pending").textContent = `${fmtTokenNumber(pending, 4)} ALT`;
    $("pendingUsd").textContent = fmtUsd(pending * altPriceUsd);

    $("walletBalance").textContent = `Wallet balance: ${fmtTokenNumber(wallet)} ALT`;
  } catch (err) {
    console.error("User refresh failed", err);
  }
}

async function switchToBase() {
  if (!window.ethereum) throw new Error("No wallet detected");

  const hex = "0x2105";
  const current = await window.ethereum.request({ method: "eth_chainId" });

  if (current.toLowerCase() === hex) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hex }]
    });
  } catch (err) {
    if (err.code !== 4902) throw err;

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hex,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://mainnet.base.org"],
        blockExplorerUrls: ["https://basescan.org"]
      }]
    });
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("No compatible browser wallet detected.", true);
    return;
  }

  try {
    setBusy(true);
    setStatus("Connecting wallet…");

    await switchToBase();

    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    signer = await browserProvider.getSigner();
    account = await signer.getAddress();

    const network = await browserProvider.getNetwork();
    if (network.chainId !== BASE_CHAIN_ID) throw new Error("Please switch to Base");

    vaultWrite = new ethers.Contract(EVEREST_ADDRESS, VAULT_ABI, signer);
    tokenWrite = new ethers.Contract(ALTITUDE_ADDRESS, TOKEN_ABI, signer);

    $("btnConnect").textContent = shortAddress(account);
    setStatus(`Connected ${shortAddress(account)}`);

    await refreshVault();
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.message || "Wallet connection failed", true);
  } finally {
    setBusy(false);
  }
}

async function requireWallet() {
  if (!account || !signer) {
    await connectWallet();
  }
  if (!account || !signer) throw new Error("Wallet not connected");
}

function parseAmount(id) {
  const value = $(id).value.trim();
  if (!value || Number(value) <= 0) throw new Error("Enter an amount greater than zero");
  return ethers.parseUnits(value, decimals);
}

async function deposit() {
  try {
    await requireWallet();
    const amount = parseAmount("depositAmount");

    setBusy(true);

    const allowance = await tokenWrite.allowance(account, EVEREST_ADDRESS);
    if (allowance < amount) {
      setStatus("Approval required — confirm ALT approval in your wallet…");
      const approveTx = await tokenWrite.approve(EVEREST_ADDRESS, amount);
      await approveTx.wait();
    }

    setStatus("Confirm Everest deposit in your wallet…");
    const tx = await vaultWrite.deposit(amount);
    setStatus("Deposit submitted — waiting for confirmation…");
    await tx.wait();

    $("depositAmount").value = "";
    setStatus("Deposit confirmed.");
    await refreshVault();
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.reason || err.message || "Deposit failed", true);
  } finally {
    setBusy(false);
  }
}

async function withdraw() {
  try {
    await requireWallet();
    const amount = parseAmount("withdrawAmount");

    setBusy(true);
    setStatus("Confirm withdrawal in your wallet…");

    const tx = await vaultWrite.withdraw(amount);
    setStatus("Withdrawal submitted — waiting for confirmation…");
    await tx.wait();

    $("withdrawAmount").value = "";
    setStatus("Withdrawal confirmed. Pending rewards were harvested.");
    await refreshVault();
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.reason || err.message || "Withdrawal failed", true);
  } finally {
    setBusy(false);
  }
}

async function claim() {
  try {
    await requireWallet();

    setBusy(true);
    setStatus("Confirm reward claim in your wallet…");

    const tx = await vaultWrite.claim();
    setStatus("Claim submitted — waiting for confirmation…");
    await tx.wait();

    setStatus("ALT rewards claimed.");
    await refreshVault();
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.reason || err.message || "Claim failed", true);
  } finally {
    setBusy(false);
  }
}

async function updatePool() {
  try {
    await requireWallet();

    setBusy(true);
    setStatus("Confirm pool update in your wallet…");

    const tx = await vaultWrite.updatePool();
    setStatus("Update submitted — waiting for confirmation…");
    await tx.wait();

    setStatus("Everest pool updated.");
    await refreshVault();
  } catch (err) {
    console.error(err);
    setStatus(err.shortMessage || err.reason || err.message || "Update failed", true);
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  $("btnConnect").addEventListener("click", connectWallet);
  $("btnDeposit").addEventListener("click", deposit);
  $("btnWithdraw").addEventListener("click", withdraw);
  $("btnClaim").addEventListener("click", claim);
  $("btnUpdate").addEventListener("click", updatePool);

  if (!TEST_MODE) {
    const banner = $("testBanner");
    if (banner) banner.remove();
  }

  if (window.ethereum?.on) {
    window.ethereum.on("accountsChanged", async (accounts) => {
      if (!accounts.length) {
        account = undefined;
        signer = undefined;
        vaultWrite = undefined;
        tokenWrite = undefined;
        $("btnConnect").textContent = "Connect Wallet";
        $("deposited").textContent = "0 ALT";
        $("pending").textContent = "0 ALT";
        $("walletBalance").textContent = "Wallet balance: — ALT";
        setStatus("Not connected");
        return;
      }

      await connectWallet();
    });

    window.ethereum.on("chainChanged", () => window.location.reload());
  }
}

async function start() {
  bindEvents();

  try {
    await initReadContracts();
    await refreshVault();
    setInterval(refreshVault, 30_000);
  } catch (err) {
    console.error(err);
    setStatus(`Dapp setup error: ${err.message}`, true);
  }
}

window.addEventListener("DOMContentLoaded", start);
