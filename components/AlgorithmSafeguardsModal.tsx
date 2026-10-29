'use client';

import React, { useEffect, useState } from 'react';
import { X, BookOpen } from 'lucide-react';
import { calculatePayout } from '@/lib/payout';
import { readSquadParams, squadsEnabled } from '@/lib/squads';
import { soundFx } from '@/lib/sound';

interface AlgorithmSafeguardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const mins = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

interface Rules { stake: number; bankroll: number; rake: number; size: number; lobby: number; confirm: number; duration: number; live: boolean }
const FALLBACK: Rules = { stake: 10, bankroll: 50, rake: 0.2, size: 20, lobby: 120, confirm: 60, duration: 300, live: false };

/** The rules of the game in plain words, read from the deployed contract when it is reachable. */
export const AlgorithmSafeguardsModal: React.FC<AlgorithmSafeguardsModalProps> = ({ isOpen, onClose }) => {
  const [r, setR] = useState<Rules>(FALLBACK);
  const [total, setTotal] = useState(8);
  const [bulls, setBulls] = useState(5);

  useEffect(() => {
    if (!isOpen || !squadsEnabled) return;
    let stop = false;
    readSquadParams()
      .then((p) => { if (!stop) setR({ stake: p.stakeUsd, bankroll: p.bankrollUsd, rake: p.rake, size: p.size, lobby: p.lobbySeconds, confirm: p.confirmSeconds, duration: p.duration, live: true }); })
      .catch(() => {});
    return () => { stop = true; };
  }, [isOpen]);

  // Escape closes it, and the page behind does not scroll while it is open
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const n = Math.max(2, Math.min(total, r.size));
  const b = Math.max(1, Math.min(bulls, n - 1));
  const e = n - b;
  const ifBulls = calculatePayout({ entryFee: r.stake, winnerCount: b, loserCount: e, rake: r.rake });
  const ifBears = calculatePayout({ entryFee: r.stake, winnerCount: e, loserCount: b, rake: r.rake });

  const steps = [
    `Pick a market and open a match room, or join one. You choose the room size (2 to ${r.size} players). Taking a seat costs a ${usd(r.stake)} USDso stake.`,
    `At the same moment you get your own trading account, a "vault", funded with ${usd(r.bankroll)} of play money (your bankroll). It is the same for every player and comes back to you after the match.`,
    `You are put on team Bulls or team Bears at random the moment you sit. Nobody picks a side, and teams can be uneven, such as 15 against 5.`,
    `The lobby stays open for ${mins(r.lobby)} after the first seat. A full room starts at once. If it ends short of full, the seated players get ${mins(r.confirm)} to confirm "continue with fewer players", and the match is cancelled and refunded if either team ends up empty.`,
    `Then everyone trades freely for ${mins(r.duration)} with real market orders on dreamDEX from their own vault: buy or sell, as often as you like. You can trade by hand or run your own script in the bot box.`,
    `Each team is scored by the average gain of its players' vaults, so team size is never an advantage. The better average wins; a tie refunds everyone. The contract reads the numbers from dreamDEX itself, and anyone can press Settle.`,
    `Winners get their stake back plus a share of the losing team's stakes, and every player's bankroll goes back to them.`,
  ];

  return (
    <div className="fixed inset-0 z-[95] overflow-y-auto overscroll-contain bg-zinc-950/80 backdrop-blur-md" data-world-ui style={{ touchAction: 'pan-y' }} onClick={onClose} role="dialog" aria-modal="true" aria-label="How Perp Tug of War works">
     <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-5">
      <div className="relative w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-3xl border-b border-zinc-800/80 bg-zinc-950/95 px-6 py-4">
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
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs leading-relaxed text-emerald-100">
            <b>In one minute:</b> you join a room, you are randomly made a Bull or a Bear, and everyone trades real perps with the same play money. The team whose players gained more on average wins the other team&apos;s stakes. Testnet only, nothing here is real money.
          </div>

          <ol className="space-y-2.5">
            {steps.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-300">{i + 1}</span>
                <span className="leading-relaxed">{t}</span>
              </li>
            ))}
          </ol>

          <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">Payout calculator</h3>
              <span className="font-mono text-[11px] text-zinc-500">payout = stake + {Math.round((1 - r.rake) * 100)}% × stake × losers ÷ winners</span>
            </div>
            <label className="flex items-center gap-3 text-xs text-zinc-400">
              Players in the room
              <input type="range" min={2} max={Math.max(2, r.size)} value={n} onChange={(ev) => setTotal(Number(ev.target.value))} className="flex-1 accent-emerald-500" />
              <span className="font-mono text-white">{n}</span>
            </label>
            <label className="flex items-center gap-3 text-xs text-zinc-400">
              Bulls (the rest are Bears)
              <input type="range" min={1} max={Math.max(1, n - 1)} value={b} onChange={(ev) => setBulls(Number(ev.target.value))} className="flex-1 accent-emerald-500" />
              <span className="font-mono text-white">{b} v {e}</span>
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
            <p className="text-[11px] text-zinc-500">{Math.round(r.rake * 100)}% of the losing stakes is the rake. Teams are scored by average gain, so a smaller team is not at a disadvantage, but it does earn more per player when it wins. This is a calculator, not a result.{r.live ? '' : ' (Showing default settings: the contract could not be read.)'}</p>
          </div>

          <div className="space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <h3 className="text-sm font-bold text-white">What to trust, and what not to</h3>
            <p>Stakes and vaults are held by one contract on the Somnia Hideki testnet. Nobody posts the result: it is computed on chain from each vault&apos;s real dreamDEX account. The operator can only collect the rake. If a match is never settled, everyone can reclaim their stake after a grace period.</p>
            <p>Each vault trades only for its owner and pays only its owner. Your game wallet key is encrypted in this browser with your PIN.</p>
            <p>Known limits: one person with several wallets could collude across teams, team draws use the previous block&apos;s hash, and nobody settles automatically unless a player&apos;s tab is open. See SECURITY.md in the repository.</p>
          </div>

          <button onClick={() => { soundFx.playClick(); onClose(); }} className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400">Got it</button>
        </div>
      </div>
     </div>
    </div>
  );
};
