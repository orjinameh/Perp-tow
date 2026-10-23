'use client';

import { useEffect, useState } from 'react';
import { GameMatch } from './types';
import { loadMatches } from './matches';

/** Matches on one market, rebuilt from chain data every 10 seconds. */
export function useMatches(pool: string | null, ticker: string | null, me: string | null) {
  const [matches, setMatches] = useState<GameMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!pool || !ticker) {
      setMatches([]);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const m = await loadMatches(pool, ticker, me);
        if (!cancelled) {
          setMatches(m);
          setError(null);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    run();
    const id = setInterval(run, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pool, ticker, me, tick]);

  return { matches, error, loaded, reload: () => setTick((t) => t + 1) };
}
