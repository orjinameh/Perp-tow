'use client';

import { Spinner } from '@/components/ProgressModal';
import { useProgress } from '@/lib/useProgress';
import { LEVERAGE, LEVERAGE_OPTIONS, MATCH_SIZE, NOMINAL_STAKE_USD } from '@/lib/gameTag';
import React from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  CheckCircle,
  Clock,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { CryptoAsset, GameMatch, PositionSide } from '@/lib/types';
import { calculatePayout, CORE_RULES } from '@/lib/payout';
import { soundFx } from '@/lib/sound';
import { GameWallet } from '@/lib/useGameWallet';
import type { EntryReceipt } from '@/lib/trading';

interface EntryConfirmScreenProps {
  market: CryptoAsset;
  selectedSide: PositionSide;
  match: GameMatch;
  wallet: GameWallet;
  pool: string;
  onEntered: (receipt: EntryReceipt) => void;
  onBackToInspect: () => void;
}

export const EntryConfirmScreen: React.FC<EntryConfirmScreenProps> = ({
  market,
  selectedSide,
  match,
  wallet,
  pool,
  onEntered,
  onBackToInspect,
}) => {
  const isFull = match.total === MATCH_SIZE;
  const [busy, setBusy] = React.useState(false);
  const progress = useProgress();
  const [leverage, setLeverage] = React.useState<number>(LEVERAGE);
  const [error, setError] = React.useState<string | null>(null);

  // The last seat must not make the roster one-sided.
  const lobbyClosed = match.status !== 'filling';
  const sideBlocked = match.total === MATCH_SIZE - 1 && (selectedSide === 'bulls' ? match.bears === 0 : match.bulls === 0);

  const placeEntry = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setError(null);
    const out = await progress.run('Taking your seat', ['Sign and send the seat transaction', 'Waiting for the chain to confirm'], async (advance) => {
      // Loaded only now, in the browser, so the SDK never runs during server rendering.
      const { enterRegistry } = await import('@/lib/registry');
      const { addPending } = await import('@/lib/pending');
      const number = Number(match.id.split('#')[1]);
      // The seat comes first: a full or closed lobby is refused here.
      advance(0);
      const seatTx = await enterRegistry(wallet.key as string, market, number, selectedSide);
      advance(1);
      // The real trade is placed automatically when the match locks, by this browser tab.
      addPending({ ticker: market, pool, number, side: selectedSide, address: wallet.address as string, placed: false, leverage });
      return seatTx;
    });
    setBusy(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    const receipt: EntryReceipt = { txHash: out.value, orderId: null, quantity: 0, filledQuantity: 0, price: 0, notionalUsd: 0, raisedToMinimum: false, seatOnly: true };
    soundFx.playEntrySuccess();
    onEntered(receipt);
  };

  // Potential payout if user's chosen side wins
  const winnerCount = selectedSide === 'bulls' ? match.bulls : match.bears;
  const loserCount = selectedSide === 'bulls' ? match.bears : match.bulls;

  const estimatedPayout = isFull && winnerCount > 0
    ? calculatePayout({
        entryFee: CORE_RULES.ENTRY_FEE,
        winnerCount,
        loserCount,
        rake: CORE_RULES.RAKE_RATE,
      })
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-7">
      {/* Top Header */}
      <div className="flex items-center gap-4 border-b border-zinc-800 pb-5">
        <button
          onClick={() => {
            soundFx.playClick();
            onBackToInspect();
          }}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Step 7 — Entry Confirmation
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Review Match Entry Details
          </h1>
        </div>
      </div>

      {/* Main Ticket Card */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-zinc-700 bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 p-6 sm:p-8 shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-200 border border-zinc-700 font-black text-xl">
              {market}
            </div>
            <div>
              <div className="text-xs text-zinc-500 font-mono">TUG OF WAR ENTRY TICKET</div>
              <h2 className="text-lg font-bold text-white">{match.id}</h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                selectedSide === 'bulls'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {selectedSide === 'bulls' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              <span>{selectedSide === 'bulls' ? 'Team Bulls (Long)' : 'Team Bears (Short)'}</span>
            </span>
          </div>
        </div>

        {/* Ticket Details Grid */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-1">
            <span className="text-zinc-500">Asset & Market Isolation</span>
            <div className="text-base font-bold text-white flex items-center gap-2">
              <span>{market} / USD</span>
              <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                Isolated
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Only {market} players can join this match pool.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-1">
            <span className="text-zinc-500">Entry Fee (Stake)</span>
            <div className="text-base font-bold text-white font-mono">$10.00 USD</div>
            <p className="text-[11px] text-zinc-500">
              Fixed buy-in (${NOMINAL_STAKE_USD * MATCH_SIZE} total pool at {MATCH_SIZE} players).
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-2">
            <span className="text-zinc-500">Your leverage</span>
            <div className="flex flex-wrap gap-1.5">
              {LEVERAGE_OPTIONS.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => setLeverage(x)}
                  className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-bold ${leverage === x ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}
                >
                  {x}x
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              Sizes your real position: ${NOMINAL_STAKE_USD} × {leverage} = ${NOMINAL_STAKE_USD * leverage} of exposure. It never changes who wins: the match is decided by price direction alone.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-1">
            <span className="text-zinc-500">Roster Capacity Status</span>
            <div className="text-base font-bold text-white font-mono">
              {match.total} / {MATCH_SIZE} Players
            </div>
            <p className="text-[11px] text-zinc-500">
              {match.bulls} Bulls · {match.bears} Bears · {match.slotsRemaining} Slots Open
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-1">
            <span className="text-zinc-500">Estimated Payout Status</span>
            {isFull && estimatedPayout ? (
              <div>
                <div className="text-base font-bold text-emerald-400 font-mono">
                  ${estimatedPayout.payoutPerWinner.toFixed(2)}{' '}
                  <span className="text-xs text-zinc-400 font-normal">
                    (+${estimatedPayout.netProfitPerWinner.toFixed(2)} profit)
                  </span>
                </div>
                <p className="text-[11px] text-emerald-500/80">
                  Calculated based on final {MATCH_SIZE}-player roster.
                </p>
              </div>
            ) : (
              <div>
                <div className="text-base font-semibold text-amber-400">
                  Hidden / Pending
                </div>
                <p className="text-[11px] text-zinc-500">
                  Revealed once all {MATCH_SIZE} slots fill (Step 5 rule).
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Prototype Demo Disclaimer Banner */}
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-xs text-zinc-400">
          <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-zinc-200">How this works:</span>
            <p className="leading-relaxed">
              Confirming takes your seat on chain. Nothing is staked yet: while the lobby is open you can study the chart and leave if you change your mind.
              At the lock, the same moment for every player, this browser tab puts in your $10 stake (when the escrow is on) and places a real market order from your game wallet to the {market}-PERP pool on dreamDEX Hideki testnet,
              in the direction you picked (Bulls = long, Bears = short), using paper USDso as margin. Keep this tab open. If the tab is closed through the
              whole 60-second trade window, you are simply out of the match.
            </p>
            {!wallet.address && (
              <p className="text-amber-300">Create or import a game wallet in the bar at the top of the page first.</p>
            )}
            {match.total >= MATCH_SIZE && (
              <p className="text-amber-300">This match already has {MATCH_SIZE} players. Open a new match instead.</p>
            )}
            {sideBlocked && <p className="text-amber-300">This match needs both teams, and only one seat is left. Pick the other side or join another match.</p>}
            {error && <p className="text-rose-300">Entry failed: {error}</p>}
          </div>
        </div>

        {/* Confirm Button */}
        <div className="mt-7 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-zinc-800/80">
          <button
            onClick={() => {
              soundFx.playClick();
              onBackToInspect();
            }}
            className="text-xs text-zinc-400 hover:text-white underline underline-offset-4"
          >
            &larr; Back to matches
          </button>

          <button
            disabled={busy || !wallet.address || match.total >= MATCH_SIZE || sideBlocked || lobbyClosed}
            onClick={placeEntry}
            className="w-full sm:w-auto disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-sm py-3.5 px-8 shadow-xl shadow-emerald-500/30 transition-transform hover:scale-[1.02]"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Ticket className="h-4 w-4" />}
            <span>{busy ? 'Taking your seat…' : 'Take my seat'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {progress.modal}
    </div>
  );
};
