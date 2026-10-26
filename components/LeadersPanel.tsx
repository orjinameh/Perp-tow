'use client';

import React, { useEffect, useState } from 'react';
import { MarketQueueData } from '@/lib/types';
import { Leader, loadLeaders } from '@/lib/leaders';
import { LEVERAGE, NOMINAL_STAKE_USD } from '@/lib/gameTag';
import { GameWallet } from '@/lib/useGameWallet';
import { useCopyTrade } from '@/lib/useCopyTrade';
import { Skeleton } from '@/components/Skeleton';
import { Spinner } from '@/components/ProgressModal';

type Copy = ReturnType<typeof useCopyTrade>;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Most profitable traders per market, from dreamDEX's own position records, with a Copy button. */
export const LeadersPanel: React.FC<{ markets: MarketQueueData[]; wallet: GameWallet; copy: Copy; onClose: () => void }> = ({ markets, wallet, copy, onClose }) => {
  const [ticker, setTicker] = useState(markets[0]?.ticker ?? '');
  const [rows, setRows] = useState<Leader[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Leader | null>(null);
  const [copyCurrent, setCopyCurrent] = useState(false);
  const [starting, setStarting] = useState(false);
  const market = markets.find((m) => m.ticker === ticker);

  useEffect(() => {
    if (!market) return;
    let off = false;
    setRows(null);
    setError(null);
    loadLeaders(market.pool, market.baseDecimals)
      .then((r) => {
        if (!off) setRows(r);
      })
      .catch((e) => {
        if (!off) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      off = true;
    };
  }, [market?.pool, market?.baseDecimals]); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    if (!confirm || !market) return;
    setStarting(true);
    try {
      await copy.start(confirm.account, market.ticker, market.pool, copyCurrent);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-zinc-950/95 backdrop-blur-sm" data-world-ui>
      <div className="mx-auto max-w-4xl px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">Leaders</h2>
            <p className="text-xs text-zinc-400">Most profitable traders on each market, read from dreamDEX position records. Past profit does not predict future profit.</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">
            Close
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
          {markets.map((m) => (
            <button
              key={m.ticker}
              onClick={() => setTicker(m.ticker)}
              className={`shrink-0 rounded-lg px-3 py-1.5 ${ticker === m.ticker ? 'bg-zinc-800 font-semibold text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {m.ticker}
            </button>
          ))}
        </div>

        {copy.follow && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-200 flex flex-wrap items-center justify-between gap-2">
            <span>
              Copying {short(copy.follow.leader)} on {copy.follow.ticker}
              {copy.leaderNow ? ` · they are ${copy.leaderNow}` : ''}
            </span>
            <button onClick={() => copy.stop()} className="rounded-lg border border-emerald-500/40 px-3 py-1 font-semibold hover:bg-emerald-500/10">
              Stop copying
            </button>
          </div>
        )}

        {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-200">Could not read leaders: {error}</div>}

        {!error && rows === null && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
            <p className="text-center text-xs text-zinc-500">Reading {ticker} traders from dreamDEX…</p>
          </div>
        )}

        {!error && rows && rows.length === 0 && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">No profitable {ticker} traders found yet.</div>}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((l, i) => {
              const win = l.closes ? Math.round((l.wins / l.closes) * 100) : null;
              const mine = copy.follow?.leader.toLowerCase() === l.account.toLowerCase() && copy.follow?.ticker === ticker;
              return (
                <div key={l.account} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 grid grid-cols-2 sm:grid-cols-[2rem_1.4fr_1fr_1fr_1.3fr_auto] items-center gap-x-3 gap-y-1 text-xs">
                  <div className="font-mono text-zinc-500">#{i + 1}</div>
                  <span className="font-mono text-zinc-200" title={l.account}>{short(l.account)}</span>
                  <div>
                    <div className="text-[10px] text-zinc-500">Realised profit</div>
                    <div className="font-mono font-semibold text-emerald-400">{usd(l.pnlUsd)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">Win rate (last {l.closes} closes)</div>
                    <div className="font-mono text-zinc-200">{win === null ? 'n/a' : `${win}%`}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500">Holding now</div>
                    <div className={`font-mono ${l.direction === 'long' ? 'text-emerald-300' : l.direction === 'short' ? 'text-rose-300' : 'text-zinc-400'}`}>
                      {l.direction === 'flat' ? 'Flat' : `${l.direction === 'long' ? 'Long' : 'Short'} ${l.sizeBase.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ ${usd(l.entryUsd)}`}
                    </div>
                    <div className="text-[10px] text-zinc-500">active {ago(l.lastActive)}</div>
                  </div>
                  <button
                    disabled={!wallet.address || mine}
                    onClick={() => setConfirm(l)}
                    className="col-span-2 sm:col-span-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {mine ? 'Copying' : 'Copy'}
                  </button>
                </div>
              );
            })}
            <p className="text-[11px] text-zinc-500">
              The most profitable accounts are often automated market makers. Copying mirrors direction only: new trades, a few seconds late, while this tab is open.
            </p>
          </div>
        )}

        {copy.events.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 space-y-1">
            <div className="text-[11px] font-semibold text-zinc-300">Copy activity</div>
            {copy.events.map((e) => (
              <div key={e.at + e.text} className={`text-[11px] break-all ${e.error ? 'text-amber-300' : 'text-zinc-400'}`}>
                {new Date(e.at).toLocaleTimeString()} · {e.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-200">
            <div className="font-bold text-white">Copy {short(confirm.account)} on {ticker}?</div>
            <p className="text-xs text-zinc-400">
              Your game wallet will go long, short or flat to match their direction, using ${NOMINAL_STAKE_USD} margin at {LEVERAGE}x (about ${NOMINAL_STAKE_USD * LEVERAGE} of exposure) each time. It needs STT for gas and USDso in margin, and it works only while this tab stays open.
              Copying and a match seat on the same market share one position, so copying pauses while you hold a seat there.
            </p>
            <label className="flex items-start gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={copyCurrent} onChange={(e) => setCopyCurrent(e.target.checked)} className="mt-0.5" />
              <span>Also copy their current position now ({confirm.direction === 'flat' ? 'they are flat' : `they are ${confirm.direction}`}). Otherwise I wait for their next change.</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-xl bg-zinc-800 py-2 text-xs font-semibold hover:bg-zinc-700">
                Cancel
              </button>
              <button onClick={begin} disabled={starting} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-60">
                {starting && <Spinner className="h-3 w-3" />}Start copying
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
