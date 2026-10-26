'use client';

import React, { useState } from 'react';
import { X, BookOpen } from 'lucide-react';
import { MATCH_SIZE, LOBBY_SECONDS, CONFIRM_SECONDS, TRADE_SECONDS, MATCH_DURATION_SEC } from '@/lib/gameTag';
import { calculatePayout, CORE_RULES } from '@/lib/payout';
import { soundFx } from '@/lib/sound';

interface AlgorithmSafeguardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const mins = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** The rules of the game, written from the same settings the game itself runs on. */
export const AlgorithmSafeguardsModal: React.FC<AlgorithmSafeguardsModalProps> = ({ isOpen, onClose }) => {
  const [bulls, setBulls] = useState(Math.max(1, Math.floor(MATCH_SIZE / 2)));
  if (!isOpen) return null;
  const bears = Math.max(1, MATCH_SIZE - bulls);
  const ifBulls = calculatePayout({ entryFee: CORE_RULES.ENTRY_FEE, winnerCount: bulls, loserCount: bears, rake: CORE_RULES.RAKE_RATE });
  const ifBears = calculatePayout({ entryFee: CORE_RULES.ENTRY_FEE, winnerCount: bears, loserCount: bulls, rake: CORE_RULES.RAKE_RATE });

  const steps = [
    `Pick a perp market and a side: Bulls (long) or Bears (short). Take a seat in a lobby. Nothing is staked yet.`,
    `The lobby stays open for ${mins(LOBBY_SECONDS)} after its first player. Study the chart. A match of ${MATCH_SIZE} locks the moment it is full and needs both teams.`,
    `If the lobby ends short of full, the players who are in get ${mins(CONFIRM_SECONDS)} to say "continue with fewer players". Anyone who does not answer is out. If either team ends up empty, the match is cancelled.`,
    `At the lock, for ${TRADE_SECONDS} seconds, every player's tab stakes ${usd(CORE_RULES.ENTRY_FEE)} USDso in the escrow and places a real market order on the dreamDEX perp pool, long for Bulls and short for Bears, at the leverage the player chose.`,
    `The price clock then runs for ${mins(MATCH_DURATION_SEC)}. If the market's price is higher at the end than at the start, Bulls win. If it is lower, Bears win. An exact tie is a refund.`,
    `Winners claim their stake back plus a share of the losing pool. Losers lose their stake. If the result is never posted, everyone can reclaim their stake.`,
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/80 p-3 backdrop-blur-md sm:p-5">
      <div className="relative my-8 w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">How Perp Tug of War works</h2>
              <p className="text-xs text-zinc-400">The rules, the payout and what to trust</p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playClick();
              onClose();
            }}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-6 text-sm text-zinc-300">
          <ol className="space-y-2.5">
            {steps.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-300">{i + 1}</span>
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ol>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs leading-relaxed text-emerald-100">
            <b>The result never depends on head count or leverage.</b> Only the price direction decides who wins. Leverage only changes the size of your own real position.
          </div>

          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">Payout calculator</h3>
              <span className="font-mono text-[11px] text-zinc-500">payout = stake + {(1 - CORE_RULES.RAKE_RATE) * 100}% × stake × losers ÷ winners</span>
            </div>
            <label className="flex items-center gap-3 text-xs text-zinc-400">
              Bulls in a full match of {MATCH_SIZE}
              <input type="range" min={1} max={Math.max(1, MATCH_SIZE - 1)} value={bulls} onChange={(e) => setBulls(Number(e.target.value))} className="flex-1 accent-emerald-500" />
              <span className="font-mono text-white">{bulls} v {bears}</span>
            </label>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-zinc-800 p-3">
                <div className="font-semibold text-emerald-300">If Bulls win</div>
                <div className="mt-1 font-mono text-white">{ifBulls ? usd(ifBulls.payoutPerWinner) : '—'} each</div>
                <div className="text-zinc-500">profit {ifBulls ? usd(ifBulls.netProfitPerWinner) : '—'}</div>
              </div>
              <div className="rounded-xl border border-zinc-800 p-3">
                <div className="font-semibold text-rose-300">If Bears win</div>
                <div className="mt-1 font-mono text-white">{ifBears ? usd(ifBears.payoutPerWinner) : '—'} each</div>
                <div className="text-zinc-500">profit {ifBears ? usd(ifBears.netProfitPerWinner) : '—'}</div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">{CORE_RULES.RAKE_RATE * 100}% of the losing pool is the rake and stays in the escrow for the operator. This is a calculator, not a result.</p>
          </div>

          <div className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <h3 className="text-sm font-bold text-white">What to trust</h3>
            <p>Seats and stakes are held by contracts on the Somnia Hideki testnet. The seat registry holds no money. The escrow holds the stakes and pays them out.</p>
            <p>The escrow operator posts the final result, computed from public dreamDEX candle data. It cannot take stakes, only the rake of a settled match. If it never posts a result, every player can reclaim their stake after a grace period.</p>
            <p>The game wallet is created in this browser for the testnet only. Do not put a key that holds real funds into it.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
