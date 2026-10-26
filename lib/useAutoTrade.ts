'use client';

import { useEffect, useState } from 'react';
import { GameWallet } from './useGameWallet';
import { getPending, markPlaced, removePending } from './pending';
import { loadMatches } from './matches';

/**
 * While this tab is open, places the wallet's real order the moment a match it joined locks
 * (the "opening" phase). A match that was cancelled or finished is forgotten. If the tab was closed
 * through the whole opening window, the trade is not placed late: that seat counts as a no-show.
 */
export function useAutoTrade(wallet: GameWallet) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const key = wallet.key;
    const address = wallet.address;
    if (!key || !address) return;
    let off = false;
    let working = false;

    const run = async () => {
      if (working) return;
      working = true;
      try {
        for (const p of getPending()) {
          if (off || p.placed || p.address.toLowerCase() !== address.toLowerCase()) continue;
          let matches;
          try {
            matches = await loadMatches(p.pool, p.ticker, address);
          } catch {
            continue; // try again on the next tick
          }
          const m = matches.find((x) => x.id === `${p.ticker} #${p.number}`);
          if (!m) {
            removePending(p); // left the lobby
            continue;
          }
          const me = m.playersList?.find((x) => x.isUser);
          if (m.status === 'cancelled' || m.status === 'settled') {
            removePending(p);
          } else if (m.status === 'running') {
            if (me) setNote(`${m.id}: the trade window closed before your trade was placed. You are out of this match and nothing was staked.`);
            removePending(p);
          } else if (m.status === 'opening' && me) {
            markPlaced(p, true); // marked first so two ticks never place two orders
            try {
              const { openTrade } = await import('./openTrade');
              const r = await openTrade({ key, address: address as `0x${string}`, ticker: p.ticker, side: p.side, number: p.number, leverage: p.leverage });
              setNote(`${m.id}: your stake and your ${p.side === 'bulls' ? 'long' : 'short'} trade were placed automatically${r.txHash ? ` (tx ${r.txHash.slice(0, 10)}...)` : ''}.`);
            } catch (e) {
              markPlaced(p, false);
              setNote(`${m.id}: could not place your trade yet: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
            }
          } else if (m.status === 'confirming' && me && !me.confirmed) {
            setNote(`${m.id} did not fill. Open the match and press "Continue" to stay in.`);
          }
        }
      } finally {
        working = false;
      }
    };
    run();
    const id = setInterval(run, 4000);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [wallet.key, wallet.address]);

  return note;
}
