'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameWallet } from './useGameWallet';
import { NOMINAL_STAKE_USD } from './gameTag';
import { getPending } from './pending';
import { leaderDirection } from './leaders';

export interface Follow {
  leader: string;
  ticker: string;
  pool: string;
  copyCurrent: boolean; // also open their current position straight away
  baseline: 'long' | 'short' | 'flat'; // what they held when you started
  armed: boolean; // true once there is something to mirror
  startedAt: number;
}

export interface CopyEvent {
  at: number;
  text: string;
  error?: boolean;
}

const KEY = 'tow.copy';
const POLL_MS = 5000;
const COOLDOWN_MS = 30_000;

function read(): Follow | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Follow | null;
  } catch {
    return null;
  }
}
function write(f: Follow | null) {
  try {
    if (f) localStorage.setItem(KEY, JSON.stringify(f));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: copying only lasts while this page is open */
  }
}

/**
 * Mirrors one leader's direction on one market from this browser's game wallet: when they go long,
 * short or flat, so do we, at the game's fixed stake and leverage. Runs only while this tab is open.
 */
export function useCopyTrade(wallet: GameWallet) {
  const [follow, setFollow] = useState<Follow | null>(null);
  const [events, setEvents] = useState<CopyEvent[]>([]);
  const [now, setNow] = useState<'long' | 'short' | 'flat' | null>(null);
  const busy = useRef(false);
  const lastAct = useRef(0);
  const fails = useRef(0);
  const ref = useRef<Follow | null>(null);
  ref.current = follow;

  const log = useCallback((text: string, error = false) => setEvents((e) => [{ at: Date.now(), text, error }, ...e].slice(0, 8)), []);

  useEffect(() => {
    setFollow(read());
  }, []);

  const start = useCallback(
    async (leader: string, ticker: string, pool: string, copyCurrent: boolean) => {
      const baseline = await leaderDirection(pool, leader);
      const f: Follow = { leader, ticker, pool, copyCurrent, baseline, armed: copyCurrent, startedAt: Date.now() };
      write(f);
      fails.current = 0;
      lastAct.current = 0;
      setEvents([]);
      setFollow(f);
      log(copyCurrent ? `Following ${leader.slice(0, 6)}…${leader.slice(-4)} on ${ticker}. Copying their current ${baseline} position too.` : `Following ${leader.slice(0, 6)}…${leader.slice(-4)} on ${ticker}. Waiting for them to change direction (they are ${baseline} now).`);
    },
    [log],
  );

  const stop = useCallback(
    (why?: string) => {
      write(null);
      setFollow(null);
      if (why) log(why, true);
    },
    [log],
  );

  useEffect(() => {
    if (!follow || !wallet.key || !wallet.address) return;
    const key = wallet.key;
    const address = wallet.address;
    let off = false;

    const tick = async () => {
      const f = ref.current;
      if (!f || busy.current || off) return;
      busy.current = true;
      try {
        const theirs = await leaderDirection(f.pool, f.leader);
        setNow(theirs);
        if (!f.armed) {
          if (theirs === f.baseline) return;
          const armed = { ...f, armed: true };
          write(armed);
          setFollow(armed);
          log(`They went ${theirs}. Now mirroring.`);
        }
        // A match seat on the same market nets into the same position, so copying waits.
        if (getPending().some((p) => p.ticker === f.ticker && p.address.toLowerCase() === address.toLowerCase())) {
          log(`Paused: you hold a match seat on ${f.ticker}, which shares one position with copying.`, true);
          return;
        }
        const t = await import('./trading');
        const mine = await t.myDirection(key, address, f.ticker);
        if (mine === theirs) return;
        if (Date.now() - lastAct.current < COOLDOWN_MS) return;
        lastAct.current = Date.now();
        if (mine !== 'flat') {
          log(`They are ${theirs}. Closing your ${mine}…`);
          log(await t.closeMyPosition(key, address, f.ticker));
        }
        if (theirs !== 'flat') {
          log(`Opening your ${theirs} to match…`);
          const r = await t.enterMatch({ key, address, ticker: f.ticker, side: theirs === 'long' ? 'bulls' : 'bears', matchNumber: 0, stakeUsd: NOMINAL_STAKE_USD });
          log(`Opened ${theirs}: ${r.filledQuantity || r.quantity} ${f.ticker}${r.txHash ? ` · tx ${r.txHash}` : ''}`);
        }
        fails.current = 0;
      } catch (e) {
        fails.current += 1;
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        log(`Copy attempt failed (${fails.current}/3): ${msg}`, true);
        if (fails.current >= 3) stop('Stopped after 3 failed attempts. Check your margin and STT, then start again.');
      } finally {
        busy.current = false;
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [follow?.leader, follow?.ticker, follow?.pool, wallet.key, wallet.address, log, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  return { follow, events, leaderNow: now, start, stop };
}
