'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Lock,
  Unlock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Calculator,
  Sliders,
  Sparkles,
  Users,
} from 'lucide-react';
import { CryptoAsset, GameMatch, PositionSide } from '@/lib/types';
import { calculatePayout, calculateScenarioPayouts, CORE_RULES } from '@/lib/payout';
import { MatchStatusPanel } from './MatchStatusPanel';
import { TugOfWarRope } from './TugOfWarRope';
import { ThreeTugOfWarArena } from './ThreeTugOfWarArena';
import { soundFx } from '@/lib/sound';
import { Box, Flame, Zap } from 'lucide-react';

interface MatchInspectScreenProps {
  market: CryptoAsset;
  selectedSide: PositionSide;
  match: GameMatch;
  onContinueToEntry: (inspectedMatch: GameMatch) => void;
  onBackToMatches: () => void;
  onOpenSpecs: () => void;
}

export const MatchInspectScreen: React.FC<MatchInspectScreenProps> = ({
  market,
  selectedSide,
  match: initialMatch,
  onContinueToEntry,
  onBackToMatches,
  onOpenSpecs,
}) => {
  // Real roster, rebuilt from chain data by the parent
  const bullsCount = initialMatch.bulls;
  const bearsCount = initialMatch.bears;
  const [arenaMode, setArenaMode] = useState<'3d' | '2d'>('3d');

  const totalPlayers = bullsCount + bearsCount;
  const isFull = totalPlayers === CORE_RULES.REQUIRED_PLAYERS;
  const slotsRemaining = Math.max(0, CORE_RULES.REQUIRED_PLAYERS - totalPlayers);

  // Heavily unbalanced condition: signals high volatility when ratio is >= 65% / <= 35% or diff >= 6
  const teamDiff = Math.abs(bullsCount - bearsCount);
  const dominantRatio = totalPlayers > 0 ? Math.max(bullsCount, bearsCount) / totalPlayers : 0.5;
  const isUnbalanced = teamDiff >= 6 || dominantRatio >= 0.65;

  // Subtle tug-o-war pulse animation tailored to the player's selected position side
  const tugPulseClass = selectedSide === 'bulls' ? 'animate-tug-bull' : 'animate-tug-bear';

  // Calculate payouts only when full (Step 5 rule)
  const payouts = isFull
    ? calculateScenarioPayouts({
        bullsCount,
        bearsCount,
        entryFee: CORE_RULES.ENTRY_FEE,
        rake: CORE_RULES.RAKE_RATE,
      })
    : null;

  // Active match payload to pass forward to Step 7
  const currentMatchState: GameMatch = {
    ...initialMatch,
    bulls: bullsCount,
    bears: bearsCount,
    total: totalPlayers,
    slotsRemaining,
    status: initialMatch.status === 'filling' && isFull ? 'full' : initialMatch.status,
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-8">
      {/* Top Header & Breadcrumb Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              soundFx.playClick();
              onBackToMatches();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Inspect Roster: {initialMatch.id}
              </h1>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                  selectedSide === 'bulls'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                Your Pick: {selectedSide === 'bulls' ? 'Bulls (Long)' : 'Bears (Short)'}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Step 5 & 6: Inspect roster composition and evaluate payout formulas.
            </p>
          </div>
        </div>

        {/* Match Metric Badges */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-zinc-300">
            <span className="text-zinc-500">Entry Fee:</span>{' '}
            <strong className="text-white font-mono">$10.00</strong>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-zinc-300">
            <span className="text-zinc-500">Total Players:</span>{' '}
            <strong className="text-white font-mono">{totalPlayers} / 20</strong>
          </div>
          <div
            className={`rounded-xl border px-3 py-2 font-semibold ${
              isFull
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {isFull ? 'Roster Full (20/20)' : `${slotsRemaining} Slots Open`}
          </div>
        </div>
      </div>

      {/* Arena View Switcher & Visual Tug of War Engine with Side-Specific Tug-of-War Pulse Animation */}
      <div className={`space-y-3 rounded-3xl p-3 sm:p-4 border transition-all duration-500 ${tugPulseClass}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                selectedSide === 'bulls' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>
                Tug-of-War Pulse: Pulling toward {selectedSide === 'bulls' ? 'Bulls (Long)' : 'Bears (Short)'}
              </span>
            </span>
            <span className="text-zinc-500">·</span>
            <span className="text-xs text-zinc-400">
              Rhythmic tension wave dynamically active
            </span>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1 text-xs">
            <button
              onClick={() => {
                soundFx.playClick();
                setArenaMode('3d');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                arenaMode === '3d'
                  ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              <span>3D Stadium View</span>
            </button>
            <button
              onClick={() => {
                soundFx.playClick();
                setArenaMode('2d');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                arenaMode === '2d'
                  ? 'bg-emerald-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>3D Braided Rope (CSS)</span>
            </button>
          </div>
        </div>

        {arenaMode === '3d' ? (
          <div className="space-y-3">
            <ThreeTugOfWarArena
              bullsCount={bullsCount}
              bearsCount={bearsCount}
              marketTicker={market}
              selectedSide={selectedSide}
            />
            {/* Compact summary bar underneath 3D canvas */}
            <TugOfWarRope
              bullsCount={bullsCount}
              bearsCount={bearsCount}
              totalPlayers={totalPlayers}
              highlightSide={selectedSide}
              compact
            />
          </div>
        ) : (
          <TugOfWarRope
            bullsCount={bullsCount}
            bearsCount={bearsCount}
            totalPlayers={totalPlayers}
            highlightSide={selectedSide}
          />
        )}
      </div>

      {/* 20 Player Slots Grid Visualizer */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-zinc-400" />
              <span>{CORE_RULES.REQUIRED_PLAYERS}-Seat Arena Roster</span>
            </h2>
            {bullsCount === bearsCount ? (
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Teams Matched 1:1 ({bullsCount} Bulls = {bearsCount} Bears)</span>
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Users className="h-3 w-3" />
                <span>{bullsCount} Bulls vs {bearsCount} Bears (Rendered Side-by-Side)</span>
              </span>
            )}
          </div>
          <span className="text-xs text-zinc-500 font-mono">
            {bullsCount} Bulls · {bearsCount} Bears · {slotsRemaining} Open Slots
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {Array.from({ length: CORE_RULES.REQUIRED_PLAYERS }).map((_, idx) => {
            const slotNum = idx + 1;
            let slotType: 'bull' | 'bear' | 'empty' = 'empty';
            let label = `Slot #${slotNum}`;

            if (slotNum <= bullsCount) {
              slotType = 'bull';
              label = `Bull #${slotNum}`;
            } else if (slotNum <= bullsCount + bearsCount) {
              slotType = 'bear';
              label = `Bear #${slotNum - bullsCount}`;
            }

            return (
              <div
                key={idx}
                className={`relative flex items-center gap-2.5 p-3 rounded-xl border transition-all text-xs ${
                  slotType === 'bull'
                    ? 'border-emerald-500/30 bg-emerald-950/20 text-zinc-200'
                    : slotType === 'bear'
                    ? 'border-rose-500/30 bg-rose-950/20 text-zinc-200'
                    : 'border-dashed border-zinc-800 bg-zinc-950/40 text-zinc-500'
                }`}
              >
                <div
                  className={`h-6 w-6 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${
                    slotType === 'bull'
                      ? 'bg-emerald-500 text-zinc-950'
                      : slotType === 'bear'
                      ? 'bg-rose-500 text-white'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {slotType === 'bull' ? 'B' : slotType === 'bear' ? 'S' : slotNum}
                </div>
                <div className="overflow-hidden">
                  <div className="font-semibold truncate">
                    {slotType === 'empty' ? 'Open Seat' : label}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate font-mono">
                    {slotType === 'empty' ? 'Waiting player' : '$10.00 Committed'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <MatchStatusPanel match={initialMatch} />

      {/* Step 5 Capacity Check & Payout Visibility */}
      {!isFull ? (
        /* CASE 1: Players < 20 -> HIDE PAYOUT ESTIMATE */
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/50 p-6 sm:p-8 space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-400 border border-zinc-700/80 shrink-0">
              <Lock className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  Step 5 Algorithm Rule Enforced
                </span>
                <span className="text-xs text-zinc-500">·</span>
                <span className="text-xs text-zinc-400 font-mono">
                  {totalPlayers} of {CORE_RULES.REQUIRED_PLAYERS} Players Present
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">
                Payout Estimates Are Hidden Until Match Reaches 20/20
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-3xl">
                Because every winning player’s payout depends strictly on the final locked ratio of winning vs losing players (<span className="text-zinc-200 font-mono">P = e + (1 - r)eL / W</span>), the algorithm does not display premature payout quotes while seats remain open.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 text-xs space-y-2">
            <div className="font-semibold text-zinc-200 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400" />
              <span>Current Roster Summary:</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-zinc-400">
              <div>
                <span className="text-zinc-500">Bulls (Long):</span>{' '}
                <strong className="text-emerald-400 font-mono">{bullsCount}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Bears (Short):</span>{' '}
                <strong className="text-rose-400 font-mono">{bearsCount}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Current Total:</span>{' '}
                <strong className="text-white font-mono">{totalPlayers}</strong>
              </div>
              <div>
                <span className="text-zinc-500">Remaining Slots:</span>{' '}
                <strong className="text-amber-400 font-mono">{slotsRemaining}</strong>
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <span />

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {isUnbalanced && (
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300">
                  <Flame className="h-3.5 w-3.5 text-amber-400" />
                  <span>High Volatility Pool ({bullsCount} vs {bearsCount})</span>
                </div>
              )}
              <button
                onClick={() => {
                  soundFx.playClick();
                  onContinueToEntry(currentMatchState);
                }}
                className={`flex items-center justify-center gap-2 rounded-xl font-bold text-xs py-3 px-6 transition-all shadow-md ${
                  isUnbalanced
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black animate-volatility-shake shadow-amber-500/30 ring-2 ring-amber-400/60'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                }`}
              >
                {isUnbalanced && <Flame className="h-4 w-4 text-zinc-950" />}
                <span>Join Match ({slotsRemaining} slots left)</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* CASE 2: Players === 20 -> STEP 6 CALCULATE & SHOW FULL PAYOUT */
        <div className="rounded-3xl border-2 border-emerald-500/40 bg-zinc-900/90 p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shrink-0">
                <Calculator className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Step 6 — Roster Full (20/20)
                  </span>
                  <span className="text-xs text-zinc-500">·</span>
                  <span className="text-xs text-zinc-400 font-mono">$200 Total Locked Pool</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">
                  Authoritative Payout Calculation Matrix
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Formula:</span>
              <code className="text-xs bg-zinc-950 border border-zinc-800 text-emerald-400 px-2.5 py-1 rounded font-mono">
                P = e + (1 - r)·e·L / W
              </code>
            </div>
          </div>

          {/* Mathematical Parameter Glossary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-zinc-950/70 p-4 rounded-2xl border border-zinc-800/80">
            <div>
              <span className="text-zinc-500">Entry Fee (e):</span>
              <div className="font-mono font-bold text-white text-sm">$10.00</div>
            </div>
            <div>
              <span className="text-zinc-500">Platform Rake (r):</span>
              <div className="font-mono font-bold text-white text-sm">10% (0.10)</div>
            </div>
            <div>
              <span className="text-zinc-500">Current Bulls (B):</span>
              <div className="font-mono font-bold text-emerald-400 text-sm">{bullsCount} players</div>
            </div>
            <div>
              <span className="text-zinc-500">Current Bears (S):</span>
              <div className="font-mono font-bold text-rose-400 text-sm">{bearsCount} players</div>
            </div>
          </div>

          {/* DUAL SCENARIO PAYOUT BREAKDOWN TABLE & CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* SCENARIO A: IF BULLS WIN */}
            {payouts?.bullsWin && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/20 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <TrendingUp className="h-5 w-5" />
                    <span>OUTCOME A: BULLS WIN</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">Price Rises</span>
                </div>

                <div className="space-y-2 text-xs border-y border-emerald-500/20 py-3">
                  <div className="flex justify-between text-zinc-400">
                    <span>Winning Players (W):</span>
                    <strong className="text-white font-mono">{payouts.bullsWin.winningPlayers} Bulls</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Losing Players (L):</span>
                    <strong className="text-white font-mono">{payouts.bullsWin.losingPlayers} Bears</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Losing Pool (e × L):</span>
                    <strong className="text-white font-mono">${payouts.bullsWin.losingPool.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Platform Rake (10%):</span>
                    <strong className="text-amber-400 font-mono">-${payouts.bullsWin.platformRake.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Redistributed Pool (90%):</span>
                    <strong className="text-emerald-400 font-mono">${payouts.bullsWin.redistributedPool.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Share per Winner:</span>
                    <strong className="text-zinc-200 font-mono">
                      +${(payouts.bullsWin.redistributedPool / payouts.bullsWin.winningPlayers).toFixed(2)}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-zinc-950/80 p-3.5 rounded-xl border border-emerald-500/30">
                  <div>
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider">
                      Payout per Winner (P)
                    </div>
                    <div className="text-2xl font-black text-emerald-400 font-mono tabular-nums">
                      ${payouts.bullsWin.payoutPerWinner.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider">
                      Net Profit / ROI
                    </div>
                    <div className="text-base font-bold text-white font-mono tabular-nums">
                      +${payouts.bullsWin.netProfitPerWinner.toFixed(2)}{' '}
                      <span className="text-emerald-400 text-xs">
                        (+{payouts.bullsWin.roiPercentage.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCENARIO B: IF BEARS WIN */}
            {payouts?.bearsWin && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-950/20 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400 font-bold">
                    <TrendingDown className="h-5 w-5" />
                    <span>OUTCOME B: BEARS WIN</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">Price Falls</span>
                </div>

                <div className="space-y-2 text-xs border-y border-rose-500/20 py-3">
                  <div className="flex justify-between text-zinc-400">
                    <span>Winning Players (W):</span>
                    <strong className="text-white font-mono">{payouts.bearsWin.winningPlayers} Bears</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Losing Players (L):</span>
                    <strong className="text-white font-mono">{payouts.bearsWin.losingPlayers} Bulls</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Losing Pool (e × L):</span>
                    <strong className="text-white font-mono">${payouts.bearsWin.losingPool.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Platform Rake (10%):</span>
                    <strong className="text-amber-400 font-mono">-${payouts.bearsWin.platformRake.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Redistributed Pool (90%):</span>
                    <strong className="text-rose-400 font-mono">${payouts.bearsWin.redistributedPool.toFixed(2)}</strong>
                  </div>
                  <div className="flex justify-between text-zinc-400">
                    <span>Share per Winner:</span>
                    <strong className="text-zinc-200 font-mono">
                      +${(payouts.bearsWin.redistributedPool / payouts.bearsWin.winningPlayers).toFixed(2)}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-zinc-950/80 p-3.5 rounded-xl border border-rose-500/30">
                  <div>
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider">
                      Payout per Winner (P)
                    </div>
                    <div className="text-2xl font-black text-rose-400 font-mono tabular-nums">
                      ${payouts.bearsWin.payoutPerWinner.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-zinc-400 uppercase tracking-wider">
                      Net Profit / ROI
                    </div>
                    <div className="text-base font-bold text-white font-mono tabular-nums">
                      +${payouts.bearsWin.netProfitPerWinner.toFixed(2)}{' '}
                      <span className="text-rose-400 text-xs">
                        (+{payouts.bearsWin.roiPercentage.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Row */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
            <button
              onClick={onOpenSpecs}
              className="text-xs text-zinc-400 hover:text-white underline underline-offset-4"
            >
              Learn why payout depends on final composition &rarr;
            </button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
              {isUnbalanced && (
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
                  <Flame className="h-4 w-4 text-amber-400" />
                  <span>High Volatility Asymmetry ({bullsCount} vs {bearsCount})</span>
                </div>
              )}
              <button
                onClick={() => {
                  soundFx.playClick();
                  onContinueToEntry(currentMatchState);
                }}
                className={`w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl font-black text-sm py-3 px-8 transition-transform shadow-lg ${
                  isUnbalanced
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 animate-volatility-shake shadow-amber-500/40 ring-2 ring-amber-400'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 hover:scale-[1.02] shadow-emerald-500/25'
                }`}
              >
                {isUnbalanced && <Flame className="h-4 w-4 text-zinc-950" />}
                <span>Join Match (Step 7 Entry Confirmation)</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
