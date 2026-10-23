'use client';

import React from 'react';
import Image from 'next/image';
import {
  CheckCircle2,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Copy,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { CryptoAsset, GameMatch, PositionSide } from '@/lib/types';
import { TugOfWarRope } from './TugOfWarRope';
import { ThreeTugOfWarArena } from './ThreeTugOfWarArena';
import { soundFx } from '@/lib/sound';
import type { EntryReceipt } from '@/lib/trading';

interface EntrySuccessScreenProps {
  market: CryptoAsset;
  selectedSide: PositionSide;
  match: GameMatch;
  receipt: EntryReceipt;
  onReturnToLobby: () => void;
  onInspectAnother: () => void;
  onOpenSpecs: () => void;
}

export const EntrySuccessScreen: React.FC<EntrySuccessScreenProps> = ({
  market,
  selectedSide,
  match,
  receipt,
  onReturnToLobby,
  onInspectAnother,
  onOpenSpecs,
}) => {
  const [copied, setCopied] = React.useState(false);
  const ticketId = receipt.txHash ? `${receipt.txHash.slice(0, 10)}...${receipt.txHash.slice(-6)}` : 'no tx hash returned';

  const handleCopyTicket = () => {
    soundFx.playClick();
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(receipt.txHash ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 space-y-7">
      {/* Success Banner */}
      <div className="rounded-3xl border-2 border-emerald-500/40 bg-zinc-900/90 p-6 sm:p-8 text-center space-y-4 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Sparkles className="h-48 w-48 text-emerald-400" />
        </div>

        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
          <CheckCircle2 className="h-9 w-9" />
        </div>

        <div className="space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Step 8 — Entry Confirmed On Chain
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-white">
            You&apos;re Locked Into the Arena!
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-md mx-auto">
            You have successfully joined <strong className="text-white">{match.id}</strong> on{' '}
            <strong className={selectedSide === 'bulls' ? 'text-emerald-400' : 'text-rose-400'}>
              Team {selectedSide === 'bulls' ? 'Bulls (Long)' : 'Bears (Short)'}
            </strong>.
          </p>
        </div>

        {/* Digital Match Pass / Ticket */}
        <div className="mx-auto max-w-lg mt-6 rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-left space-y-4 shadow-inner">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-mono font-bold text-zinc-300">ENTRY RECEIPT (dreamDEX testnet)</span>
            </div>
            <button
              onClick={handleCopyTicket}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors"
            >
              <Copy className="h-3 w-3" />
              <span>{copied ? 'Copied!' : ticketId}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-zinc-500">Market:</span>
              <div className="font-bold text-white font-mono">{market} / USD</div>
            </div>
            <div>
              <span className="text-zinc-500">Position Side:</span>
              <div
                className={`font-bold font-mono ${
                  selectedSide === 'bulls' ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {selectedSide === 'bulls' ? 'Bulls (Long)' : 'Bears (Short)'}
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Match Instance:</span>
              <div className="font-bold text-white font-mono">{match.id}</div>
            </div>
            <div>
              <span className="text-zinc-500">Position opened:</span>
              <div className="font-bold text-white font-mono">
                {receipt.filledQuantity} {market} @ ~${receipt.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </div>
            </div>
            <div className="col-span-2">
              <span className="text-zinc-500">Notional:</span>{' '}
              <span className="font-bold text-white font-mono">${receipt.notionalUsd.toFixed(2)}</span>
              {receipt.raisedToMinimum && (
                <span className="text-amber-300"> (raised from the $10 stake to this market&apos;s minimum order)</span>
              )}
              {receipt.txHash && (
                <>
                  {' '}·{' '}
                  <a
                    href={`https://explorer.testnet.somnia.network/tokyo/tx/${receipt.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 underline underline-offset-2"
                  >
                    view on explorer
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 3D Tug of War pulling arena on ongoing match */}
        <div className="mt-6 pt-2 text-left space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-semibold text-white">Live 3D Match Arena Status:</span>
            <span>Rope physically reacting to team predictions</span>
          </div>
          <ThreeTugOfWarArena
            bullsCount={selectedSide === 'bulls' ? match.bulls + 1 : match.bulls}
            bearsCount={selectedSide === 'bears' ? match.bears + 1 : match.bears}
            marketTicker={market}
            selectedSide={selectedSide}
          />
        </div>

        {/* Action Controls */}
        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => {
              soundFx.playClick();
              onReturnToLobby();
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-xs py-3 px-6 shadow-md transition-all"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Return to Global Lobby (Step 1)</span>
          </button>

          <button
            onClick={() => {
              soundFx.playClick();
              onInspectAnother();
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-xs py-3 px-5 transition-all"
          >
            <span>Explore Other Matches</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => {
              soundFx.playClick();
              onOpenSpecs();
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-transparent hover:bg-zinc-800 text-zinc-300 hover:text-white font-semibold text-xs py-3 px-5 transition-all"
          >
            <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
            <span>Algorithm Specs & Safeguards</span>
          </button>
        </div>
      </div>
    </div>
  );
};
