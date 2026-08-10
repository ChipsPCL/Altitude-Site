# Everest ALT Vault — Test Dapp

This is the test dApp for the deployed EverestVaultALT contract on Base.

## Test contract

`0x42EDDCe0ab1269c8eC614A6bDc2ba16dC8445424`

## ALTITUDE token

`0x90678C02823b21772fa7e91B27EE70490257567B`

## What it shows

- Your staked ALT and approximate USD value
- Pending ALT rewards and approximate USD value
- Reward reserve in ALT and USD
- Vault TVL in ALT and USD
- Current daily reward drip
- Live APR calculated as:
  projected annual reward USD value / current staked USD value

Because both stake and rewards are ALT, the percentage is mathematically the same as
ALT rewards / ALT staked, but the UI explicitly values both sides at the live ALT/USD
market price and shows the dollar figures used.

Price source:
1. GeckoTerminal token API
2. Dexscreener fallback

## User actions

- Connect wallet
- Deposit ALT (approval is handled automatically if needed)
- Withdraw ALT
- Claim ALT rewards
- Update pool

## Test mode

`app.js` contains:

```js
const EVEREST_ADDRESS = "0x42EDDCe0ab1269c8eC614A6bDc2ba16dC8445424";
const TEST_MODE = true;
```

For the final production contract:
1. Replace EVEREST_ADDRESS.
2. Set TEST_MODE = false.

If the production contract uses the same ABI, no other dApp logic needs to change.

## Suggested GitHub location

Upload this whole folder into the existing Altitude-Site repo as:

```text
Altitude-Site/
  everest/
    index.html
    app.js
    assets/
      altitude-logo.jpg
      everest-vault-logo.png
```

It will then be available at `/everest/` on the site.

Do not remove the test banner until the final contract is deployed and tested.
