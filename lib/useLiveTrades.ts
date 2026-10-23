'use client';

import { useEffect, useState } from 'react';
import { LiveTrade } from './types';
import { loadRecentTrades } from './dreamdex';

/** Polls the latest real fills on one perp pool every few seconds. */
export function useLiveTrades(pool: string, baseDecimals: number) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTrades([]);
    setLoaded(false);
    const tick = async () => {
      try {
        const t = await loadRecentTrades(pool, baseDecimals);
        if (!cancelled) {
          setTrades(t);
          setError(null);
          setLoaded(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pool, baseDecimals]);

  return { trades, error, loaded };
}
