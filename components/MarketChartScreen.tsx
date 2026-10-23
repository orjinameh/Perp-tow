'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  TrendingUp,
  TrendingDown,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Clock,
  Shield,
  Layers,
} from 'lucide-react';
import { CryptoAsset, MarketQueueData, PositionSide } from '@/lib/types';
import { soundFx } from '@/lib/sound';
import { LiveTrades } from './LiveTrades';

interface MarketChartScreenProps {
  market: MarketQueueData;
  onSelectSide: (side: PositionSide) => void;
  onBackToLobby: () => void;
}

export const MarketChartScreen: React.FC<MarketChartScreenProps> = ({
  market,
  onSelectSide,
  onBackToLobby,
}) => {
  const [activeTimeframe, setActiveTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('15m');
  const [chartType, setChartType] = useState<'area' | 'candles'>('area');
  const [hoveredPoint, setHoveredPoint] = useState<{ time: string; price: number } | null>(null);

  // Real prices: group the market's 1-minute candles into the chosen timeframe and plot each close.
  const bucketMinutes = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 }[activeTimeframe];
  const maxPoints = activeTimeframe === '1h' ? 24 : 60;
  const points = (() => {
    const bucketSec = bucketMinutes * 60;
    const byBucket = new Map<number, number>();
    for (const c of market.candles) {
      byBucket.set(Math.floor(c.t / bucketSec) * bucketSec, c.close); // candles are oldest first
    }
    return [...byBucket.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-maxPoints)
      .map(([t, price]) => ({
        time: new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ') + ' UTC',
        price,
      }));
  })();

  const minPrice = points.length ? Math.min(...points.map((p) => p.price)) * 0.998 : 0;
  const maxPrice = points.length ? Math.max(...points.map((p) => p.price)) * 1.002 : 1;
  const priceRange = maxPrice - minPrice || 1;

  // SVG coordinate calculations
  const svgWidth = 800;
  const svgHeight = 280;

  const pointsString = points
    .map((p, idx) => {
      const x = (idx / (points.length - 1)) * (svgWidth - 40) + 20;
      const y = svgHeight - 30 - ((p.price - minPrice) / priceRange) * (svgHeight - 60);
      return `${x},${y}`;
    })
    .join(' ');

  const areaString = `20,${svgHeight - 30} ${pointsString} ${svgWidth - 20},${svgHeight - 30}`;

  const isPositive = market.priceChange24h >= 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-8">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <button
            onClick={() => {
              soundFx.playClick();
              onBackToLobby();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors shrink-0"
            title="Back to Lobby"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-zinc-800 font-black text-lg sm:text-xl text-white border border-zinc-700 shrink-0">
              {market.ticker}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight truncate">
                  {market.name} Market
                </h1>
                <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">
                  {market.ticker}/USD
                </span>
              </div>
              <div className="text-xs text-zinc-400 truncate">
                Step 2: Inspect Chart Before Choosing Side
              </div>
            </div>
          </div>
        </div>

        {/* Current Market Price & 24h Stats */}
        <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800/60">
          <span className="text-xs text-zinc-500 sm:hidden">Spot Price & 24h:</span>
          <div className="text-right">
            <div className="text-xl sm:text-2xl font-extrabold text-white font-mono tabular-nums">
              ${(hoveredPoint ? hoveredPoint.price : market.price).toLocaleString(undefined, {
                minimumFractionDigits: market.price < 1 ? 4 : 2,
                maximumFractionDigits: market.price < 1 ? 4 : 2,
              })}
            </div>
            <div
              className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              <span>{isPositive ? `+${market.priceChange24h}%` : `${market.priceChange24h}%`} (24h)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chart Card */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-4 sm:p-6 shadow-xl backdrop-blur-sm">
        {/* Chart Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4 mb-4">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <span className="text-zinc-500 font-medium shrink-0">Timeframe:</span>
            {(['1m', '5m', '15m', '1h'] as const).map((tf) => (
              <button
                key={tf}
                onClick={() => {
                  soundFx.playClick();
                  setActiveTimeframe(tf);
                }}
                className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                  activeTimeframe === tf
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 sm:gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
              <span>Bull (+2.0%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-400 shrink-0" />
              <span>Bear (-2.0%)</span>
            </div>
          </div>
        </div>

        {/* The SVG Price Chart Viewport */}
        <div className="relative w-full overflow-hidden rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-2">
          {/* Subtle Grid Lines */}
          <div className="absolute inset-0 grid grid-rows-4 grid-cols-6 pointer-events-none opacity-10">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="border-b border-r border-zinc-400" />
            ))}
          </div>

          {points.length < 2 && (
            <div className="flex h-56 sm:h-72 items-center justify-center text-center text-xs text-zinc-500 px-6">
              Not enough trades in the last 24 hours to draw a chart for {market.ticker}-PERP yet.
            </div>
          )}
          {points.length >= 2 && (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-56 sm:h-72 drop-shadow-md overflow-visible"
          >
            <defs>
              <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                <stop offset="60%" stopColor="#10b981" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
              </linearGradient>
            </defs>

            {/* Target Threshold Dashed Lines */}
            <line
              x1="20"
              y1={svgHeight * 0.22}
              x2={svgWidth - 20}
              y2={svgHeight * 0.22}
              stroke="#10b981"
              strokeDasharray="4 4"
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />
            <line
              x1="20"
              y1={svgHeight * 0.78}
              x2={svgWidth - 20}
              y2={svgHeight * 0.78}
              stroke="#f43f5e"
              strokeDasharray="4 4"
              strokeOpacity="0.4"
              strokeWidth="1.2"
            />

            {/* Area Fill */}
            <polygon points={areaString} fill="url(#chartGradient)" />

            {/* Price Polyline */}
            <polyline
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={pointsString}
            />

            {/* Price nodes with hover interaction */}
            {points.map((point, idx) => {
              const x = (idx / (points.length - 1)) * (svgWidth - 40) + 20;
              const y = svgHeight - 30 - ((point.price - minPrice) / priceRange) * (svgHeight - 60);
              const isHovered = hoveredPoint?.time === point.time;

              return (
                <g key={idx} className="cursor-pointer">
                  <circle
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 3}
                    fill={isHovered ? '#10b981' : '#059669'}
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 1}
                    className="transition-all duration-150"
                    onMouseEnter={() => setHoveredPoint(point)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                </g>
              );
            })}
          </svg>
          )}

          {/* Time axis stamps (real first, middle and last point times) */}
          {points.length >= 2 && (
            <div className="flex justify-between px-4 pt-2 text-[10px] text-zinc-500 font-mono">
              <span>{points[0].time}</span>
              <span>{points[Math.floor(points.length / 2)].time}</span>
              <span>{points[points.length - 1].time}</span>
            </div>
          )}
        </div>

        {/* Global Queue Overview for this Asset */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-zinc-800/80 pt-4">
          <div className="flex items-center gap-3 bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60">
            <div className="relative h-9 w-9 rounded-full overflow-hidden border border-emerald-500/40 shrink-0">
              <Image src="/images/bull_crest.jpg" alt="Bulls" fill className="object-cover" referrerPolicy="no-referrer" />
            </div>
            <div>
              <div className="text-xs text-zinc-400">Waiting Bulls Queue</div>
              <div className="text-base font-bold text-emerald-400 font-mono tabular-nums">
                {market.waitingBulls} players
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60">
            <div className="relative h-9 w-9 rounded-full overflow-hidden border border-rose-500/40 shrink-0">
              <Image src="/images/bear_crest.jpg" alt="Bears" fill className="object-cover" referrerPolicy="no-referrer" />
            </div>
            <div>
              <div className="text-xs text-zinc-400">Waiting Bears Queue</div>
              <div className="text-base font-bold text-rose-400 font-mono tabular-nums">
                {market.waitingBears} players
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60">
            <div>
              <div className="text-xs text-zinc-400">Match Buy-In</div>
              <div className="text-base font-bold text-white font-mono">$10.00 Fixed</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400">Required Size</div>
              <div className="text-base font-bold text-white font-mono">20 Players</div>
            </div>
          </div>
        </div>
      </div>

      <LiveTrades market={market} />

      {/* Step 3: Choose Position (Bulls or Bears) */}
      <div className="space-y-4">
        <div className="text-center max-w-xl mx-auto">
          <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">
            Step 3 — Choose Your Position
          </span>
          <h2 className="text-2xl font-black text-white tracking-tight mt-1">
            Pick Your Team: Bulls (Long) vs Bears (Short)
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Selecting a position records your bias and filters available 20-player matches for {market.ticker}.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* BULLS CARD */}
          <div className="group relative rounded-3xl border-2 border-emerald-500/30 bg-gradient-to-b from-emerald-950/30 to-zinc-900/90 p-6 sm:p-7 hover:border-emerald-400 hover:shadow-2xl hover:shadow-emerald-950/40 transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 rounded-2xl overflow-hidden border-2 border-emerald-500/60 shadow-lg shrink-0">
                  <Image
                    src="/images/bull_crest.jpg"
                    alt="Bulls Crest"
                    fill
                    className="object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                    Team Bulls
                  </div>
                  <h3 className="text-2xl font-black text-white">LONG POSITION</h3>
                </div>
              </div>
              <div className="rounded-full bg-emerald-500/10 border border-emerald-500/30 p-2 text-emerald-400">
                <TrendingUp className="h-6 w-6" />
              </div>
            </div>

            <p className="mt-4 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              You predict that <strong className="text-white">{market.ticker} price will rise</strong> during the match window. You join the Bull side pulling the rope to victory.
            </p>

            <div className="mt-5 space-y-2 rounded-xl bg-zinc-950/60 border border-emerald-500/20 p-3.5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Entry Stake:</span>
                <span className="font-semibold text-white font-mono">$10.00</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Winning Rule:</span>
                <span className="text-emerald-400 font-medium">Final Price &gt; Start Price</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Payout Basis:</span>
                <span className="text-zinc-300">Share 90% of Bears&apos; $10 buy-ins</span>
              </div>
            </div>

            <button
              onClick={() => {
                soundFx.playBullChime();
                onSelectSide('bulls');
              }}
              className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-extrabold text-sm py-3.5 px-6 shadow-lg shadow-emerald-500/25 transition-all group-hover:scale-[1.01]"
            >
              <span>Choose Bulls (Long)</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* BEARS CARD */}
          <div className="group relative rounded-3xl border-2 border-rose-500/30 bg-gradient-to-b from-rose-950/30 to-zinc-900/90 p-6 sm:p-7 hover:border-rose-400 hover:shadow-2xl hover:shadow-rose-950/40 transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 rounded-2xl overflow-hidden border-2 border-rose-500/60 shadow-lg shrink-0">
                  <Image
                    src="/images/bear_crest.jpg"
                    alt="Bears Crest"
                    fill
                    className="object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-rose-400 uppercase tracking-widest">
                    Team Bears
                  </div>
                  <h3 className="text-2xl font-black text-white">SHORT POSITION</h3>
                </div>
              </div>
              <div className="rounded-full bg-rose-500/10 border border-rose-500/30 p-2 text-rose-400">
                <TrendingDown className="h-6 w-6" />
              </div>
            </div>

            <p className="mt-4 text-xs sm:text-sm text-zinc-300 leading-relaxed">
              You predict that <strong className="text-white">{market.ticker} price will fall</strong> during the match window. You join the Bear side pulling the rope downwards.
            </p>

            <div className="mt-5 space-y-2 rounded-xl bg-zinc-950/60 border border-rose-500/20 p-3.5 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Entry Stake:</span>
                <span className="font-semibold text-white font-mono">$10.00</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Winning Rule:</span>
                <span className="text-rose-400 font-medium">Final Price &lt; Start Price</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Payout Basis:</span>
                <span className="text-zinc-300">Share 90% of Bulls&apos; $10 buy-ins</span>
              </div>
            </div>

            <button
              onClick={() => {
                soundFx.playBearChime();
                onSelectSide('bears');
              }}
              className="mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-extrabold text-sm py-3.5 px-6 shadow-lg shadow-rose-500/25 transition-all group-hover:scale-[1.01]"
            >
              <span>Choose Bears (Short)</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
