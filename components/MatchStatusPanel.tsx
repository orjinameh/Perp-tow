'use client';

import React, { useEffect, useState } from 'react';
import { GameMatch } from '@/lib/types';
import { MATCH_DURATION_SEC } from '@/lib/gameTag';
import { calculatePayout, CORE_RULES } from '@/lib/payout';
import { useGameWallet } from '@/lib/useGameWallet';

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, '0')}`;

/** Where this match is in its life: filling, running (live move since the start price), or settled. */
export const MatchStatusPanel: React.FC<{ match: GameMatch }> = ({ match }) => {
  const wallet = useGameWallet();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [escrow, setEscrow] = useState<{ result: number; joined: boolean; claimed: boolean } | null>(null);
  const number = Number(match.id.split('#')[1]);

  useEffect(() => {
    if (!wallet.address || match.status === 'filling') return;
    let off = false;
    import('@/lib/escrow').then((e) => e.escrowStatus(match.market, number, wallet.address as `0x${string}`)).then((s) => { if (!off) setEscrow(s); }).catch(() => {});
    return () => { off = true; };
  }, [wallet.address, match.market, match.status, number, msg]);

  const claim = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setMsg(null);
    try {
      const e = await import('@/lib/escrow');
      const hash = await e.claimEscrow(wallet.key as `0x${string}`, wallet.address as `0x${string}`, match.market, number);
      setMsg(`Payout claimed. Tx ${hash}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message.split('\n')[0] : String(err));
    } finally {
      setBusy(false);
    }
  };

  const claimButton = escrow && escrow.joined && escrow.result !== 0 && !escrow.claimed && (
    <button onClick={claim} disabled={busy} className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
      {busy ? 'Claiming…' : 'Claim payout'}
    </button>
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const me = match.playersList?.find((p) => p.isUser);

  const close = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setMsg(null);
    try {
      const t = await import('@/lib/trading');
      setMsg(await t.closeMyPosition(wallet.key as `0x${string}`, wallet.address as `0x${string}`, match.market));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeButton = me && (
    <div className="space-y-1">
      <button
        onClick={close}
        disabled={busy}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? 'Closing…' : `Close my ${match.market} position`}
      </button>
      {msg && <div className="text-[11px] text-amber-300 break-words">{msg}</div>}
    </div>
  );

  if (match.status === 'filling') {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300">
        Waiting for players: {match.total} of {match.requiredPlayers}. The match starts the moment the last seat is taken, with the market price at that moment as the start price, and runs {MATCH_DURATION_SEC / 60} minutes.
        {closeButton && <div className="mt-3">{closeButton}</div>}
      </div>
    );
  }

  const start = match.startPrice;
  if (match.status === 'running' || match.status === 'full') {
    const live = match.livePrice ?? start;
    const left = (match.endsAt ?? now) - now;
    const move = start && live ? ((live - start) / start) * 100 : 0;
    const leading = move > 0 ? 'Bulls' : move < 0 ? 'Bears' : 'Nobody';
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-zinc-900/60 p-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-amber-300">Match running · {left > 0 ? `${clock(left)} left` : 'ending, waiting for the final candle'}</div>
          <div className="font-mono text-xs text-zinc-400">
            start {start ? usd(start) : '…'} → now {live ? usd(live) : '…'} ({move >= 0 ? '+' : ''}{move.toFixed(3)}%)
          </div>
        </div>
        <div className="text-zinc-300">{leading} are ahead. Bulls win if the price at the end is above the start price, Bears if it is below, and a tie refunds everyone.</div>
        {closeButton}
      </div>
    );
  }

  // settled
  const result = match.settledResult;
  const winners = result === 'bulls' ? match.bulls : result === 'bears' ? match.bears : 0;
  const losers = result === 'bulls' ? match.bears : match.bulls;
  const pay = result && result !== 'tie' ? calculatePayout({ winnerCount: winners, loserCount: losers, entryFee: CORE_RULES.ENTRY_FEE }) : null;
  const mySide = me?.side;
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-zinc-900/60 p-4 space-y-2 text-sm">
      <div className="font-semibold text-emerald-300">
        Settled · {result === 'tie' ? 'tie, everyone is refunded' : `${result === 'bulls' ? 'Bulls' : 'Bears'} won`}
      </div>
      <div className="font-mono text-xs text-zinc-400">
        start {start ? usd(start) : '…'} → end {match.endPrice ? usd(match.endPrice) : '…'}
      </div>
      {pay && (
        <div className="text-zinc-300">
          Each winner gets {usd(pay.payoutPerWinner)} (profit {usd(pay.netProfitPerWinner)}); the platform rake is {usd(pay.platformRake)}.
          {mySide && (mySide === result ? ' You were on the winning side.' : ' You were on the losing side.')}
        </div>
      )}
      <div className="text-[11px] text-zinc-500">{escrow ? 'Stakes are held by the escrow contract. The operator posts the result, then each winner claims.' : 'Results are computed from public chain data. The escrow is not switched on, so no prize money moves; your real position on dreamDEX is separate.'}</div>
      {claimButton}
      {closeButton}
    </div>
  );
};
