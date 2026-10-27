'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useGameWallet } from '@/lib/useGameWallet';
import { useLiveMarkets } from '@/lib/useLiveMarkets';
import { useProgress } from '@/lib/useProgress';
import { WalletPanel } from '@/components/WalletPanel';
import {
  SquadMatch, SquadParams, TEAM_NAME, claimSquad, confirmSquad, enterSquad, finishSquad, leaveSquad,
  loadSquadMatches, nextSquadNumber, readSquadParams, squadClaimed, squadsEnabled,
} from '@/lib/squads';
import { PlayerScore, loadScores, teamScore, winner } from '@/lib/score';
import { enterMatch, closeMyPosition, myDirection } from '@/lib/trading';
import { nowSec } from '@/lib/clock';
import { leverageChoices } from '@/lib/gameTag';

type Hex = `0x${string}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;

export default function SquadsPage() {
  const wallet = useGameWallet();
  const live = useLiveMarkets();
  const progress = useProgress();
  const [ticker, setTicker] = useState('BTC');
  const [params, setParams] = useState<SquadParams | null>(null);
  const [matches, setMatches] = useState<SquadMatch[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [scores, setScores] = useState<PlayerScore[]>([]);
  const [claimed, setClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [side, setSide] = useState<'bulls' | 'bears'>('bulls');
  const [margin, setMargin] = useState(10);
  const [lev, setLev] = useState(2);

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

  // Live scores from real fills, for the selected match once it has locked.
  useEffect(() => {
    if (!match || !match.lockAt || !market) { setScores([]); return; }
    let stop = false;
    const go = async () => {
      try {
        const s = await loadScores(market.pool, match.players.map((p) => p.address), match.lockAt, match.endsAt, market.baseDecimals);
        if (!stop) setScores(s);
      } catch { /* keep the last scores */ }
    };
    void go();
    const t = setInterval(go, 6000);
    return () => { stop = true; clearInterval(t); };
  }, [match?.number, match?.lockAt, match?.endsAt, market?.pool, match?.players.length]);

  useEffect(() => {
    setClaimed(false);
    if (match && me && match.phase !== 'filling') squadClaimed(ticker, match.number, me).then(setClaimed).catch(() => {});
  }, [match?.number, match?.phase, me, ticker]);

  const ts = useMemo(() => (match ? teamScore(match.players, scores) : null), [match, scores]);
  const key = wallet.key as Hex | null;

  const act = async (title: string, labels: string[], fn: () => Promise<unknown>) => {
    await progress.run(title, labels, async (adv) => { adv(0); await fn(); });
    await reload();
  };

  const open = () => key && act('Opening a match', ['Seat + stake'], async () => {
    const n = await nextSquadNumber(ticker);
    await enterSquad(key, ticker, n, me as Hex);
    setSelected(n);
  });
  const join = (m: SquadMatch) => key && act('Taking your seat', ['Seat + stake'], () => enterSquad(key, ticker, m.number, me as Hex));
  const leave = (m: SquadMatch) => key && act('Leaving', ['Leave and refund'], () => leaveSquad(key, ticker, m.number, me as Hex));
  const confirm = (m: SquadMatch) => key && act('Confirming', ['Confirm'], () => confirmSquad(key, ticker, m.number, me as Hex));
  const finish = (m: SquadMatch) => key && act('Locking the match', ['Lock'], () => finishSquad(key, ticker, m.number));
  const claim = (m: SquadMatch) => key && act('Claiming', ['Pay out'], () => claimSquad(key, ticker, m.number, me as Hex));
  const trade = () => key && match && act('Opening your trade', ['Sending order'], () => enterMatch({ key, address: me as Hex, ticker, side, matchNumber: match.number, stakeUsd: margin, leverage: lev }));
  const close = () => key && act('Closing your trade', ['Closing'], () => closeMyPosition(key, me as Hex, ticker));

  if (!squadsEnabled) {
    return <Shell><p>Squads mode is not switched on: <code>NEXT_PUBLIC_SQUADS_ADDRESS</code> is empty. Run <code>npm run deploy:squads</code>.</p></Shell>;
  }

  const left = match ? (match.phase === 'filling' ? match.lobbyEndsAt - now : match.phase === 'confirming' ? match.confirmEndsAt - now : match.phase === 'trading' ? match.endsAt - now : 0) : 0;
  const w = ts ? winner(ts) : 3;
  const lead = ts ? Math.max(-1, Math.min(1, ts.gap * 20)) : 0; // ±5% gap fills the rope

  return (
    <Shell>
      {progress.modal}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select className="border rounded px-2 py-1 bg-transparent" value={ticker} onChange={(e) => { setTicker(e.target.value); setSelected(null); }}>
          {(live.markets.length ? live.markets.map((m) => m.ticker) : ['BTC']).map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="border rounded px-3 py-1" onClick={open} disabled={!key || !me}>Open a new match (${params?.stakeUsd ?? 10} stake)</button>
        <Link href="/" className="underline text-sm">Back to the classic game</Link>
      </div>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div>
          <h2 className="font-semibold mb-2">Matches</h2>
          {!matches.length && <p className="text-sm opacity-70">No matches yet on {ticker}. Open one.</p>}
          <ul className="space-y-2">
            {matches.map((m) => (
              <li key={m.id}>
                <button onClick={() => setSelected(m.number)} className={`w-full text-left border rounded p-3 ${selected === m.number ? 'ring-2' : ''}`}>
                  <span className="font-medium">{m.id}</span> · {m.players.length}/{params?.size ?? '?'} seated · <span className="opacity-70">{m.phase}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div><WalletPanel wallet={wallet} /></div>
      </div>

      {match && (
        <section className="mt-6 border rounded p-4">
          <h2 className="font-semibold">{match.id} · {match.phase}{left > 0 && ` · ${mmss(left)}`}</h2>

          {(match.phase === 'filling' || match.phase === 'confirming') && (
            <p className="text-sm opacity-80 my-2">Teams are drawn at random when the match locks. Nobody picks a side, and you can trade any direction once it starts.</p>
          )}
          {match.lockAt > 0 && <p className="text-sm my-2">Teams drawn. Both teams trade freely until the clock ends; the team with the better average return wins.</p>}

          <ul className="grid sm:grid-cols-2 gap-1 text-sm my-3">
            {match.players.map((p) => {
              const s = scores.find((x) => x.address.toLowerCase() === p.address.toLowerCase());
              return (
                <li key={p.address} className="flex justify-between border rounded px-2 py-1">
                  <span>{short(p.address)}{me && p.address.toLowerCase() === me.toLowerCase() ? ' (you)' : ''}{p.confirmed ? ' ✓' : ''}</span>
                  <span>{p.team ? TEAM_NAME[p.team] : '—'}{s && s.trades ? ` · ${pct(s.ret)}` : ''}</span>
                </li>
              );
            })}
          </ul>

          {ts && match.lockAt > 0 && (
            <div className="my-3">
              <div className="flex justify-between text-sm"><span>Red {pct(ts.red)}</span><span>Blue {pct(ts.blue)}</span></div>
              <div className="h-3 rounded bg-blue-500/60 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-red-500/80 transition-all" style={{ width: `${50 + lead * 50}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => join(match)}>Take a seat</button>}
            {mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => leave(match)}>Leave and get my stake back</button>}
            {mine && match.phase === 'confirming' && !mine.confirmed && <button className="border rounded px-3 py-1" onClick={() => confirm(match)}>Continue with fewer players</button>}
            {match.phase === 'confirming' && <button className="border rounded px-3 py-1" onClick={() => leave(match)} disabled={!mine}>Leave</button>}
            {match.phase === 'finishable' && <button className="border rounded px-3 py-1" onClick={() => finish(match)}>Lock the match</button>}
            {mine && ['cancelled', 'settled'].includes(match.phase) && !claimed && (match.phase === 'cancelled' || match.result === 3 || (match.result === mine.team)) && (
              <button className="border rounded px-3 py-1" onClick={() => claim(match)}>{match.phase === 'cancelled' || match.result === 3 ? 'Claim refund' : 'Claim payout'}</button>
            )}
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
              <p className="text-xs opacity-70 mt-2">Trade as often as you like in either direction. Your score is your realized return on the money you put to work, so leverage alone cannot win it.</p>
            </div>
          )}

          {match.phase === 'ended' && <p className="text-sm mt-3">Time is up. Leading team: {ts ? (w === 3 ? 'tie' : w === 1 ? 'Red' : 'Blue') : '…'}. The result is posted by the operator and then winners can claim.</p>}
          {match.phase === 'settled' && <p className="text-sm mt-3">Result: {match.result === 3 ? 'tie (refund)' : `${TEAM_NAME[match.result as 1 | 2]} won`}.</p>}
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-5xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-1">Tug of War: Squads</h1>
      <p className="text-sm opacity-70 mb-4">Random teams, free trading, real dreamDEX positions. The better team return wins.</p>
      {children}
    </main>
  );
}
