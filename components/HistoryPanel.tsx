'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MarketQueueData } from '@/lib/types';
import { GameWallet } from '@/lib/useGameWallet';
import { loadMatchHistory, loadTradeHistory, MatchRecord, TradeRecord } from '@/lib/history';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/ProgressModal';

const usd = (n: number) => `${n < 0 ? '-' : n > 0 ? '+' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const when = (t: number) => (t ? new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const tx = (h: string) => `https://explorer.testnet.somnia.network/tokyo/tx/${h}`;
const tone = { won: 'text-emerald-300', lost: 'text-rose-300', refund: 'text-zinc-300', cancelled: 'text-zinc-400', 'not staked': 'text-amber-300', 'in progress': 'text-sky-300', 'waiting for result': 'text-amber-300' } as const;

/** What this game wallet staked, won and traded, read from the chain and the dreamDEX indexer. */
export const HistoryPanel: React.FC<{ markets: MarketQueueData[]; wallet: GameWallet; onClose: () => void }> = ({ markets, wallet, onClose }) => {
  const [tab, setTab] = useState<'matches' | 'trades'>('matches');
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [trades, setTrades] = useState<TradeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wallet.address) return;
    setLoading(true);
    setError(null);
    try {
      const [m, t] = await Promise.all([loadMatchHistory(wallet.address, markets), loadTradeHistory(wallet.address, markets)]);
      setMatches(m);
      setTrades(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet.address, markets]);

  useEffect(() => {
    load();
  }, [wallet.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (r: MatchRecord) => {
    if (!wallet.key || !wallet.address || !r.action) return;
    setActing(r.id);
    setNote(null);
    try {
      const e = await import('@/lib/escrow');
      const h = await (r.action === 'leave' ? e.leaveEscrow : e.claimEscrow)(wallet.key as `0x${string}`, wallet.address as `0x${string}`, r.ticker, r.number);
      setNote(`${r.id}: ${r.action === 'leave' ? 'stake returned' : 'payout claimed'}. Tx ${h}`);
      await load();
    } catch (err) {
      setNote(`${r.id}: ${(err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ')}`);
    } finally {
      setActing(null);
    }
  };

  const net = (matches ?? []).reduce((s, r) => s + (r.netUsd ?? 0), 0);

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-zinc-950/95 backdrop-blur-sm" data-world-ui>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Stake and trade history</h2>
            <p className="text-xs text-zinc-400">For your game wallet {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ''}. Read from the chain and the dreamDEX indexer.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">
              {loading && <Spinner className="h-3 w-3" />}Refresh
            </button>
            <button onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
              Close
            </button>
          </div>
        </div>

        {!wallet.address && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">Create or import a game wallet first.</div>}

        <div className="flex gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
          {(['matches', 'trades'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === t ? 'bg-zinc-800 font-semibold text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {t === 'matches' ? `Matches and stakes${matches ? ` (${matches.length})` : ''}` : `Trades${trades ? ` (${trades.length})` : ''}`}
            </button>
          ))}
        </div>

        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-200">Could not read history: {error}</div>}

        {wallet.address && !error && (matches === null || trades === null) && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
            <p className="text-center text-xs text-zinc-500">Reading your matches from the chain…</p>
          </div>
        )}

        {note && <div className="break-words rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-200">{note}</div>}

        {tab === 'matches' && matches && (
          <div className="space-y-2">
            {matches.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                Escrow result across settled matches: <span className={`font-mono font-semibold ${net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{usd(net)}</span>
              </div>
            )}
            {matches.length === 0 && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">No matches yet. Take a seat in a lobby and it will show up here.</div>}
            {matches.map((r) => (
              <div key={r.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs sm:grid-cols-5">
                <div>
                  <div className="font-bold text-white">{r.id}</div>
                  <div className="text-[10px] text-zinc-500">{when(r.startedAt)}</div>
                </div>
                <div className={r.side === 'bulls' ? 'text-emerald-300' : 'text-rose-300'}>{r.side === 'bulls' ? 'Bulls (long)' : 'Bears (short)'}</div>
                <div className={`font-semibold ${tone[r.outcome]}`}>{r.outcome}</div>
                <div className="font-mono text-zinc-300">{r.stakedUsd ? `staked $${r.stakedUsd}` : 'nothing staked'}</div>
                <div className="font-mono">
                  {r.netUsd === null ? <span className="text-zinc-500">—</span> : <span className={r.netUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{usd(r.netUsd)}</span>}
                  {r.claimed && <span className="ml-1.5 text-[10px] text-zinc-500">claimed</span>}
                </div>
                {r.action && (
                  <button onClick={() => act(r)} disabled={acting !== null} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 sm:col-span-5">
                    {acting === r.id ? 'Sending…' : r.action === 'leave' ? 'Get my stake back' : r.outcome === 'won' ? 'Claim payout' : 'Claim refund'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'trades' && trades && (
          <div className="space-y-2">
            {trades.length === 0 && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">No position changes found for this wallet on dreamDEX yet.</div>}
            {trades.map((t) => (
              <div key={t.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs sm:grid-cols-5">
                <div className="text-zinc-400">{when(t.at)}</div>
                <div className="font-semibold text-white">
                  {t.action} <span className={t.direction === 'long' ? 'text-emerald-300' : 'text-rose-300'}>{t.direction}</span> {t.ticker}
                </div>
                <div className="font-mono text-zinc-300">{t.size.toLocaleString(undefined, { maximumFractionDigits: 6 })}{t.priceUsd ? ` @ $${t.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}</div>
                <div className="font-mono">{t.pnlUsd === null ? <span className="text-zinc-500">—</span> : <span className={t.pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{usd(t.pnlUsd)}</span>}</div>
                <a href={tx(t.txHash)} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2">
                  transaction
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
