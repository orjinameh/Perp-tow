'use client';

import { useCallback, useEffect, useState } from 'react';
import { CryptoAsset, MarketQueueData } from './types';
import { loadMarkets } from './dreamdex';

export interface LiveMarkets {
  status: 'loading' | 'ok' | 'error';
  markets: MarketQueueData[];
  failed: CryptoAsset[];
  error: string | null;
  updatedAt: number | null;
  reload: () => void;
}

const REFRESH_MS = 60_000;

export function useLiveMarkets(): LiveMarkets {
  const [state, setState] = useState<Omit<LiveMarkets, 'reload'>>({
    status: 'loading',
    markets: [],
    failed: [],
    error: null,
    updatedAt: null,
  });

  const load = useCallback(async () => {
    try {
      const { markets, failed } = await loadMarkets();
      if (markets.length === 0) throw new Error('no supported market could be loaded from the dreamDEX indexer');
      setState({ status: 'ok', markets, failed, error: null, updatedAt: Date.now() });
      try { localStorage.setItem('tow.markets', JSON.stringify({ markets, failed, at: Date.now() })); } catch { /* no storage: fine */ }
    } catch (e) {
      // Keep showing the last good data if we have some; otherwise show the offline state.
      setState((prev) =>
        prev.markets.length > 0
          ? { ...prev, error: e instanceof Error ? e.message : String(e) }
          : { status: 'error', markets: [], failed: [], error: e instanceof Error ? e.message : String(e), updatedAt: null },
      );
    }
  }, []);

  useEffect(() => {
    // Show the last real snapshot (with its true age) while the fresh one loads, so the page is not empty.
    try {
      const raw = localStorage.getItem('tow.markets');
      const c = raw ? (JSON.parse(raw) as { markets: MarketQueueData[]; failed: CryptoAsset[]; at: number }) : null;
      if (c && c.markets?.length && Date.now() - c.at < 30 * 60_000) setState((prev) => (prev.markets.length ? prev : { status: 'ok', markets: c.markets, failed: c.failed ?? [], error: null, updatedAt: c.at }));
    } catch { /* ignore */ }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return { ...state, reload: load };
}
