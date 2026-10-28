'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GameWallet } from '@/lib/useGameWallet';
import type { LiveMarkets } from '@/lib/useLiveMarkets';
import { useProgress } from '@/lib/useProgress';
import {
  SquadMatch, SquadParams, TEAM_NAME, claimSquad, confirmSquad, enterSquad, finishSquad, leaveSquad,
  loadSquadMatches, nextSquadNumber, readSquadParams, settleSquad, squadClaimed, squadScores, squadsEnabled,
} from '@/lib/squads';
import { enterMatch, closeMyPosition, myDirection } from '@/lib/trading';
import { nowSec } from '@/lib/clock';
import { leverageChoices } from '@/lib/gameTag';
import type { GameMatch } from '@/lib/types';
import type { SquadArenaView, WorldRoom } from '@/components/World3D';

const Hall = dynamic(() => import('@/components/SquadsHall3D').then((m) => m.SquadsHall3D), { ssr: false, loading: () => <div className="h-[420px] flex items-center justify-center text-sm opacity-70">Building the hall…</div> });

const World = dynamic(() => import('@/components/World3D').then((m) => m.World3D), { ssr: false, loading: () => <div className="h-full flex items-center justify-center text-sm opacity-70">Building the 3D world…</div> });

type Hex = `0x${string}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;

export function SquadsGame({ wallet, live }: { wallet: GameWallet; live: LiveMarkets }) {
  const progress = useProgress();
  const [ticker, setTicker] = useState('BTC');
  const [params, setParams] = useState<SquadParams | null>(null);
  const [matches, setMatches] = useState<SquadMatch[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [chain, setChain] = useState<{ red: number; blue: number } | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [side, setSide] = useState<'bulls' | 'bears'>('bulls');
  const [margin, setMargin] = useState(10);
  const [lev, setLev] = useState(2);
  const [picker, setPicker] = useState(false);
  const [ticket, setTicket] = useState<SquadMatch | 'new' | null>(null);
  const [newSize, setNewSize] = useState(4);
  const [view, setView] = useState<'world' | 'screens'>('world');
  const [room, setRoom] = useState<WorldRoom>({ kind: 'hub' });
  const [draftNumber, setDraftNumber] = useState<number | null>(null);

  const market = live.markets.find((m) => m.ticker === ticker);
  const me = wallet.address;
  const match = matches.find((m) => m.number === selected) ?? null;
  const mine = match && me ? match.players.find((p) => p.address.toLowerCase() === me.toLowerCase()) : undefined;

  useEffect(() => { const t = setInterval(() => setNow(nowSec()), 1000); return () => clearInterval(t); }, []);

  const reload = useCallback(async () => {
    if (!squadsEnabled) return;
    try {
      setParams(await readSquadParams());
      const list = await loadSquadMatches(ticker);
      setMatches(list);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [ticker]);
  useEffect(() => { void reload(); const t = setInterval(reload, 8000); return () => clearInterval(t); }, [reload]);

  // Live team scores straight from the contract: the same numbers settle() will use.
  useEffect(() => {
    if (!match || !match.lockAt) { setChain(null); return; }
    let stop = false;
    const go = () => squadScores(ticker, match.number).then((v) => { if (!stop) setChain(v); }).catch(() => {});
    void go();
    const t = setInterval(go, 6000);
    return () => { stop = true; clearInterval(t); };
  }, [match?.number, match?.lockAt, ticker]);

  useEffect(() => {
    setClaimed(false);
    if (match && me && match.phase !== 'filling') squadClaimed(ticker, match.number, me).then(setClaimed).catch(() => {});
  }, [match?.number, match?.phase, me, ticker]);

  const key = wallet.key as Hex | null;

  const act = async (title: string, labels: string[], fn: () => Promise<unknown>) => {
    const out = await progress.run(title, labels, async (adv) => { adv(0); await fn(); });
    await reload();
    return out.ok;
  };
  const toArena = () => setRoom({ kind: 'arena', ticker });

  const open = async () => {
    if (!key) return;
    const ok = await act('Opening a match', ['Seat + stake'], async () => {
      const n = await nextSquadNumber(ticker);
      await enterSquad(key, ticker, n, me as Hex, Math.max(2, Math.min(newSize, params?.size ?? newSize)));
      setSelected(n);
    });
    if (ok) { setTicket(null); if (view === 'world') toArena(); }
  };
  const join = async (m: SquadMatch) => {
    if (!key) return;
    const ok = await act('Taking your seat', ['Seat + stake'], () => enterSquad(key, ticker, m.number, me as Hex, m.size));
    if (ok) { setSelected(m.number); setTicket(null); if (view === 'world') toArena(); }
  };
  const leave = (m: SquadMatch) => key && act('Leaving', ['Leave and refund'], () => leaveSquad(key, ticker, m.number, me as Hex));
  const confirm = (m: SquadMatch) => key && act('Confirming', ['Confirm'], () => confirmSquad(key, ticker, m.number, me as Hex));
  const finish = (m: SquadMatch) => key && act('Locking the match', ['Lock'], () => finishSquad(key, ticker, m.number));
  const settle = (m: SquadMatch) => key && act('Settling', ['Computing the result on chain'], () => settleSquad(key, ticker, m.number));
  const claim = (m: SquadMatch) => key && act('Claiming', ['Pay out'], () => claimSquad(key, ticker, m.number, me as Hex));
  const trade = () => key && match && act('Opening your trade', ['Sending order'], () => enterMatch({ key, address: me as Hex, ticker, side, matchNumber: match.number, stakeUsd: margin, leverage: lev }));
  const close = () => key && act('Closing your trade', ['Closing'], () => closeMyPosition(key, me as Hex, ticker));

  if (!squadsEnabled) {
    return <Shell><p>Squads mode is not switched on: <code>NEXT_PUBLIC_SQUADS_ADDRESS</code> is empty. Run <code>npm run deploy:squads</code>.</p></Shell>;
  }

  const left = match ? (match.phase === 'filling' ? match.lobbyEndsAt - now : match.phase === 'confirming' ? match.confirmEndsAt - now : match.phase === 'trading' ? match.endsAt - now : 0) : 0;
  const gap = chain ? chain.red - chain.blue : 0;
  const w = !chain || gap === 0 ? 3 : gap > 0 ? 1 : 2;
  const cap = (params?.stakeUsd ?? 10) * 10;
  const lead = Math.max(-1, Math.min(1, gap / cap)); // a full cap of difference fills the rope

  const panel = match ? (
        <section className="mt-6 border rounded p-4">
          <h2 className="font-semibold">{match.id} · {match.phase}{left > 0 && ` · ${mmss(left)}`}</h2>

          {(match.phase === 'filling' || match.phase === 'confirming') && (
            <p className="text-sm opacity-80 my-2">Teams are drawn at random when the match locks. Nobody picks a side, and you can trade any direction once it starts.</p>
          )}
          {match.lockAt > 0 && <p className="text-sm my-2">Teams drawn. Both teams trade freely until the clock ends; the team with the better average equity gain wins.</p>}

          <ul className="grid sm:grid-cols-2 gap-1 text-sm my-3">
            {match.players.map((p) => {
              return (
                <li key={p.address} className="flex justify-between border rounded px-2 py-1">
                  <span>{short(p.address)}{me && p.address.toLowerCase() === me.toLowerCase() ? ' (you)' : ''}{p.confirmed ? ' ✓' : ''}</span>
                  <span>{p.team ? TEAM_NAME[p.team] : '—'}</span>
                </li>
              );
            })}
          </ul>

          {chain && match.lockAt > 0 && (
            <div className="my-3">
              <div className="flex justify-between text-sm"><span>Red {chain.red >= 0 ? '+' : ''}{chain.red.toFixed(2)} USDso</span><span>Blue {chain.blue >= 0 ? '+' : ''}{chain.blue.toFixed(2)} USDso</span></div>
              <div className="h-3 rounded bg-blue-500/60 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-red-500/80 transition-all" style={{ width: `${50 + lead * 50}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => setTicket(match)}>Take a seat</button>}
            {mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => leave(match)}>Leave and get my stake back</button>}
            {mine && match.phase === 'confirming' && !mine.confirmed && <button className="border rounded px-3 py-1" onClick={() => confirm(match)}>Continue with fewer players</button>}
            {match.phase === 'confirming' && <button className="border rounded px-3 py-1" onClick={() => leave(match)} disabled={!mine}>Leave</button>}
            {match.phase === 'finishable' && <button className="border rounded px-3 py-1" onClick={() => finish(match)}>Lock the match</button>}
            {mine && ['cancelled', 'settled'].includes(match.phase) && !claimed && (match.phase === 'cancelled' || match.result === 3 || (match.result === mine.team)) && (
              <button className="border rounded px-3 py-1" onClick={() => claim(match)}>{match.phase === 'cancelled' || match.result === 3 ? 'Claim refund' : 'Claim payout'}</button>
            )}
            {match.phase === 'ended' && <button className="border rounded px-3 py-1" onClick={() => settle(match)}>Settle the result</button>}
            {claimed && <span className="text-sm">Paid out.</span>}
          </div>

          {mine && match.phase === 'trading' && market && (
            <div className="mt-4 border-t pt-3">
              <h3 className="font-medium mb-2">Your trade (real dreamDEX position)</h3>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className={`border rounded px-3 py-1 ${side === 'bulls' ? 'ring-2' : ''}`} onClick={() => setSide('bulls')}>Buy</button>
                <button className={`border rounded px-3 py-1 ${side === 'bears' ? 'ring-2' : ''}`} onClick={() => setSide('bears')}>Sell</button>
                <label>Margin $<input className="w-16 border rounded px-1 ml-1 bg-transparent" type="number" min={1} value={margin} onChange={(e) => setMargin(Math.max(1, Number(e.target.value)))} /></label>
                <select className="border rounded px-1 bg-transparent" value={lev} onChange={(e) => setLev(Number(e.target.value))}>
                  {leverageChoices(market.maxLeverage).map((l) => <option key={l} value={l}>{l}x</option>)}
                </select>
                <button className="border rounded px-3 py-1" onClick={trade}>Place trade</button>
                <button className="border rounded px-3 py-1" onClick={close}>Close position</button>
              </div>
              <p className="text-xs opacity-70 mt-2">Trade as often as you like in either direction. Your score is how much your real dreamDEX account equity changed since the lock (capped), open positions included.</p>
            </div>
          )}

          {match.phase === 'ended' && <p className="text-sm mt-3">Time is up. Leading team: {chain ? (w === 3 ? 'tie' : w === 1 ? 'Red' : 'Blue') : '…'}. Anyone can press Settle: the contract computes the winner from dreamDEX equity, then winners claim.</p>}
          {match.phase === 'settled' && <p className="text-sm mt-3">Result: {match.result === 3 ? 'tie (refund)' : `${TEAM_NAME[match.result as 1 | 2]} won`}.</p>}
        </section>
  ) : null;


  const toGame = (m: SquadMatch): GameMatch => ({
    id: m.id, market: m.ticker as GameMatch['market'], bulls: 0, bears: 0, total: m.players.length, requiredPlayers: m.size, size: m.size,
    slotsRemaining: Math.max(0, m.size - m.players.length), entryFee: params?.stakeUsd ?? 10,
    status: m.phase === 'filling' ? 'filling' : m.phase === 'confirming' ? 'confirming' : m.phase === 'trading' ? 'running' : m.phase === 'cancelled' ? 'cancelled' : m.phase === 'settled' ? 'settled' : 'running',
    lobbyEndsAt: m.lobbyEndsAt,
    playersList: m.players.map((p) => ({ isUser: !!me && p.address.toLowerCase() === me.toLowerCase(), side: 'bulls' })),
  } as unknown as GameMatch);
  const draft: SquadMatch | null = draftNumber ? { id: `${ticker} #${draftNumber}`, ticker, number: draftNumber, size: Math.max(2, Math.min(newSize, params?.size ?? newSize)), players: [], phase: 'filling', firstAt: 0, lockAt: 0, endsAt: 0, lobbyEndsAt: 0, confirmEndsAt: 0, result: 0, red: 0, blue: 0 } : null;
  const ticketMatch = ticket === 'new' ? draft : ticket;
  const arena: SquadArenaView | null = match
    ? { id: match.id, phase: match.phase, left: Math.max(0, left), size: match.size, players: match.players.map((p) => ({ team: p.team, confirmed: p.confirmed, isMe: !!me && p.address.toLowerCase() === me.toLowerCase() })), red: chain ? chain.red : null, blue: chain ? chain.blue : null, result: match.result }
    : null;
  const worldView = (
    <div className="relative h-[calc(100dvh-12rem)] min-h-[480px] rounded border overflow-hidden">
      <World
        room={room}
        markets={live.markets}
        side={null}
        match={null}
        resume={null}
        frozen={false}
        squads
        arena={arena}
        matches={matches.map(toGame)}
        selectedMatch={ticketMatch ? toGame(ticketMatch) : null}
        ticketOpen={ticket !== null}
        onEnterMarket={(t) => { setTicker(t); setSelected(null); setTicket(null); setRoom({ kind: 'market', ticker: t }); }}
        onPickSide={() => {}}
        onPickMatch={(g) => {
          const m = matches.find((x) => x.id === g.id);
          if (!m) return;
          setSelected(m.number);
          if (me && m.players.some((p) => p.address.toLowerCase() === me.toLowerCase())) { setTicket(null); toArena(); } else setTicket(m);
        }}
        onOpenNew={async () => { setDraftNumber(await nextSquadNumber(ticker).catch(() => null)); setTicket('new'); }}
        onConfirmSeat={() => { if (ticket === 'new') void open(); else if (ticket) void join(ticket); }}
        onCloseTicket={() => setTicket(null)}
        onBackToLobby={() => { setTicket(null); if (room.kind === 'arena') setRoom({ kind: 'market', ticker }); else setRoom({ kind: 'hub' }); }}
        onResume={() => {}}
        onFail={() => setView('screens')}
      />
      {room.kind === 'arena' && panel && (
        <div className="absolute left-3 top-3 z-10 w-[min(92vw,26rem)] max-h-[85%] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/90 text-zinc-100 p-2 text-sm">{panel}</div>
      )}
      {room.kind === 'market' && ticket === 'new' && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-200">
          Room size
          <select className="bg-transparent border rounded px-1" value={Math.max(2, Math.min(newSize, params?.size ?? newSize))} onChange={(e) => setNewSize(Number(e.target.value))}>
            {Array.from({ length: Math.max(1, (params?.size ?? 4) - 1) }, (_, i) => i + 2).map((n) => <option key={n} value={n} className="text-black">{n} players</option>)}
          </select>
        </div>
      )}
      {room.kind === 'hub' && <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">Walk into a market door. Random teams, free trading, ${params?.stakeUsd ?? 10} stake.</div>}
    </div>
  );

  return (
    <Shell>
      {progress.modal}
      {view === 'world' ? worldView : (<>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select className="border rounded px-2 py-1 bg-transparent" value={ticker} onChange={(e) => { setTicker(e.target.value); setSelected(null); }}>
          {(live.markets.length ? live.markets.map((m) => m.ticker) : ['BTC']).map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="border rounded px-3 py-1" onClick={() => setTicket('new')} disabled={!key || !me}>Open a new match (${params?.stakeUsd ?? 10} stake)</button>
      </div>
      <div className="mb-4">
        <Hall matches={matches} size={params?.size ?? 4} me={me} now={now} selected={match} onJoinRing={() => setPicker(true)} onOpenRing={() => setTicket('new')} />
      </div>
      {view === 'screens' && picker && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPicker(false)}>
          <div className="bg-zinc-900 text-white rounded p-4 w-full max-w-md max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-2">Open rooms on {ticker}</h2>
            {!matches.filter((m) => m.phase === 'filling').length && <p className="text-sm opacity-70">No room is open right now. Step on the other ring to open one.</p>}
            <ul className="space-y-2">
              {matches.filter((m) => m.phase === 'filling').map((m) => {
                const here = !!me && m.players.some((p) => p.address.toLowerCase() === me.toLowerCase());
                return (
                  <li key={m.id} className="flex items-center justify-between border rounded p-2">
                    <span>{m.id} · {m.players.length}/{m.size || '?'} · {mmss(m.lobbyEndsAt - now)}</span>
                    <button className="border rounded px-3 py-1" onClick={() => { setPicker(false); setSelected(m.number); if (!here) setTicket(m); }}>{here ? 'Go to seat' : 'Join'}</button>
                  </li>
                );
              })}
            </ul>
            <button className="mt-3 underline text-sm" onClick={() => setPicker(false)}>Close</button>
          </div>
        </div>
      )}
      {view === 'screens' && ticket && (() => {
        const t = ticket === 'new' ? null : ticket;
        const stakeUsd = params?.stakeUsd ?? 10;
        const maxSize = params?.size ?? 4;
        const size = t ? t.size : Math.max(2, Math.min(newSize, maxSize));
        const seated = t ? t.players.length : 0;
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setTicket(null)}>
            <div className="bg-zinc-900 text-white rounded p-5 w-full max-w-md max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs opacity-60">ENTRY TICKET</p>
              <h2 className="text-lg font-semibold">{t ? t.id : `${ticker} · new match room`}</h2>
              <dl className="text-sm my-3 space-y-2">
                <div className="flex justify-between"><dt className="opacity-70">Market</dt><dd>{ticker}-PERP, only {ticker} players</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Stake</dt><dd>${stakeUsd.toFixed(2)} USDso, paid when you take the seat</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Pool at a full room</dt><dd>${(stakeUsd * size).toFixed(2)}</dd></div>
                <div className="flex justify-between items-center"><dt className="opacity-70">Seats</dt><dd>{t ? `${seated} / ${size} taken` : (<select className="bg-transparent border rounded px-1" value={size} onChange={(e) => setNewSize(Number(e.target.value))}>{Array.from({ length: Math.max(1, maxSize - 1) }, (_, i) => i + 2).map((n) => <option key={n} value={n} className="text-black">{n} players</option>)}</select>)}</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Your team</dt><dd>Drawn at random at the lock</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Winner</dt><dd>Team with the bigger real account gain</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Payout</dt><dd>Stake back + {Math.round((1 - (params?.rake ?? 0.2)) * 100)}% of the losers' pool</dd></div>
              </dl>
              <p className="text-xs opacity-70 mb-3">Taking the seat stakes ${stakeUsd}. Leave before the lock and the stake comes straight back. Nobody picks a side: once the match locks you can trade any direction, with any leverage, as often as you like. A tie or a match that never starts refunds everyone.</p>
              <div className="flex gap-2">
                <button className="border rounded px-3 py-1" onClick={() => setTicket(null)}>Back</button>
                <button className="border rounded px-3 py-1" onClick={() => { const x = ticket; setTicket(null); if (x === 'new') void open(); else join(x); }}>Take my seat</button>
              </div>
            </div>
          </div>
        );
      })()}
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div>
          <h2 className="font-semibold mb-2">Matches</h2>
          {!matches.length && <p className="text-sm opacity-70">No matches yet on {ticker}. Open one.</p>}
          <ul className="space-y-2">
            {matches.map((m) => (
              <li key={m.id}>
                <button onClick={() => setSelected(m.number)} className={`w-full text-left border rounded p-3 ${selected === m.number ? 'ring-2' : ''}`}>
                  <span className="font-medium">{m.id}</span> · {m.players.length}/{m.size || '?'} seated · <span className="opacity-70">{m.phase}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {panel}

      </>)}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl p-3">{children}</div>;
}
