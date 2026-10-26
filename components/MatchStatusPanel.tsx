'use client';

import { nowSec } from '@/lib/clock';
import React, { useEffect, useState } from 'react';
import { GameMatch } from '@/lib/types';
import { MATCH_DURATION_SEC, MIN_PLAYERS } from '@/lib/gameTag';
import { calculatePayout, CORE_RULES } from '@/lib/payout';
import { useGameWallet } from '@/lib/useGameWallet';
import { Spinner } from '@/components/ProgressModal';
import { useProgress } from '@/lib/useProgress';
import { MiniChart } from '@/components/MiniChart';

const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
const clock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const btn = 'rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50';

/** Where this match is in its life: lobby, "continue?", opening trades, running, settled or cancelled. */
const Inner: React.FC<{ match: GameMatch; progress: ReturnType<typeof useProgress> }> = ({ match, progress }) => {
  const wallet = useGameWallet();
  const [now, setNow] = useState(() => nowSec());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openPos, setOpenPos] = useState(false);
  const [escrow, setEscrow] = useState<{ result: number; joined: boolean; claimed: boolean } | null>(null);
  const number = Number(match.id.split('#')[1]);
  const escrowOn = Boolean(process.env.NEXT_PUBLIC_ESCROW_ADDRESS);

  useEffect(() => {
    const id = setInterval(() => setNow(nowSec()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!wallet.address || !['settled', 'cancelled'].includes(match.status)) return;
    let off = false;
    import('@/lib/escrow')
      .then((e) => e.escrowStatus(match.market, number, wallet.address as `0x${string}`))
      .then((s) => {
        if (!off) setEscrow(s);
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [wallet.address, match.market, match.status, number, msg]);

  // The close button only exists while a real position is open; checked on the chain, not assumed.
  useEffect(() => {
    if (!wallet.key || !wallet.address) return;
    let off = false;
    const check = () =>
      import('@/lib/trading')
        .then((t) => t.hasOpenPosition(wallet.key as `0x${string}`, wallet.address as `0x${string}`, match.market))
        .then((v) => {
          if (!off) setOpenPos(v);
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 8000);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [wallet.key, wallet.address, match.market, msg]);

  const me = match.playersList?.find((p) => p.isUser);
  const key = wallet.key as `0x${string}` | null;

  const act = async (title: string, labels: string[], fn: (advance: (i: number) => void) => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    const out = await progress.run(title, labels, fn);
    setMsg(out.ok ? out.value : out.error);
    setBusy(false);
  };

  const doConfirm = () => act('Confirming your seat', ['Sending confirmation'], async () => {
    const r = await import('@/lib/registry');
    const h = await r.confirmRegistry(key as `0x${string}`, match.market, number);
    return `You are in. Tx ${h}`;
  });
  const doLeave = () => act('Leaving the lobby', ['Freeing your seat'], async () => {
    const r = await import('@/lib/registry');
    const h = await r.leaveRegistry(key as `0x${string}`, match.market, number);
    return `You left the lobby. Tx ${h}`;
  });
  const doOpenTrade = () => act('Opening your trade', escrowOn ? ['Staking $10 in the escrow', 'Setting leverage and placing the order'] : ['Setting leverage and placing the order'], async (advance) => {
    const [o, p] = await Promise.all([import('@/lib/openTrade'), import('@/lib/pending')]);
    p.markPlaced({ ticker: match.market, number, address: wallet.address as string }, true);
    try {
      const r = await o.openTrade({ key: key as `0x${string}`, address: wallet.address as `0x${string}`, ticker: match.market, side: me!.side, number, onStep: advance, leverage: p.getPending().find((x) => x.ticker === match.market && x.number === number && x.address.toLowerCase() === (wallet.address as string).toLowerCase())?.leverage });
      return `Trade placed. Tx ${r.txHash}`;
    } catch (e) {
      p.markPlaced({ ticker: match.market, number, address: wallet.address as string }, false);
      throw e;
    }
  });
  const doClose = () => act('Closing your position', ['Sending the closing order'], async () => (await import('@/lib/trading')).closeMyPosition(key as `0x${string}`, wallet.address as `0x${string}`, match.market));
  const doClaim = () => act(match.status === 'cancelled' ? 'Getting your stake back' : 'Claiming your payout', ['Sending the claim'], async () => {
    const e = await import('@/lib/escrow');
    const h = await (match.status === 'cancelled' ? e.leaveEscrow : e.claimEscrow)(key as `0x${string}`, wallet.address as `0x${string}`, match.market, number);
    return `Done. Tx ${h}`;
  });

  const note = msg && <div className="text-[11px] text-amber-300 break-words">{msg}</div>;
  const Box = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
    <div className={`rounded-2xl border bg-zinc-900/60 p-4 space-y-2 text-sm ${tone}`}>{children}</div>
  );

  if (match.status === 'filling') {
    const left = (match.lobbyEndsAt ?? now) - now;
    return (
      <Box tone="border-zinc-800">
        <div className="font-semibold text-zinc-100">Lobby open · analysis time · closes in {clock(left)}</div>
        <div className="text-zinc-300">
          {match.total} of {match.requiredPlayers} seats taken. Study the chart and pick your side. Nothing is staked yet. The match locks as soon as every seat is taken. If the time runs out first, players are asked whether to continue with fewer (at least {MIN_PLAYERS}, with both teams).
        </div>
        {me && (
          <button onClick={doLeave} disabled={busy} className={`${btn} border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700`}>
            {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Working…</span> : 'Leave this lobby'}
          </button>
        )}
        {note}
      </Box>
    );
  }

  if (match.status === 'confirming') {
    const left = (match.confirmEndsAt ?? now) - now;
    const yes = match.playersList?.filter((p) => p.confirmed).length ?? 0;
    return (
      <Box tone="border-amber-500/30">
        <div className="font-semibold text-amber-300">Lobby closed with {match.total} of {match.requiredPlayers} players · continue? {clock(left)} left</div>
        <div className="text-zinc-300">
          {yes} of {match.total} have said yes. Players who don&apos;t answer are refunded. If either team ends up with nobody, everyone is refunded.
        </div>
        {me && !me.confirmed && (
          <button onClick={doConfirm} disabled={busy} className={`${btn} border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20`}>
            {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Working…</span> : 'Yes, continue with fewer players'}
          </button>
        )}
        {me?.confirmed && <div className="text-emerald-300">You said yes. Waiting for the others.</div>}
        {note}
      </Box>
    );
  }

  if (match.status === 'opening') {
    const left = (match.tradeEndsAt ?? now) - now;
    return (
      <Box tone="border-emerald-500/30">
        <div className="font-semibold text-emerald-300">Match locked · opening trades · {clock(left)} left</div>
        <div className="text-zinc-300">
          The roster is fixed. Every player&apos;s $10 stake (when the escrow is on) and real order go in now, at the same moment, automatically, from their browser tab. A player who is not here is simply out. The price clock starts when this window ends.
        </div>
        {me && (
          <button onClick={doOpenTrade} disabled={busy} className={`${btn} border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}>
            {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Placing…</span> : 'Stake and open my trade now'}
          </button>
        )}
        {note}
      </Box>
    );
  }

  if (match.status === 'cancelled') {
    return (
      <Box tone="border-rose-500/30">
        <div className="font-semibold text-rose-300">Match cancelled</div>
        <div className="text-zinc-300">It did not have enough players on both teams. Nobody plays, and stakes are refunded.</div>
        {escrow?.joined && !escrow.claimed && (
          <button onClick={doClaim} disabled={busy} className={`${btn} border-emerald-500/40 bg-emerald-500/10 text-emerald-200`}>
            Take my stake back
          </button>
        )}
        {note}
      </Box>
    );
  }

  const start = match.startPrice;
  const closeButton = me && openPos && (
    <button onClick={doClose} disabled={busy} className={`${btn} border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700`}>
      {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Closing…</span> : `Close my ${match.market} position`}
    </button>
  );

  if (match.status === 'running' || match.status === 'full') {
    const live = match.livePrice ?? start;
    const left = (match.endsAt ?? now) - now;
    const move = start && live ? ((live - start) / start) * 100 : 0;
    const leading = move > 0 ? 'Bulls' : move < 0 ? 'Bears' : 'Nobody';
    return (
      <Box tone="border-amber-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-amber-300">Match running · {left > 0 ? `${clock(left)} left` : 'ending, waiting for the final candle'}</div>
          <div className="font-mono text-xs text-zinc-400">
            start {start ? usd(start) : '…'} → now {live ? usd(live) : '…'} ({move >= 0 ? '+' : ''}{move.toFixed(3)}%)
          </div>
        </div>
        <div className="text-zinc-300">{leading} are ahead. The side that called the direction right wins, whatever the head count: Bulls if the price ends above the start, Bears if below, and a tie refunds everyone.</div>
        {closeButton}
        {note}
      </Box>
    );
  }

  // settled
  const result = match.settledResult;
  const winners = result === 'bulls' ? match.bulls : result === 'bears' ? match.bears : 0;
  const losers = result === 'bulls' ? match.bears : match.bulls;
  const pay = result && result !== 'tie' ? calculatePayout({ winnerCount: winners, loserCount: losers, entryFee: CORE_RULES.ENTRY_FEE }) : null;
  const mySide = me?.side;
  // Only a winner (or anyone, if the escrow made it a refund) can claim; the contract refuses losers.
  const canClaim = !!escrow && (escrow.result === 3 || (escrow.result === 1 && mySide === 'bulls') || (escrow.result === 2 && mySide === 'bears'));
  return (
    <Box tone="border-emerald-500/30">
      <div className="font-semibold text-emerald-300">Settled · {result === 'tie' ? 'tie, everyone is refunded' : `${result === 'bulls' ? 'Bulls' : 'Bears'} won`}</div>
      <div className="font-mono text-xs text-zinc-400">
        start {start ? usd(start) : '…'} → end {match.endPrice ? usd(match.endPrice) : '…'} · {MATCH_DURATION_SEC / 60} min
      </div>
      {pay && (
        <div className="text-zinc-300">
          Each winner gets {usd(pay.payoutPerWinner)} (profit {usd(pay.netProfitPerWinner)}); the platform rake is {usd(pay.platformRake)}.
          {mySide && (mySide === result ? ' You were on the winning side.' : ' You were on the losing side.')}
        </div>
      )}
      <div className="text-[11px] text-zinc-500">
        {escrow ? 'Stakes are held by the escrow contract. The operator posts the result, then each winner claims.' : 'The escrow is not switched on, so no prize money moves; your real position on dreamDEX is separate.'}
      </div>
      {escrow && escrow.joined && escrow.result !== 0 && !escrow.claimed && !canClaim && (
        <div className="text-xs text-rose-300">You were on the losing side, so there is nothing to claim. Your ${CORE_RULES.ENTRY_FEE} stake went to the winners and the rake.</div>
      )}
      {escrow && escrow.joined && escrow.claimed && <div className="text-xs text-emerald-300">Payout claimed.</div>}
      {escrow && escrow.joined && escrow.result !== 0 && !escrow.claimed && canClaim && (
        <button onClick={doClaim} disabled={busy} className={`${btn} border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}>
          {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Claiming…</span> : 'Claim payout'}
        </button>
      )}
      {closeButton}
      {note}
    </Box>
  );
};

export const MatchStatusPanel: React.FC<{ match: GameMatch }> = ({ match }) => {
  const progress = useProgress();
  return (
    <>
      {['filling', 'confirming', 'opening', 'running', 'full'].includes(match.status) && <MiniChart ticker={match.market} startPrice={match.startPrice} />}
      <Inner match={match} progress={progress} />
      {progress.modal}
    </>
  );
};
