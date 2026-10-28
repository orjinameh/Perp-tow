# Requirements log (edit me)

This file is the source of truth for what the game must do. It was written from the parts of the conversation that are
visible; strike out what is wrong and add what is missing. Every change is checked against it.

## Contest
- dreamDEX Perps Builder Bounty, Somnia Hideki testnet (chain 50383). MVP track: "Perp Tug of War".
- Submissions close Nov 1 23:59 UTC (00:59 Lagos, Nov 2).
- Must use real dreamDEX data and real orders. No simulation, no mock data: show real data or an empty/offline state.
- The admin approved USDso escrow. Builds are secret: do not share links or tokens, and keep contract addresses, keys and deploy transactions out of the README, X posts and repo.

## Game rules (squads, the one game)
- One game only. No Bulls/Bears pick, no "classic" game, no old direction-based flow.
- Players take a seat in a match room. Teams are assigned to players at random when the match locks (Red / Blue). Nobody picks a team.
- Open question for the owner: balanced random teams (within one player, current) or fully random teams (even 19 v 1)? "Do what's best" was said, so balanced is built.
- Stake: $10 USDso per player, taken when the seat is taken. Leaving before the lock returns it.
- Room size: the host chooses it when opening a room, from 2 up to the contract's deployed maximum. Original rule was 20 players. Set NEXT_PUBLIC_MATCH_SIZE=20 before deploying squads.
- Lobby timer, then "continue with fewer players" (at least 2) window, then lock. A full room locks at once. A match that never starts refunds everyone.
- After the lock, players trade freely on dreamDEX: any direction, any leverage, any number of trades.
- Match length: set by NEXT_PUBLIC_MATCH_SECONDS (default 5 minutes) from the lock.
- Winner: the team with the better average real account equity change (each player's change capped), computed on chain by `settle`, which anyone can call. Tie refunds everyone.
- Payout: winners get stake back plus 80% of the losers' pool; 20% rake. Anyone can claim for a player.
- If nobody settles, refunds open after the grace period.

## Product / UX
- The 3D world is the main experience: hub with a door per market, a market room, an arena. The same app shell (navbar, wallet panel, History, Leaders, rules modal) stays.
- Market room: wall of open matches (with pads to join), an "open a new match" pad, a left-wall entry ticket with confirm and back pads.
- Arena: seat ring, status board, live rope showing each team's score, a trade panel.
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
