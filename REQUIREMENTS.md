# Requirements log (edit me)

This file is the source of truth for what the game must do. It was written from the parts of the conversation that are
visible; strike out what is wrong and add what is missing. Every change is checked against it.

## Contest
- dreamDEX Perps Builder Bounty, Somnia Hideki testnet (chain 50383). MVP track: "Perp Tug of War".
- Submissions close Nov 1 23:59 UTC (00:59 Lagos, Nov 2).
- Must use real dreamDEX data and real orders. No simulation, no mock data: show real data or an empty/offline state.
- The admin approved USDso escrow. Builds are secret: do not share links or tokens, and keep contract addresses, keys and deploy transactions out of the README, X posts and repo.

## Game rules (the one game: Tug of War)
Stated by the owner (this is the spec; supersedes anything older):
1. Enable multiple trades: players trade as often as they like during a match.
2. Random teams that support asymmetric splits, e.g. 15 vs 5, while making sure the numbers are not an advantage. Teams are Bulls and Bears (the original names), but nobody chooses a side: players are assigned at random.
3. Dynamic team size with a limit of 20 players per match (the host picks the room size, 2 to 20).
4. One contract wallet per player (a trading vault that only trades for its owner and pays only its owner).
5. Change the flat screens into their respective 3D rooms.

How the build meets them:
- Each player is placed by their own random draw from the match seed, so 15/5 is possible. If everybody would land on one team, the lowest draw is moved across so both teams exist.
- Numbers are no advantage: a team's score is the AVERAGE vault gain of its players, and payouts are per head (winners get their stake back plus 80% of the losers' pool shared among the winning team's players, so a smaller winning team gets more per head).
- Stake $10 USDso per player at the seat, plus an equal trading bankroll that goes into the player's own vault and comes back to them. Leaving before the lock returns both.
- Lobby timer, then a "continue with fewer players" window (at least 2), then lock. A full room locks at once. A match that never starts refunds everyone.
- Match length: NEXT_PUBLIC_MATCH_SECONDS from the lock (default 5 minutes). Anyone can settle after it ends; the contract computes the winner from vault equity on the dreamDEX margin bank. A tie refunds everyone.
- 20% rake on the losers' pool.

## Product / UX
- The 3D world is the main experience: hub with a door per market, a market room, an arena. The same app shell (navbar, wallet panel, History, Leaders, rules modal) stays.
- Market room: wall of open matches (with pads to join), an "open a new match" pad, a left-wall entry ticket with confirm and back pads.
- Arena: seat ring (seats turn green for Bulls or rose for Bears at the lock), status board, live rope between Bulls and Bears, a trade panel.
- Hosting a match lets the host choose size (and, later, market and stake).
- Everything must look like the app (dark theme, styled controls). Unstyled controls are bugs.
- A flat 2D version exists as a fallback only if the 3D world fails to start.

## Bots (for users, not house bots)
- A user can add the game wallet as a bot for their main wallet in the dreamDEX app ("Add bot", Perps ticked). The game wallet then stakes and places orders for the main wallet. The tab must stay open, as with manual play.
- Must work for ordinary users inside the app: no terminal steps, no private keys pasted into a script.
- Delegated orders need a future expiry (an expiry of 0 reverts).

## Process preferences
- Zips contain only changed files, full relative paths, unzip from the project root: `unzip -o <name>.zip -d .`, then `rm <name>.zip`, plus a ready git add/commit message.
- Explanations in the reply, not in the zip. Fix code without waiting for approval.
- Fix errors in the assistant's own copy too, so a later zip never undoes a fix.
- Probes: do them all in one run and save the output to probe-out.txt. No screenshots of terminal output.
- Answer questions first; do not build when the user says "don't build yet".

## Market Royale (previous winner): what to learn, not copy
- Verifiable results (done), tests, a clear README with honest trust limits, a demo script, labeled bots, an SDK feedback document, automatic settling.
- Judge feedback to avoid: market as set dressing, off-chain ledger, minted payouts, custodial operator.

## Deadline checklist
- Redeploy squads (max size 20), set NEXT_PUBLIC_SQUADS_ADDRESS, build, deploy a public build, record the demo, push Feedback reports, post the X drafts.
- Rotate the operator key that was pasted in chat.
