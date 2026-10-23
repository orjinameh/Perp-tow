'use client';

import React from 'react';
import { MarketQueueData } from '@/lib/types';
import { useLiveTrades } from '@/lib/useLiveTrades';

const EXPLORER_TX = 'https://explorer.testnet.somnia.network/tokyo/tx/';

export const LiveTrades: React.FC<{ market: MarketQueueData }> = ({ market }) => {
  const { trades, error, loaded } = useLiveTrades(market.pool, market.baseDecimals);
  const fmtPrice = (p: number) =>
    p.toLocaleString(undefined, { minimumFractionDigits: p < 1 ? 4 : 2, maximumFractionDigits: p < 1 ? 4 : 2 });

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-4 sm:p-6 shadow-xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white">Live {market.ticker}-PERP trades</h3>
        <span className="text-[11px] text-zinc-500">real fills, refreshed every 8s</span>
      </div>
      {error && !loaded && <div className="text-xs text-rose-300">Trade feed offline: {error}</div>}
      {!error && !loaded && <div className="text-xs text-zinc-500">Loading trades...</div>}
      {loaded && trades.length === 0 && <div className="text-xs text-zinc-500">No trades on this market yet.</div>}
      {trades.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono tabular-nums">
            <thead>
              <tr className="text-zinc-500 text-left">
                <th className="py-1 pr-4 font-normal">Time (UTC)</th>
                <th className="py-1 pr-4 font-normal">Side</th>
                <th className="py-1 pr-4 font-normal text-right">Price</th>
                <th className="py-1 pr-4 font-normal text-right">Size ({market.ticker})</th>
                <th className="py-1 font-normal text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800/60">
                  <td className="py-1 pr-4 text-zinc-400">{new Date(t.timestamp * 1000).toISOString().slice(11, 19)}</td>
                  <td className={`py-1 pr-4 font-semibold ${t.takerIsBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {t.takerIsBuy ? 'Buy' : 'Sell'}
                  </td>
                  <td className="py-1 pr-4 text-right text-zinc-200">${fmtPrice(t.price)}</td>
                  <td className="py-1 pr-4 text-right text-zinc-300">{t.size.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                  <td className="py-1 text-right">
                    <a href={EXPLORER_TX + t.txHash} target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2">
                      view
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
