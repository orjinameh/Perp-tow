# Perp Tug of War

Bulls against Bears on real dreamDEX perps, in a 3D arena. You join a match room, you are put on team Bulls or team Bears at random, and everyone trades real perps from their own vault with the same play money. The team whose players gained more on average wins the other team's stakes. Built for the dreamDEX Perps Builder Bounty (MVP track) on the Somnia Tokyo testnet (the dreamDEX testnet that the markets SDK calls Hideki). Testnet only: nothing here is real money.

## Who it is for

- **Traders who want a game, not a chart:** a short team match where you trade real perps with the same play money as everyone else, so skill decides the result.
- **Bot builders:** paste a script into the app and it trades real orders from your vault, sandboxed so it never sees your key.
- **Followers:** the Leaders tab lets you copy the direction of a top account on a market from your own wallet (a few seconds late, while the tab is open), and Stop closes the position the copy opened.

**Categories:** consumer perps (the match game), with bots and trader tools built in (your own bot box, copy trading).

Every order in the app is a real market order on dreamDEX perps on the Tokyo testnet, signed by the player's own game wallet or vault.

## How a match works

1. **Open or join a room.** Walk into a market door in the 3D world, then take a seat in a room or open a new one. The host picks the room size, from 2 to 20 players.
2. **Take a seat.** It costs a $10 USDso stake. At the same moment the contract creates **your own trading vault** funded with an equal bankroll (default $50 of USDso) that comes back to you. The vault trades only for you and pays only you.
3. **Your team is drawn at random when you sit** (Bulls or Bears). Nobody picks a side, teams can be uneven (for example 15 against 5), the second seat is always opposite the first, and leaving means you cannot re-enter that room to reroll. If a team is empty at the lock, the match is cancelled and refunded.
4. **The lobby fills or times out.** A full room starts at once. If the lobby ends short, the seated players confirm "continue with fewer players".
5. **Everyone trades freely** for the match duration, with real market orders on dreamDEX from their own vault: buy or sell as often as they like, by hand or with their own script (see below).
6. **Settlement is computed on chain.** Each team is scored by the **average** gain of its players' vault equity, read from dreamDEX's margin bank, so team size is never an advantage. The better average wins, and a tie refunds everyone. Anyone can settle, and an open player tab settles by itself.
7. **Payout:** winners get their stake back plus a share of the losing team's stakes, `stake + (1 - rake) * stake * losers / winners`. Every player's bankroll is returned.

Everything shown comes from the chain or the dreamDEX indexer. There is no simulated data: if something cannot be read, the app shows an empty or offline state with the reason.

## Your own bot, inside the app

Under "Your vault" while a match is trading there is a script box. Paste a function `onTick(ctx)`, and every few seconds the app runs it in a sandboxed worker and, if it returns `{action:'buy'|'sell', usd}` or `{action:'close'}`, sends that real order from your vault. The script never sees your key, orders are capped to your bankroll and to 6 a minute, and the bot stops after repeated failures or when the match ends. An example momentum script is pre-filled.

## How it is built

- Next.js, React, Tailwind, three.js (3D world with bull, bear and rope models), viem, `@somnia-chain/markets-sdk`.
- `contracts/TugSquads.sol`: seats, stakes, random teams, per-player `TraderVault` contracts, on-chain scoring and payouts. The operator can only collect the rake.
- The game wallet is a key in the browser, encrypted with the player's PIN (AES-GCM, PBKDF2). It signs for the player so there are no wallet pop-ups. You can back up the key and send funds from the wallet bar.

## Run it

```
npm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_MATCH_SIZE=20` (the most seats any room may have), optionally `NEXT_PUBLIC_BANKROLL=50`, and a `DEPLOYER_KEY` for a testnet wallet that holds some STT. Then:

```
npm run deploy:squads      # compiles TugSquads.sol and writes NEXT_PUBLIC_SQUADS_ADDRESS to .env.local
npm run build
npm start
```

To play: create a game wallet (choose a PIN), send it STT for gas and enough USDso for a seat (stake plus bankroll), allow it in the dreamDEX app ("Add bot", Perps ticked) if you play from a main wallet, then open a room.

## Honest limits

See `SECURITY.md`. In short: one person with several wallets could collude across teams, team draws use the previous block's hash, the vault does not restrict which pool it trades on, and there is no contract test suite yet. The game wallet is for the testnet only: never put a key that holds real funds into it.

## Demo

Demo video: https://youtu.be/0ZNcl_dnW_k

The step-by-step script used to record it is in `DEMO.md`.

## X posts

Posts about this MVP, tagging @DreamDEXSomnia:

1. https://x.com/orjinamehola/status/2121102433694982403
2. https://x.com/orjinamehola/status/2121102944959680672
3. https://x.com/orjinamehola/status/2121103167173583021
