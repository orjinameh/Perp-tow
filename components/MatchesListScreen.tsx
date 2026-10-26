'use client';

import { MatchListSkeleton } from '@/components/Skeleton';
import { MATCH_SIZE, NOMINAL_STAKE_USD } from '@/lib/gameTag';
import { matchPull } from '@/lib/matches';
import React, { useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowRight,
  Users,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Info,
} from 'lucide-react';
import { CryptoAsset, GameMatch, PositionSide } from '@/lib/types';
import { ThreeTugOfWarArena } from './ThreeTugOfWarArena';
import { soundFx } from '@/lib/sound';
import { Box, Eye } from 'lucide-react';

interface MatchesListScreenProps {
  market: CryptoAsset;
  selectedSide: PositionSide;
  matches: GameMatch[];
  loading: boolean;
  error: string | null;
  onSelectMatch: (match: GameMatch) => void;
  onOpenNewMatch: () => void;
  onBackToChart: () => void;
}

export const MatchesListScreen: React.FC<MatchesListScreenProps> = ({
  market,
  selectedSide,
  matches,
  loading,
  error,
  onSelectMatch,
  onOpenNewMatch,
  onBackToChart,
}) => {
  const [filterState, setFilterState] = useState<'all' | 'filling' | 'full'>('all');
  const [previewMatchId, setPreviewMatchId] = useState<string>(matches[0]?.id || '');
  const [show3DArena, setShow3DArena] = useState<boolean>(true);

  const activePreviewMatch = matches.find((m) => m.id === previewMatchId) || matches[0];

  const filteredMatches = matches.filter((m) => {
    if (filterState === 'filling') return m.status === 'filling';
    if (filterState === 'full') return m.status !== 'filling';
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-7">
      {/* Navigation Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              soundFx.playClick();
              onBackToChart();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {market} Active Matches
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
              Step 4: Select an active match to inspect its roster composition.
            </p>
          </div>
        </div>

        {/* Filter Segmented Controls */}
        <div className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/80 p-1 text-xs overflow-x-auto max-w-full scrollbar-none">
          <button
            onClick={() => {
              soundFx.playClick();
              setFilterState('all');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filterState === 'all'
                ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All Matches ({matches.length})
          </button>
          <button
            onClick={() => {
              soundFx.playClick();
              setFilterState('filling');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filterState === 'filling'
                ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Open Slots Only
          </button>
          <button
            onClick={() => {
              soundFx.playClick();
              setFilterState('full');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              filterState === 'full'
                ? 'bg-zinc-800 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Full ({MATCH_SIZE}/{MATCH_SIZE})
          </button>
        </div>
      </div>

      {/* 3D Tug of War Pulling on Ongoing Matches */}
      {activePreviewMatch && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <Box className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-white">
                3D preview of the selected match
              </span>
              <span className="text-xs text-zinc-500">·</span>
              <span className="text-xs text-zinc-400 font-mono">
                {activePreviewMatch.id} ({activePreviewMatch.bulls} Bulls vs {activePreviewMatch.bears} Bears) · {activePreviewMatch.status === 'settled' ? `finished, ${activePreviewMatch.settledResult === 'tie' ? 'tie' : `${activePreviewMatch.settledResult} won`}` : activePreviewMatch.status}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Preview Match:</span>
              <div className="flex items-center gap-1 overflow-x-auto">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      soundFx.playClick();
                      setPreviewMatchId(m.id);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors whitespace-nowrap ${
                      activePreviewMatch.id === m.id
                        ? 'bg-emerald-500 text-zinc-950 font-bold'
                        : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {m.id.split(' ')[0]} {m.id.split(' ')[1]}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShow3DArena((s) => !s)}
                className="px-2.5 py-1 rounded-lg text-xs border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors ml-1"
              >
                {show3DArena ? 'Hide 3D' : 'Show 3D'}
              </button>
            </div>
          </div>

          {show3DArena && (
            <ThreeTugOfWarArena
              bullsCount={activePreviewMatch.bulls}
              bearsCount={activePreviewMatch.bears}
              bias={matchPull(activePreviewMatch)?.bias ?? 0}
              marketTicker={market}
              selectedSide={selectedSide}
            />
          )}
        </div>
      )}

      {/* Algorithmic rule banner */}
      <div className="flex items-start gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 text-xs text-zinc-400">
        <Info className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        <p>
          <strong className="text-zinc-200">Algorithm Rule: </strong>
          A lobby opens when the first player sits ({MATCH_SIZE} seats, $10 stake each, nothing is staked while you wait). If it fills, the match locks at once. If not, when the lobby time ends everyone is asked to continue with fewer players (at least 2, with both teams present). The winner is the side that called the price direction right, not the side with more players.
        </p>
      </div>

      {error && matches.length === 0 && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center text-xs text-zinc-300">
          Could not read matches: {error}
        </div>
      )}

      {!error && loading && matches.length === 0 && (
        <div className="space-y-3">
          <MatchListSkeleton />
          <p className="text-center text-xs text-zinc-500">Reading {market} matches from the chain…</p>
        </div>
      )}

      {!error && !loading && matches.length === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center space-y-2">
          <div className="text-base font-semibold text-white">No {market} matches yet</div>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            Matches are rebuilt from the on-chain seat registry, and nobody has entered one on this market yet.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => {
            soundFx.playClick();
            onOpenNewMatch();
          }}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs py-2.5 px-4 transition-colors"
        >
          Open a new {market} match
        </button>
      </div>

      {/* Matches Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredMatches.map((match) => {
          const isFull = match.status !== 'filling';
          const slotsLeft = Math.max(0, MATCH_SIZE - match.total);
          const bullsRatio = Math.round((match.bulls / Math.max(1, match.total)) * 100);

          return (
            <div
              key={match.id}
              className={`group relative rounded-2xl border p-5 transition-all duration-200 ${
                isFull
                  ? 'border-amber-500/30 bg-zinc-900/80 shadow-md'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900/80'
              }`}
            >
              {/* Top row: Match ID & status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-800 text-sm font-bold text-white border border-zinc-700">
                    {market}
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base group-hover:text-emerald-400 transition-colors">
                      {match.id}
                    </h3>
                    <div className="text-xs text-zinc-500 font-mono">
                      ${NOMINAL_STAKE_USD} Entry · ${NOMINAL_STAKE_USD * MATCH_SIZE} Pool
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  {isFull ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                      <Sparkles className="h-3 w-3" />
                      <span>{match.status === 'settled' ? `Settled · ${match.settledResult === 'tie' ? 'tie' : match.settledResult + ' won'}` : match.status === 'running' ? 'Running' : match.status === 'opening' ? 'Locked · opening trades' : match.status === 'confirming' ? 'Continue?' : match.status === 'cancelled' ? 'Cancelled' : `Roster Full (${MATCH_SIZE}/${MATCH_SIZE})`}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                      <span>{slotsLeft} slots remaining</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Composition Breakdown Strip */}
              <div className="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span>{match.bulls} Bulls</span>
                    <span className="text-zinc-500">({bullsRatio}%)</span>
                  </div>
                  <div className="flex items-center gap-1 text-zinc-400 font-mono text-[11px]">
                    <Users className="h-3 w-3 text-zinc-500" />
                    <span>{match.total} / {MATCH_SIZE}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-rose-400 font-medium">
                    <span className="text-zinc-500">({100 - bullsRatio}%)</span>
                    <span>{match.bears} Bears</span>
                    <TrendingDown className="h-3.5 w-3.5" />
                  </div>
                </div>

                {/* Split Progress Line */}
                <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${bullsRatio}%` }}
                  />
                  <div
                    className="h-full bg-rose-500 transition-all duration-300"
                    style={{ width: `${100 - bullsRatio}%` }}
                  />
                </div>
              </div>

              {/* Status Note & Call to Action */}
              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-400 pt-3 border-t border-zinc-800/60">
                <div className="text-[11px]">
                  {isFull ? (
                    <span className="text-amber-400/90 font-medium">
                      Payout formula unlocked & calculable
                    </span>
                  ) : (
                    <span className="text-zinc-500">
                      Payout hidden until full roster (Step 5 rule)
                    </span>
                  )}
                </div>

                <button
                  onClick={() => {
                    soundFx.playClick();
                    onSelectMatch(match);
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-600 text-white font-medium px-3.5 py-1.5 text-xs transition-colors shrink-0"
                >
                  <span>Inspect Match</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
