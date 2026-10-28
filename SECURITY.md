# Security and trust limits

This is a testnet game. It holds only dreamDEX Hideki testnet tokens (STT for gas, USDso as play money).

## What protects players
- **Result computed on chain.** Nobody posts the result. `settle` reads each player's own vault equity from dreamDEX's margin bank and compares team averages, so any player can settle and check it.
- **One vault per player.** Each seat creates a vault contract that trades only for its owner, only while the match is live, and pays only its owner. A leftover bankroll can be released by anyone but always goes to the owner.
- **Teams are assigned at the seat.** Nobody picks a side, and a player who leaves cannot re-enter the same match to reroll. The second seat is always opposite the first so a match with two or more players always has both teams. If a team is empty at the lock, the match is cancelled and refunded.
- **The operator cannot take stakes.** The operator can only collect the rake (capped at 30%) of a settled match. Refunds always open after the grace period.
- **The game wallet key is encrypted in the browser** with the player's PIN (AES-GCM, key derived with PBKDF2, 600,000 rounds) and is readable only in memory after unlocking. Revealing it or sending funds asks for the PIN again. Use a PIN of 8 or more characters: a short PIN can be guessed offline by someone who copies the browser storage.
- **Bot scripts run in a sandbox.** A script cannot see the key or the page and can only return an order. Orders are capped to the bankroll and at 6 a minute, and the bot stops after repeated failures.
- **The site sets browser protections:** no framing, no content sniffing, no plugins, a strict referrer policy, and a read-only, rate-limited indexer proxy.

## Known limits (be honest about these)
1. **Collusion with several wallets.** One person with several wallets can place wallets on both teams and move value between them through trades. Equal bankrolls and the per-player score cap limit how much one wallet can swing, but this is not solved.
2. **Randomness.** Teams come from the previous block's hash plus the seat. That is good enough for a testnet game but a block producer could in theory influence it. A production version would use a verifiable randomness source.
3. **Trading pool is not restricted.** A vault trades on any pool address its owner names. Funds cannot leave the vault this way, but a production version should whitelist dreamDEX pools.
4. **Equity can move by other means.** The score is the vault's margin equity change. Anything dreamDEX itself does to that account (funding, liquidation, fees) counts, as it should, but a deposit into a vault's margin account by a third party would also count if dreamDEX allows deposits for others.
5. **Settlement is manual.** Anyone must press Settle after the match ends. Nothing settles automatically yet.
6. **A stolen unlocked device.** While the wallet is unlocked in a browser, whoever holds that device can trade. Press Lock when you leave it.
7. **Testnet only.** Never import a key that holds real money.
