# Perp Tug of War

Bulls against Bears on real dreamDEX perps. Players take a side, stake $10 USDso, and open a real market order on the pool at the same moment. When the price clock ends, the side the price moved toward wins the losing side's pool, minus a 20% rake. Built for the dreamDEX Perps Builder Bounty on the Somnia Hideki testnet.

**The result never depends on head count or leverage.** Only the price direction decides it. Leverage only changes the size of a player's own real position.

## What it does

- Lobby ("analysis time") with a live price chart. Seats only, nothing staked.
- If the lobby ends short of full, the seated players can confirm "continue with fewer players".
- At the lock, every player's tab stakes in the escrow and places a real market order in a 60 second trade window.
- A 5 minute price clock, then settle and claim.
- Pick your own leverage, up to the limit dreamDEX sets for that market.
- Leaderboard of real traders from the indexer, with mirror copy trading while the tab is open.
- Stake and trade history, with claim, refund and stake-return buttons.
- Two views: a 3D world (hub of doors, market rooms, a tug-of-war arena) and a classic interface.

Everything shown is read from the chain or the dreamDEX indexer. There is no simulated data.

## How it is built

- Next.js, React, Tailwind, three.js.
- `@somnia-chain/markets-sdk` for markets, leverage, orders and positions.
- `contracts/TugRegistry.sol`: seats, sides and lobby timing. Holds no money.
- `contracts/TugEscrow.sol`: stakes, the result and payouts.
- The operator posts the result, computed from public dreamDEX candle data. It cannot take stakes, only the rake. If it never posts a result, everyone can reclaim their stake.

## Run it

```
npm install
cp .env.example .env.local
```

Fill `.env.local` (see `.env.example`). The lobby values must equal the ones the registry was deployed with.

```
npm run deploy:registry     # needs DEPLOYER_KEY
npm run deploy:escrow       # needs DEPLOYER_KEY
npm run dev
```

During a match the operator process starts and settles matches:

```
OPERATOR_KEY=0x... npm run operator -- BTC ETH
```

A single match can also be settled by hand with `npm run settle -- BTC 3`.

Players create or import a testnet game wallet in the page. Use a key that holds no real funds.

## Bot mode

The game wallet in the browser can act as a bot for your main wallet, the same idea as dreamDEX's "Add bot".

- Your main wallet stays the player: seats, stakes, perp margin and winnings all belong to it.
- The game wallet only signs. It can place and cancel perp orders on your account, take seats, stake and claim for you, and nothing else. Stakes are pulled from your main wallet up to a budget you set, and refunds and payouts always go back to it.
- Run `npm run grant -- <game wallet address> BTC ETH` once with your main wallet's key in `OWNER_KEY`, then `npm run bot-check -- <main address> <game wallet address> BTC` to test it without sending anything.
- The tab must stay open, as with manual play.

## Notes and limits

- The operator trusts public candle data to post results. This is by design for the prototype.
- The game wallet key is kept in the browser's local storage, for the testnet only.
- The bot runs in an open tab. It is not a hosted service and nobody else holds your key.

## X posts

Short drafts, edit and post as you like. Tag @DreamDEXSomnia.

1. Built Perp Tug of War on @DreamDEXSomnia: Bulls vs Bears on real perps. Stake $10, open a real order, and the side the price moves toward takes the pool. Leverage never decides the winner.
2. Pick your side, pick your leverage, then watch the rope move with the real price. 3D arena, live chart, real positions on the Hideki testnet. #Somnia
3. Leaderboard from real dreamDEX traders, and you can mirror a leader while the tab is open. Feedback for the team: delegated order placement would unlock true copy trading.
