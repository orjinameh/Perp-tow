'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ShieldAlert,
  Search,
  Sparkles,
  Info,
} from 'lucide-react';
import { CryptoAsset, MarketQueueData } from '@/lib/types';
import { formatUsdCompact } from '@/lib/dreamdex';
import { soundFx } from '@/lib/sound';

interface GlobalLobbyProps {
  markets: MarketQueueData[];
  failed: CryptoAsset[];
  onSelectMarket: (market: CryptoAsset) => void;
  onOpenSpecs: () => void;
}

export const GlobalLobby: React.FC<GlobalLobbyProps> = ({
  markets,
  failed,
  onSelectMarket,
  onOpenSpecs,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'volume' | 'change' | 'queue'>('volume');

  const filteredMarkets = markets.filter(
    (m) =>
      m.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => {
    if (sortField === 'change') return Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h);
    if (sortField === 'queue') return (b.waitingBulls + b.waitingBears) - (a.waitingBulls + a.waitingBears);
    return 0;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 space-y-8">
      {/* Hero Showcase Area */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/90 shadow-2xl">
        <div className="relative h-64 sm:h-80 md:h-96 w-full overflow-hidden">
          <Image
            src="/images/arena_banner.jpg"
            alt="Tug of War Crypto Arena"
            fill
            priority
            className="object-cover opacity-60"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-transparent to-zinc-950/80" />

          {/* Hero Content */}
          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 md:p-10 flex flex-col justify-end">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-400 mb-2">
              <Sparkles className="h-4 w-4" />
              <span>Interactive Prototype · PvP Prediction Engine</span>
            </div>
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight text-white max-w-3xl leading-tight">
              Tug of War: Long vs Short Crypto Battle Royale
            </h1>
            <p className="mt-3 text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
              Predict market direction on any of the {markets.length} live dreamDEX perp markets. Each match locks at exactly 20 players with a $10 buy-in.
              Winners claim their original entry plus 90% of the losing team&apos;s pool.
            </p>

            {/* Quick Rules Metadata Bar */}
            <div className="mt-6 flex flex-wrap items-center gap-3 sm:gap-6 text-xs text-zinc-400 border-t border-zinc-800/80 pt-4">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="font-semibold text-white">20 Players</span>
                <span>per match</span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="font-semibold text-emerald-400">$10</span>
                <span>entry fee</span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="font-semibold text-white">10% Platform Rake</span>
                <span>(losing pool only)</span>
              </div>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="font-semibold text-white">Asset Isolated</span>
                <span>(BTC vs BTC only)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Queue Notice & Important Distinction Callout */}
      <div className="flex items-start gap-3.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-xs text-zinc-400">
        <Info className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-zinc-200">
            Step 1: Global Market Queues vs Individual Matches
          </p>
          <p className="leading-relaxed">
            The waiting counts below indicate the <strong className="text-zinc-300">global matchmaking pool</strong> searching for matches in each market.
            Matches are isolated by asset—BTC players cannot face ETH players. Select a market to view its interactive price chart, pick your position (Bulls or Bears), and inspect active 20-player lobbies.
          </p>
        </div>
      </div>

      {/* Filter and Market Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
        <div className="relative flex-1 max-w-md w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Search a perp market (BTC, ETH, SOL...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900/80 pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <span className="text-xs text-zinc-500 shrink-0">Sort by:</span>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/80 p-1 text-xs shrink-0">
            <button
              onClick={() => {
                soundFx.playClick();
                setSortField('volume');
              }}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                sortField === 'volume' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Default
            </button>
            <button
              onClick={() => {
                soundFx.playClick();
                setSortField('queue');
              }}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                sortField === 'queue' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Queue Activity
            </button>
            <button
              onClick={() => {
                soundFx.playClick();
                setSortField('change');
              }}
              className={`px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
                sortField === 'change' ? 'bg-zinc-800 text-white font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              24h Volatility
            </button>
          </div>
        </div>
      </div>

      {/* Global Markets Grid / Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredMarkets.map((market) => {
          const isPositive = market.priceChange24h >= 0;
          const totalQueue = market.waitingBulls + market.waitingBears;
          const bullRatio = totalQueue > 0 ? Math.round((market.waitingBulls / totalQueue) * 100) : 50;

          return (
            <div
              key={market.ticker}
              className="group relative flex flex-col justify-between rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 hover:border-zinc-700 hover:bg-zinc-900 transition-all duration-200 shadow-sm"
            >
              <div>
                {/* Header: Asset & 24h change */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800 font-black text-white text-base border border-zinc-700/60 shadow-inner">
                      {market.ticker}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg tracking-tight group-hover:text-emerald-400 transition-colors">
                        {market.name}
                      </h3>
                      <div className="text-xs text-zinc-500 font-mono">
                        {market.ticker}/USD
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-base font-bold text-white tabular-nums">
                      ${market.price.toLocaleString(undefined, {
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
                      <span>{isPositive ? `+${market.priceChange24h}%` : `${market.priceChange24h}%`}</span>
                    </div>
                  </div>
                </div>

                {/* Queue Momentum Meter */}
                <div className="mt-5 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-1 text-emerald-400 font-medium">
                      <span>{market.waitingBulls} Bulls</span>
                      <span className="text-zinc-500 font-normal">({bullRatio}%)</span>
                    </div>
                    {totalQueue > 0 && market.waitingBulls === market.waitingBears && (
                      <span className="text-[10px] text-emerald-400/90 font-mono font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        Matched 1:1
                      </span>
                    )}
                    <div className="flex items-center gap-1 text-rose-400 font-medium">
                      <span className="text-zinc-500 font-normal">({100 - bullRatio}%)</span>
                      <span>{market.waitingBears} Bears</span>
                    </div>
                  </div>

                  {/* Visual Split Bar */}
                  <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden flex">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${bullRatio}%` }}
                    />
                    <div
                      className="h-full bg-rose-500"
                      style={{ width: `${100 - bullRatio}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-2">
                    <span>Global Waiting Queue</span>
                    <span className="font-mono tabular-nums text-zinc-400">{totalQueue} players waiting</span>
                  </div>
                </div>

                {/* Market Stats Metadata */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400 border-t border-zinc-800/50 pt-2.5">
                  <div>
                    <span className="text-zinc-500">24h Range: </span>
                    <span className="font-mono text-zinc-300">
                      ${market.low24h.toLocaleString(undefined, { maximumFractionDigits: market.price < 1 ? 4 : 2 })} - ${market.high24h.toLocaleString(undefined, { maximumFractionDigits: market.price < 1 ? 4 : 2 })}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-zinc-500">24h Vol: </span>
                    <span className="font-mono text-zinc-300">{formatUsdCompact(market.volume24hUsd)}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-zinc-500">Open interest: </span>
                    <span className="font-mono text-zinc-300">{formatUsdCompact(market.openInterestUsd)}</span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-5 pt-3 border-t border-zinc-800/80">
                <button
                  onClick={() => {
                    soundFx.playClick();
                    onSelectMarket(market.ticker);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-zinc-800 hover:bg-emerald-600 text-white py-2.5 px-4 text-xs font-semibold tracking-wide transition-all group-hover:shadow-lg group-hover:shadow-emerald-950/40"
                >
                  <span>Select {market.ticker} Market</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Prototype Clarification Strip */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-5 w-5 text-zinc-400 shrink-0" />
          <div className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-200">Live data:</span> prices, 24h range, volume and open interest come from the dreamDEX Hideki testnet perps indexer. Queues and matches start empty and fill only when players enter.{failed.length > 0 ? ` Could not load: ${failed.join(', ')}.` : ''}
          </div>
        </div>
        <button
          onClick={() => {
            soundFx.playClick();
            onOpenSpecs();
          }}
          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4 whitespace-nowrap"
        >
          View Full Prototype Algorithm Rules &rarr;
        </button>
      </div>
    </div>
  );
};
