# Altitude Reflections DApp

Standalone plain HTML/JavaScript reflections dashboard for:

https://www.altitudetoken.com/reflections/

## Folder

Upload the complete `reflections` folder to the root of the Altitude-Site repository:

Altitude-Site/
  reflections/
    index.html
    app.js
    assets/
      altitude-logo.jpg

## Test mode

`app.js` currently has:

const RESTORED_START_BLOCK = 0n;

In this mode the dashboard automatically searches for the first ALT transfer into
the dedicated 100 ALT benchmark wallet within the last 90 days and treats that as
the temporary tracker start.

This lets the dashboard operate before Altitude Restored launches.

## Production Restored launch

When the restored reflection tax is activated, note the exact Base block number.

Then change:

const RESTORED_START_BLOCK = 0n;

to:

const RESTORED_START_BLOCK = 12345678n;

using the real block.

Do not change this baseline afterwards.

## Important RPC note

The dashboard needs historical `eth_call` data because reflections do not emit a
separate Transfer event to every holder.

The public Base RPC is fine for initial testing but is rate-limited. For a public
launch with meaningful traffic, use a dedicated archive-capable Base RPC endpoint.

## What it displays

Global:
- Annualised reflection APR since tracking began
- 7-day reflection APR once 7 days of data exist
- 30-day reflection APR once 30 days exist
- 1-year reflection APR once 365 days exist

Connected wallet:
- Current ALT balance
- Reflections over 7 days
- Reflections over 30 days
- Reflections over 1 year
- Reflections since tracking began

Wallet buys, sells and transfers are separated out as checkpoints so they are not
counted as passive reflection rewards.
