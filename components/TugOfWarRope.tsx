'use client';

import { MATCH_SIZE } from '@/lib/gameTag';
import React from 'react';
import Image from 'next/image';
import { TrendingUp, TrendingDown, Users, Zap, Shield, ArrowLeft, ArrowRight } from 'lucide-react';

interface TugOfWarRopeProps {
  bullsCount: number;
  bearsCount: number;
  totalPlayers?: number;
  interactive?: boolean;
  highlightSide?: 'bulls' | 'bears' | null;
  compact?: boolean;
  bias?: number; // -1..1: when given (live matches) the pull follows the price move, not head count
  biasLabel?: string;
}

export const TugOfWarRope: React.FC<TugOfWarRopeProps> = ({
  bullsCount,
  bearsCount,
  totalPlayers = bullsCount + bearsCount,
  highlightSide = null,
  compact = false,
  bias,
  biasLabel,
}) => {
  const total = Math.max(1, bullsCount + bearsCount);
  const bullsPercent = Math.round((bullsCount / total) * 100);
  const bearsPercent = 100 - bullsPercent;

  // Normalized bias between -1 (All Bears) and +1 (All Bulls)
  const normalizedBias = bias ?? (bullsCount - bearsCount) / total;

  // Center knot offset across the horizontal rope (0% is far left, 100% is far right, 50% is center)
  // If Bulls lead (normalizedBias > 0), moves left towards Bull winch (e.g., 50% - 0.5 * 38% = 31%)
  // If Bears lead (normalizedBias < 0), moves right towards Bear winch (e.g., 50% + 0.5 * 38% = 69%)
  const ropeShiftPercent = Math.min(84, Math.max(16, 50 - (normalizedBias * 36)));

  // Live displacement in meters (-5.0m to +5.0m)
  const displacementMeters = (normalizedBias * -5.0).toFixed(1);

  // Dynamic CSS variables for the keyframe heave-pull animation
  // Pull tug vector (negative is pulling left towards Bulls, positive is pulling right towards Bears)
  const pullTugPx = normalizedBias >= 0 ? -Math.max(4, Math.abs(normalizedBias) * 16) : Math.max(4, Math.abs(normalizedBias) * 16);
  const ribbonTiltDeg = normalizedBias * -15;

  // Leading side indicator
  const leadingSide = bias !== undefined ? (bias > 0.001 ? 'bulls' : bias < -0.001 ? 'bears' : 'even') : bullsCount > bearsCount ? 'bulls' : bearsCount > bullsCount ? 'bears' : 'even';

  return (
    <div
      className={`w-full rounded-3xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/90 via-zinc-950 to-zinc-950 p-4 sm:p-6 shadow-2xl backdrop-blur-md transition-all ${
        compact ? 'py-3' : ''
      }`}
      style={
        {
          '--rope-pull-tug': `${pullTugPx}px`,
          '--ribbon-tilt': `${ribbonTiltDeg}deg`,
        } as React.CSSProperties
      }
    >
      {/* Top Header: Team Avatars, Prediction Counts, & Live Vector Readout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        {/* Team Bulls Indicator */}
        <div
          className={`flex items-center gap-3 p-2 rounded-2xl transition-all ${
            highlightSide === 'bulls' || leadingSide === 'bulls'
              ? 'bg-emerald-950/40 border border-emerald-500/40 shadow-lg shadow-emerald-950/40'
              : 'border border-transparent'
          }`}
        >
          <div className="relative h-11 w-11 rounded-2xl overflow-hidden border-2 border-emerald-500/60 bg-emerald-950/80 shadow-md shrink-0">
            <Image
              src="/images/bull_crest.jpg"
              alt="Bulls Crest"
              fill
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-black tracking-wide text-emerald-400">
              <TrendingUp className="h-4 w-4" />
              <span>TEAM BULLS (LONG)</span>
            </div>
            <div className="text-xs text-zinc-300 font-mono tabular-nums">
              <strong className="text-white text-sm">{bullsCount}</strong> committed{' '}
              <span className="text-emerald-400 font-semibold">({bullsPercent}%)</span>
            </div>
          </div>
        </div>

        {/* Center Live Pull Vector & Capacity */}
        <div className="text-center px-3 py-1.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-inner">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center justify-center gap-1.5">
            <Zap className="h-3 w-3 text-amber-400" />
            <span>Tug-of-War Vector</span>
          </div>
          <div className="text-sm font-black text-white font-mono flex items-center justify-center gap-2 mt-0.5">
            <span
              className={
                leadingSide === 'bulls'
                  ? 'text-emerald-400'
                  : leadingSide === 'bears'
                  ? 'text-rose-400'
                  : 'text-amber-300'
              }
            >
              {leadingSide === 'bulls'
                ? (biasLabel ? `← Bulls ${biasLabel}` : `← Bull Pull (+${bullsCount - bearsCount})`)
                : leadingSide === 'bears'
                ? (biasLabel ? `Bears ${biasLabel} →` : `Bear Pull (+${bearsCount - bullsCount}) →`)
                : 'Teams Matched 1:1 (0.0m Center)'}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-300 font-normal text-xs">{totalPlayers}/{MATCH_SIZE} Locked</span>
          </div>
        </div>

        {/* Team Bears Indicator */}
        <div
          className={`flex items-center justify-end gap-3 p-2 rounded-2xl text-right transition-all ${
            highlightSide === 'bears' || leadingSide === 'bears'
              ? 'bg-rose-950/40 border border-rose-500/40 shadow-lg shadow-rose-950/40'
              : 'border border-transparent'
          }`}
        >
          <div>
            <div className="flex items-center justify-end gap-1.5 text-xs sm:text-sm font-black tracking-wide text-rose-400">
              <span>TEAM BEARS (SHORT)</span>
              <TrendingDown className="h-4 w-4" />
            </div>
            <div className="text-xs text-zinc-300 font-mono tabular-nums">
              <span className="text-rose-400 font-semibold">({bearsPercent}%)</span>{' '}
              <strong className="text-white text-sm">{bearsCount}</strong> committed
            </div>
          </div>
          <div className="relative h-11 w-11 rounded-2xl overflow-hidden border-2 border-rose-500/60 bg-rose-950/80 shadow-md shrink-0">
            <Image
              src="/images/bear_crest.jpg"
              alt="Bears Crest"
              fill
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </div>

      {/* 3D-INSPIRED VISUAL ROPE ARENA */}
      <div className="relative my-6 px-4 py-8 rounded-2xl bg-zinc-950/90 border border-zinc-800/80 shadow-inner overflow-hidden">
        {/* Stadium Floor Track Lighting & Gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-950/20 via-transparent to-rose-950/20 pointer-events-none" />
        <div className="absolute top-1/2 left-0 right-0 h-10 -translate-y-1/2 bg-black/40 blur-md pointer-events-none" />

        {/* Rope Track Container with Anchor Winch Posts on Left & Right */}
        <div className="relative flex items-center h-14">
          {/* Left Winch Anchor (Bull Base) */}
          <div className="relative z-20 flex flex-col items-center shrink-0">
            <div className="h-12 w-6 rounded-lg bg-gradient-to-r from-emerald-700 via-emerald-500 to-emerald-900 border-2 border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.5)] flex items-center justify-center">
              <div className="h-8 w-1.5 rounded-full bg-emerald-200/80 shadow-inner" />
            </div>
            <div className="mt-1 flex items-center gap-0.5 text-[9px] font-bold text-emerald-400 uppercase tracking-widest font-mono">
              <ArrowLeft className="h-2.5 w-2.5" />
              <span>Bull Winch</span>
            </div>
          </div>

          {/* THE 3D BRAIDED ROPE ASSEMBLY */}
          <div className="relative flex-1 h-7 mx-1 flex items-center overflow-visible">
            {/* 3D Physical Rope Shadow on Floor */}
            <div
              className="absolute -bottom-3 left-0 right-0 h-3 rounded-full bg-black/60 blur-[3px] transition-all duration-700"
              style={{
                transform: `translateX(${normalizedBias * -12}px)`,
              }}
            />

            {/* The Main 3D Braided Cylindrical Rope Body */}
            <div className="relative w-full h-5 rounded-full rope-braided-3d flex items-center overflow-hidden border border-amber-600/30">
              {/* Dynamic Emerald Tension Overlay (expanding as Bulls pull) */}
              <div
                className="h-full rope-bull-weave transition-all duration-700 ease-out opacity-90"
                style={{ width: `${ropeShiftPercent}%` }}
              />

              {/* Dynamic Rose Tension Overlay (expanding as Bears pull) */}
              <div
                className="h-full rope-bear-weave transition-all duration-700 ease-out opacity-90"
                style={{ width: `${100 - ropeShiftPercent}%` }}
              />

              {/* Braided Specular Highlight Reflection (Simulates 3D Cylindrical Light) */}
              <div className="absolute inset-x-0 top-0.5 h-1.5 bg-gradient-to-b from-white/35 to-transparent pointer-events-none rounded-full" />
              <div className="absolute inset-x-0 bottom-0.5 h-1.5 bg-gradient-to-t from-black/60 to-transparent pointer-events-none rounded-full" />
            </div>

            {/* Directional Tension Flow Waves inside the Rope */}
            <div
              className="absolute inset-y-0 w-full pointer-events-none flex items-center animate-rope-heave"
              style={{
                left: `${ropeShiftPercent}%`,
              }}
            >
              {/* Subtle tension wave ripple */}
              <div className="absolute -left-12 h-6 w-24 bg-gradient-to-r from-transparent via-amber-300/20 to-transparent blur-sm" />
            </div>

            {/* 3D CENTER KNOT & TOURNAMENT RIBBON (Visually shifting by player prediction count) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 z-30 transition-all duration-700 ease-out pointer-events-none"
              style={{
                left: `${ropeShiftPercent}%`,
              }}
            >
              {/* Heave pull wrapper with CSS animation */}
              <div className="relative animate-rope-heave flex flex-col items-center">
                {/* 3D Knot Cylinder with Gold Highlights */}
                <div className="relative h-8 w-6 rounded-md bg-gradient-to-r from-amber-600 via-amber-300 to-amber-700 border border-amber-200 shadow-[0_0_14px_rgba(251,191,36,0.85)] flex items-center justify-center">
                  <div className="h-6 w-1 rounded-full bg-white/70" />
                </div>

                {/* Weighted 3D Golden Bead Flag */}
                <div className="relative -mt-1 flex flex-col items-center animate-ribbon-flutter origin-top">
                  {/* Hanging Ribbon Tails */}
                  <div className="w-5 h-7 bg-gradient-to-b from-amber-400 via-amber-500 to-amber-600 shadow-lg clip-ribbon flex items-center justify-center">
                    <span className="text-[9px] font-black text-zinc-950 font-mono">0</span>
                  </div>

                  {/* Downward Laser Guidance Beam onto Measurement Floor */}
                  <div className="w-0.5 h-5 bg-gradient-to-b from-amber-400 to-transparent" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Winch Anchor (Bear Base) */}
          <div className="relative z-20 flex flex-col items-center shrink-0">
            <div className="h-12 w-6 rounded-lg bg-gradient-to-r from-rose-900 via-rose-500 to-rose-700 border-2 border-rose-400 shadow-[0_0_18px_rgba(244,63,94,0.5)] flex items-center justify-center">
              <div className="h-8 w-1.5 rounded-full bg-rose-200/80 shadow-inner" />
            </div>
            <div className="mt-1 flex items-center gap-0.5 text-[9px] font-bold text-rose-400 uppercase tracking-widest font-mono">
              <span>Bear Winch</span>
              <ArrowRight className="h-2.5 w-2.5" />
            </div>
          </div>
        </div>

        {/* Tactile Floor Graduation Scale with Distance Markers */}
        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
          <span className="text-emerald-400 font-bold">-5m <span className="hidden xs:inline">(Bull Win)</span></span>
          <span className="hidden sm:inline">-4m</span>
          <span className="hidden sm:inline">-3m</span>
          <span className="hidden sm:inline">-2m</span>
          <span className="hidden sm:inline">-1m</span>
          <span className="text-amber-400 font-black px-1.5 py-0.5 rounded bg-zinc-900 border border-amber-500/40 text-[9px] sm:text-[10px]">
            0 CENTER
          </span>
          <span className="hidden sm:inline">+1m</span>
          <span className="hidden sm:inline">+2m</span>
          <span className="hidden sm:inline">+3m</span>
          <span className="hidden sm:inline">+4m</span>
          <span className="text-rose-400 font-bold">+5m <span className="hidden xs:inline">(Bear Win)</span></span>
        </div>
      </div>

      {/* Tension Momentum & Status Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-400 gap-2 pt-1 border-t border-zinc-800/50">
        <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span>Bull Pull Bias: {bullsPercent}%</span>
        </div>

        <div className="text-center font-mono text-[11px] text-zinc-300 bg-zinc-950 px-3 py-1 rounded-full border border-zinc-800">
          <span>Live Displacement: </span>
          <strong
            className={
              normalizedBias > 0
                ? 'text-emerald-400 font-bold'
                : normalizedBias < 0
                ? 'text-rose-400 font-bold'
                : 'text-zinc-400'
            }
          >
            {displacementMeters}m
          </strong>{' '}
          <span className="text-zinc-500">
            ({leadingSide === 'bulls' ? 'Bulls pulling rope left' : leadingSide === 'bears' ? 'Bears pulling rope right' : 'Bulls and Bears matched 1:1 at center'})
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-rose-400 font-medium">
          <span>Bear Pull Bias: {bearsPercent}%</span>
          <span className="h-2 w-2 rounded-full bg-rose-500" />
        </div>
      </div>
    </div>
  );
};
