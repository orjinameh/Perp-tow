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
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return { ...state, reload: load };
}
