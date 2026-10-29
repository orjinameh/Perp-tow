'use client';

import React from 'react';
import type { SquadMatch, SquadParams } from '@/lib/squads';
import { TEAM_NAME } from '@/lib/squads';
import { Spinner } from '@/components/ProgressModal';

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;

/**
 * Tells a waiting player three things at all times: what stage the match is in, how long it takes (a real countdown and
 * a bar tied to the real clock), and what happens next or what to do. Nothing here is estimated or faked.
 */
export function MatchStatus({ match, now, params, myTeam, seated, claimed }: { match: SquadMatch; now: number; params: SquadParams | null; myTeam: 0 | 1 | 2; seated: boolean; claimed: boolean }) {
  const seats = match.players.length;
  const cap = match.size || params?.size || seats;
  let chip = '';
  let chipTone = 'bg-zinc-700 text-zinc-100';
  let left = 0;
  let total = 0;
  let next = '';
  let wait = false;
  const mine = myTeam ? `You are on team ${TEAM_NAME[myTeam]}. ` : '';

  switch (match.phase) {
    case 'filling':
      chip = 'Lobby open'; chipTone = 'bg-amber-500/20 text-amber-200';
      left = match.lobbyEndsAt - now; total = params?.lobbySeconds ?? 0;
      next = seated
        ? `${mine}You are in. The match starts when the room is full (${cap - seats} more) or when the timer ends. You can leave any time before it starts and get your stake and bankroll back.`
        : 'Take a seat to join. Your team is drawn at random the moment you sit.';
      if (params && seats < params.minPlayers) next += ` It needs at least ${params.minPlayers} players to start.`;
      wait = seated;
      break;
    case 'confirming':
      chip = 'Confirm to continue'; chipTone = 'bg-amber-500/20 text-amber-200';
      left = match.confirmEndsAt - now; total = params?.confirmSeconds ?? 0;
      next = 'The room did not fill. Press "Continue with fewer players" to play with whoever is here. Players who do not answer are refunded, and the match is cancelled if too few continue.';
      wait = true;
      break;
    case 'finishable':
      chip = 'Ready to lock'; chipTone = 'bg-sky-500/20 text-sky-200';
      next = 'The confirm window is over. Anyone can press "Lock the match" to start it now.';
      break;
    case 'trading':
      chip = 'Trading'; chipTone = 'bg-emerald-500/20 text-emerald-200';
      left = match.endsAt - now; total = params?.duration ?? 0;
      next = `${mine}Trade from your vault below. The team with the better average gain wins.`;
      break;
    case 'ended':
      chip = 'Settling'; chipTone = 'bg-sky-500/20 text-sky-200';
      next = 'Time is up. The result is being computed on the chain from every vault. This happens by itself while a player\'s tab is open; if it stalls, press "Settle the result".';
      wait = true;
      break;
    case 'settled':
      chip = 'Finished'; chipTone = 'bg-zinc-600 text-zinc-100';
      next = match.result === 3
        ? 'It was a tie: everyone is refunded.'
        : `${TEAM_NAME[match.result as 1 | 2]} won.${seated ? (claimed ? ' You have been paid.' : ' Press the claim button to receive your payout and bankroll.') : ''}`;
      break;
    case 'cancelled':
      chip = 'Cancelled'; chipTone = 'bg-rose-500/20 text-rose-200';
      next = seated ? (claimed ? 'Your stake and bankroll were returned.' : 'Nothing was played. Press the claim button to get your stake and bankroll back.') : 'Nothing was played.';
      break;
  }

  const frac = total > 0 ? Math.max(0, Math.min(1, 1 - left / total)) : 0;
  const showTimer = total > 0 && left > 0;
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3 text-xs text-zinc-200" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${chipTone}`}>
          {wait && <Spinner className="h-3 w-3" />}{chip}
        </span>
        {showTimer && <span className="font-mono text-base font-bold text-white">{mmss(left)}</span>}
      </div>
      {showTimer && (
        <div className="h-1.5 overflow-hidden rounded bg-zinc-800" aria-hidden="true">
          <div className="h-full bg-emerald-500 transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%` }} />
        </div>
      )}
      {(match.phase === 'filling' || match.phase === 'confirming') && (
        <div>
          <div className="mb-1 flex justify-between text-zinc-400"><span>Seats</span><span className="font-mono text-zinc-200">{seats} / {cap}</span></div>
          <div className="flex gap-0.5" aria-hidden="true">
            {Array.from({ length: Math.min(cap, 20) }).map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-sm ${i < seats ? 'bg-emerald-500' : 'bg-zinc-700'}`} />)}
          </div>
        </div>
      )}
      <p className="leading-relaxed text-zinc-300">{next}</p>
    </div>
  );
}
