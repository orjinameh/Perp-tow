'use client';

import React from 'react';

/**
 * Always shows where you are and how to get back: a breadcrumb trail on wide screens, a single labelled back button on
 * phones, plus one "Find a game" action that joins the fullest open room or opens a new one.
 */
export function LocationBar({ kind, ticker, matchId, onHub, onMarket, onFind, finding, loadingRooms }: {
  kind: 'hub' | 'market' | 'arena';
  ticker: string;
  matchId: string | null;
  onHub: () => void;
  onMarket: () => void;
  onFind: () => void;
  finding: boolean;
  loadingRooms: boolean;
}) {
  const parentLabel = kind === 'arena' ? `${ticker} market` : 'Hub';
  const back = kind === 'arena' ? onMarket : onHub;
  return (
    <div className="absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2" data-world-ui>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/90 px-2 py-1.5 text-xs text-zinc-200">
        {kind !== 'hub' && (
          <button onClick={back} className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 font-semibold hover:bg-zinc-800 sm:hidden" aria-label={`Back to ${parentLabel}`}>
            ‹ {parentLabel}
          </button>
        )}
        <nav aria-label="You are here" className={`${kind === 'hub' ? 'flex' : 'hidden sm:flex'} min-w-0 items-center gap-1.5 whitespace-nowrap`}>
          {kind === 'hub' ? (
            <span className="font-semibold text-white" aria-current="page">Hub <span className="font-normal text-zinc-400">· walk into a market door</span></span>
          ) : (
            <>
              <button onClick={onHub} className="text-sky-300 underline-offset-2 hover:underline">Hub</button>
              <span className="text-zinc-600" aria-hidden="true">›</span>
              {kind === 'arena'
                ? <button onClick={onMarket} className="text-sky-300 underline-offset-2 hover:underline">{ticker} market</button>
                : <span className="font-semibold text-white" aria-current="page">{ticker} market</span>}
              {kind === 'arena' && <><span className="text-zinc-600" aria-hidden="true">›</span><span className="truncate font-semibold text-white" aria-current="page">{matchId ?? 'Room'}</span></>}
            </>
          )}
        </nav>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {loadingRooms && <span className="hidden items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-xs text-zinc-300 sm:inline-flex"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />Loading rooms…</span>}
        {kind !== 'arena' && (
          <button onClick={onFind} disabled={finding} className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
            Find a game
          </button>
        )}
      </div>
    </div>
  );
}
