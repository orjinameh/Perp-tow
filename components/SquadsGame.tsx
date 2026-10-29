'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GameWallet } from '@/lib/useGameWallet';
import type { LiveMarkets } from '@/lib/useLiveMarkets';
import { useProgress } from '@/lib/useProgress';
import {
  SquadMatch, SquadParams, TEAM_NAME, claimSquad, confirmSquad, enterSquad, finishSquad, leaveSquad, releaseSquad, vaultAddress,
  loadSquadMatches, nextSquadNumber, readSquadParams, settleSquad, squadClaimed, squadScores, squadsEnabled,
} from '@/lib/squads';
import { vaultReleaseDiagnosis, vaultOrder, vaultClose, vaultPosition, vaultWithdrawable, vaultCloseTrade } from '@/lib/trading';
import { ACTIVITY_EVENT, readActivity } from '@/lib/activity';
import { nowSec } from '@/lib/clock';
import type { GameMatch } from '@/lib/types';
import { Modal, btnGhost, btnPrimary } from '@/components/Modal';
import { BotPanel } from '@/components/BotPanel';
import { MatchStatus } from '@/components/MatchStatus';
import { LocationBar } from '@/components/LocationBar';
import { Skeleton } from '@/components/Skeleton';
import type { SquadArenaView, WorldRoom } from '@/components/World3D';

const Hall = dynamic(() => import('@/components/SquadsHall3D').then((m) => m.SquadsHall3D), { ssr: false, loading: () => <div className="h-[420px] flex items-center justify-center text-sm opacity-70">Building the hall…</div> });

/** Shown while the 3D world downloads and starts: says what is happening, and what to do if it takes too long. */
function WorldLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 12_000); return () => clearTimeout(t); }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-zinc-300" role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-400" />
      <div>Building the 3D world…</div>
      <div className="text-xs text-zinc-500">The first visit downloads the 3D scene and models, which can take a few seconds.</div>
      {slow && <div className="max-w-sm text-xs text-amber-300">Still loading. A slow connection or device can take longer. If nothing appears after a minute, reload the page.</div>}
    </div>
  );
}

const World = dynamic(() => import('@/components/World3D').then((m) => m.World3D), { ssr: false, loading: () => <WorldLoading /> });

type Hex = `0x${string}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, '0')}`;

export function SquadsGame({ wallet, live }: { wallet: GameWallet; live: LiveMarkets }) {
  const progress = useProgress();
  const [ticker, setTicker] = useState('BTC');
  const [params, setParams] = useState<SquadParams | null>(null);
  const [matches, setMatches] = useState<SquadMatch[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [chain, setChain] = useState<{ bulls: number; bears: number } | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [leftover, setLeftover] = useState(0);
  const [actTick, setActTick] = useState(0);
  useEffect(() => { const f = () => setActTick((x) => x + 1); window.addEventListener(ACTIVITY_EVENT, f); return () => window.removeEventListener(ACTIVITY_EVENT, f); }, []);
  const [error, setError] = useState<string | null>(null);
  const [liveWarn, setLiveWarn] = useState<string | null>(null); // background reads that keep failing
  const [loaded, setLoaded] = useState(false); // the first read of the rooms has finished (even if it failed)
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelChip, setModelChip] = useState(false); // shown only if loading lasts more than a moment, so it never flickers
  const [now, setNow] = useState(0);
  const [side, setSide] = useState<'bulls' | 'bears'>('bulls');
  const [positionUsd, setPositionUsd] = useState(50);
  const [vault, setVault] = useState<Hex | null>(null);
  const [position, setPosition] = useState<{ size: number; entry: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const [ticket, setTicket] = useState<SquadMatch | 'new' | null>(null);
  const [newSize, setNewSize] = useState(4);
  const [openModal, setOpenModal] = useState(false);
  const [sizeText, setSizeText] = useState('4');
  const [notice, setNotice] = useState<{ title: string; body: React.ReactNode } | null>(null);
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
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoaded(true); }
  }, [ticker]);
  useEffect(() => { void reload(); const t = setInterval(reload, 8000); return () => clearInterval(t); }, [reload]);

  // Live team scores straight from the contract: the same numbers settle() will use.
  useEffect(() => {
    if (!match || !match.lockAt) { setChain(null); return; }
    const saved = `tow-final-${ticker}-${match.number}`;
    // After the result is posted the vaults are paid out and their equity drops to zero, so the contract's live numbers
    // would read -50 for everyone. Show the last real scores seen while the match was live instead, or none.
    if (['settled', 'cancelled'].includes(match.phase)) {
      try { const v = window.localStorage.getItem(saved); setChain(v ? (JSON.parse(v) as { bulls: number; bears: number }) : null); } catch { setChain(null); }
      return;
    }
    let stop = false;
    const go = () => squadScores(ticker, match.number).then((v) => {
      if (stop) return;
      setChain(v); setLiveWarn(null);
      try { window.localStorage.setItem(saved, JSON.stringify(v)); } catch { /* storage unavailable */ }
    }).catch(() => { if (!stop) setLiveWarn('Live scores are not updating right now (the chain connection is slow). Trying again.'); });
    void go();
    const t = setInterval(go, 6000);
    return () => { stop = true; clearInterval(t); };
  }, [match?.number, match?.lockAt, match?.phase, ticker]);

  useEffect(() => {
    setClaimed(false);
    if (match && me && match.phase !== 'filling') squadClaimed(ticker, match.number, me).then(setClaimed).catch(() => setLiveWarn('Could not check whether you already claimed. Reload before claiming.'));
  }, [match?.number, match?.phase, me, ticker]);

  // My own vault for this match, and the position it holds.
  useEffect(() => {
    setVault(null); setPosition(null);
    if (!match || !me || !mine) return;
    let stop = false;
    vaultAddress(ticker, match.number, me).then((v) => { if (!stop) setVault(v); }).catch(() => { if (!stop) setLiveWarn('Could not find your vault yet, so trading is paused. Trying again.'); });
    return () => { stop = true; };
  }, [match?.number, !!mine, me, ticker]);
  useEffect(() => {
    if (!vault || !match || match.phase === 'filling' || match.phase === 'confirming') return;
    let stop = false;
    const go = () => vaultPosition(vault, ticker).then((p) => { if (!stop) { setPosition(p); setLiveWarn(null); } }).catch(() => { if (!stop) setLiveWarn('Your open position is not updating right now. The numbers shown may be out of date.'); });
    void go();
    const t = setInterval(go, 6000);
    return () => { stop = true; clearInterval(t); };
  }, [vault, match?.phase, ticker]);
  // What is still sitting in my vault after the match (so the release button only shows when there is something to release).
  useEffect(() => {
    setLeftover(0);
    if (!vault || !match || !['settled', 'cancelled'].includes(match.phase)) return;
    let stop = false;
    const go = () => vaultWithdrawable(vault, ticker).then((w) => { if (!stop) setLeftover(w); }).catch(() => {});
    void go();
    const t = setInterval(go, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [vault, match?.phase, match?.number, ticker, claimed]);
  useEffect(() => { if (params) setPositionUsd((x) => (x === 50 ? params.bankrollUsd : x)); }, [params?.bankrollUsd]);

  const key = wallet.key as Hex | null;

  // Settling is open to anyone: the first player's open tab settles an ended match by itself (the Settle button stays as a backup).
  const autoSettled = useRef<string | null>(null);
  useEffect(() => {
    if (!match || !key || !mine || match.phase !== 'ended') return;
    const id = `${ticker}-${match.number}`;
    if (autoSettled.current === id) return;
    autoSettled.current = id;
    settleSquad(key, ticker, match.number)
      .then(() => reload())
      .catch(() => { setTimeout(() => { if (autoSettled.current === id) autoSettled.current = null; }, 15_000); });
  }, [match?.phase, match?.number, key, !!mine, Math.floor(now / 15)]);

  // the tab title carries the countdown, so a waiting player can switch tabs and still see the time
  useEffect(() => {
    const base = 'Tug of War';
    const l = match ? (match.phase === 'filling' ? match.lobbyEndsAt - now : match.phase === 'confirming' ? match.confirmEndsAt - now : match.phase === 'trading' ? match.endsAt - now : 0) : 0;
    const m = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
    document.title = match && mine && l > 0 ? `${m(l)} · ${match.id} · ${base}` : base;
    return () => { document.title = base; };
  }, [match?.id, match?.phase, !!mine, now]);
  useEffect(() => {
    if (!modelsLoading) { setModelChip(false); return; }
    const t = setTimeout(() => setModelChip(true), 400);
    return () => clearTimeout(t);
  }, [modelsLoading]);

  const sizeError = (() => {
    const t = sizeText.trim();
    if (!t) return 'Enter how many players the room should hold.';
    if (!/^\d+$/.test(t)) return 'Use a whole number, for example 6.';
    const n = Number(t);
    if (n < 2) return 'A match needs at least 2 players.';
    if (n > 20) return 'The most a match can have is 20 players.';
    if (params && n > params.size) return `This game is set up for rooms of up to ${params.size} players. Try ${params.size} or fewer.`;
    return null;
  })();
  /** True (and tells the player why) when they cannot act yet. */
  const blocked = (): boolean => {
    if (!wallet.ready) { setNotice({ title: 'One moment', body: 'Your wallet is still loading. Try again in a second.' }); return true; }
    if (wallet.locked) {
      setNotice({ title: 'Unlock your wallet', body: (<p>Your game wallet is locked. Enter your PIN in the wallet bar at the top of the page and press Unlock, then try again.</p>) });
      return true;
    }
    if (!key || !me) {
      setNotice({
        title: 'Create your game wallet first',
        body: (<>
          <p>Taking a seat needs a game wallet. Use the wallet panel at the top of the page to create one (or link your main wallet).</p>
          <p className="mt-2 text-zinc-400">Then send it a little STT for gas and some USDso: ${(params?.stakeUsd ?? 10) + (params?.bankrollUsd ?? 50)} per match ({params?.stakeUsd ?? 10} stake + {params?.bankrollUsd ?? 50} trading bankroll that comes back to you).</p>
        </>),
      });
      return true;
    }
    return false;
  };

  const act = async (title: string, labels: string[], fn: () => Promise<unknown>) => {
    const out = await progress.run(title, labels, async (adv) => { adv(0); await fn(); });
    await reload();
    return out.ok;
  };
  const toArena = () => setRoom({ kind: 'arena', ticker });

  const open = async (size?: number) => {
    if (blocked() || !key) return;
    const ok = await act('Opening a match', ['Seat + stake'], async () => {
      const n = await nextSquadNumber(ticker);
      await enterSquad(key, ticker, n, me as Hex, Math.max(2, Math.min(size ?? newSize, params?.size ?? 20)));
      setSelected(n);
    });
    if (ok) { setTicket(null); if (view === 'world') toArena(); }
  };
  const join = async (m: SquadMatch) => {
    if (blocked() || !key) return;
    const ok = await act('Taking your seat', ['Seat + stake'], () => enterSquad(key, ticker, m.number, me as Hex, m.size));
    if (ok) { setSelected(m.number); setTicket(null); if (view === 'world') toArena(); }
  };
  const leave = (m: SquadMatch) => key && act('Leaving', ['Leave and refund'], () => leaveSquad(key, ticker, m.number, me as Hex));
  const confirm = (m: SquadMatch) => key && act('Confirming', ['Confirm'], () => confirmSquad(key, ticker, m.number, me as Hex));
  const finish = (m: SquadMatch) => key && act('Locking the match', ['Lock'], () => finishSquad(key, ticker, m.number));
  const settle = (m: SquadMatch) => key && act('Settling', ['Computing the result on chain'], () => settleSquad(key, ticker, m.number));
  const refreshClaimed = async (m: SquadMatch) => { try { setClaimed(await squadClaimed(ticker, m.number, me as Hex)); } catch { /* the next check will try again */ } };
  // Close any open position first (it locks part of the bankroll), then pay out, then send the bankroll back.
  const claim = async (m: SquadMatch) => {
    if (!key) return;
    await act('Claiming', ['Closing your position', 'Paying out', 'Sending your bankroll back'], async () => {
      if (vault && position) { try { await vaultClose(key, vault, ticker); } catch { /* still claim; the leftover can be released after */ } }
      await claimSquad(key, ticker, m.number, me as Hex);
      if (vault) { try { if ((await vaultWithdrawable(vault, ticker)) > 0.01) await releaseSquad(key, ticker, m.number, me as Hex); } catch { /* the Release button stays */ } }
    });
    await refreshClaimed(m);
  };
  /** One tap to a game: the fullest open room on this market that has a free seat, or a new room. */
  const quickPlay = async () => {
    if (blocked()) return;
    // look at every market, not just the one on screen
    const tickers = live.markets.length ? live.markets.map((m) => m.ticker) : [ticker];
    const found = (await Promise.all(tickers.map((t) => loadSquadMatches(t, 10).catch(() => [] as SquadMatch[])))).flat();
    const openRooms = found
      .filter((m) => m.phase === 'filling' && m.players.length < (m.size || 0) && !(me && m.players.some((p) => p.address.toLowerCase() === me.toLowerCase())))
      .sort((a, b) => b.players.length - a.players.length);
    const best = openRooms[0];
    if (best) {
      const t = best.ticker;
      setTicker(t);
      if (room.kind === 'hub') setRoom({ kind: 'market', ticker: t });
      setSelected(best.number);
      setTicket(best);
    } else {
      if (room.kind === 'hub') setRoom({ kind: 'market', ticker });
      openRoomModal();
    }
  };
  const openRoomModal = () => { if (blocked()) return; setSizeText(String(Math.min(4, params?.size ?? 4))); setOpenModal(true); };
  const trade = () => key && vault && match && act('Opening your trade', ['Sending order from your vault'], () => vaultOrder(key, vault, ticker, side === 'bulls' ? 'buy' : 'sell', positionUsd, match.number));
  const close = () => key && vault && act('Closing your position', ['Closing'], () => vaultClose(key, vault, ticker));
  const release = async (m: SquadMatch) => {
    if (!key) return;
    await act('Releasing your bankroll', ['Closing your position', 'Sending it back'], async () => {
      if (vault && position) { try { await vaultClose(key, vault, ticker); } catch { /* try the release anyway */ } }
      try { await releaseSquad(key, ticker, m.number, me as Hex); } catch (e) { throw new Error(((e as Error).message ?? 'Release failed.') + (vault ? await vaultReleaseDiagnosis(vault, ticker) : '')); }
    });
    await refreshClaimed(m);
  };
  const closeOne = (id: string, side: 'buy' | 'sell', qty: string) => key && vault && match && act('Closing that trade', ['Sending the closing order'], () => vaultCloseTrade(key, vault, ticker, match.number, id, side, qty));

  if (!squadsEnabled) {
    return <Shell><p>Squads mode is not switched on: <code>NEXT_PUBLIC_SQUADS_ADDRESS</code> is empty. Run <code>npm run deploy:squads</code>.</p></Shell>;
  }

  const left = match ? (match.phase === 'filling' ? match.lobbyEndsAt - now : match.phase === 'confirming' ? match.confirmEndsAt - now : match.phase === 'trading' ? match.endsAt - now : 0) : 0;
  const gap = chain ? chain.bulls - chain.bears : 0;
  const w = !chain || gap === 0 ? 3 : gap > 0 ? 1 : 2;
  const cap = (params?.stakeUsd ?? 10) * 10;
  const lead = Math.max(-1, Math.min(1, gap / cap)); // a full cap of difference fills the rope

  const panel = match ? (
        <section className="mt-6 border rounded p-4">
          <h2 className="mb-2 font-semibold">{match.id}</h2>
          <MatchStatus match={match} now={now} params={params} myTeam={(mine?.team ?? 0) as 0 | 1 | 2} seated={!!mine} claimed={claimed} />

          {(match.phase === 'filling' || match.phase === 'confirming') && (
            <p className="text-sm opacity-80 my-2">{mine && mine.team ? `You are on team ${TEAM_NAME[mine.team]}, drawn at random when you took your seat. ` : ''}Nobody picks a side, and you can trade any direction once it starts.</p>
          )}
          {match.phase === 'cancelled' && <p className="text-sm my-2 text-amber-500">This match was cancelled: not enough players continued, or one team ended up with nobody. Nothing was played, and every stake and bankroll can be claimed back.</p>}
          {match.lockAt > 0 && <p className="text-sm my-2">{mine && mine.team ? `You are a ${TEAM_NAME[mine.team].replace(/s$/, '')}. ` : ''}Both teams trade freely until the clock ends; the team with the better average equity gain wins.</p>}

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
              <div className="flex justify-between text-sm"><span>Bulls {chain.bulls >= 0 ? '+' : ''}{chain.bulls.toFixed(2)} USDso</span><span>Bears {chain.bears >= 0 ? '+' : ''}{chain.bears.toFixed(2)} USDso</span></div>
              <div className="h-3 rounded bg-rose-600/70 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-emerald-500/80 transition-all" style={{ width: `${50 + lead * 50}%` }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => setTicket(match)}>Take a seat</button>}
            {mine && match.phase === 'filling' && <button className="border rounded px-3 py-1" onClick={() => leave(match)}>Leave and get my stake back</button>}
            {mine && match.phase === 'confirming' && !mine.confirmed && <button className="border rounded px-3 py-1" onClick={() => confirm(match)}>Continue with fewer players</button>}
            {match.phase === 'confirming' && <button className="border rounded px-3 py-1" onClick={() => leave(match)} disabled={!mine}>Leave</button>}
            {match.phase === 'finishable' && <button className="border rounded px-3 py-1" onClick={() => finish(match)}>Lock the match</button>}
            {mine && ['cancelled', 'settled'].includes(match.phase) && !claimed && (
              <button className="border rounded px-3 py-1" onClick={() => claim(match)}>{match.phase === 'cancelled' || match.result === 3 ? 'Claim refund + bankroll' : match.result === mine.team ? 'Claim payout + bankroll' : 'Get my bankroll back'}</button>
            )}
            {mine && claimed && ['cancelled', 'settled'].includes(match.phase) && (leftover > 0.01 || position) && <button className="border rounded px-3 py-1" onClick={() => release(match)}>{position ? 'Close position and release bankroll' : `Release ${leftover.toFixed(2)} USDso bankroll`}</button>}
            {match.phase === 'ended' && <button className="border rounded px-3 py-1" onClick={() => settle(match)}>Settle the result</button>}
            {claimed && !(leftover > 0.01 || position) && <span className="text-sm">All paid out. Nothing left to claim.</span>}
          </div>

          {mine && match.phase === 'trading' && market && (
            <div className="mt-4 border-t pt-3">
              <h3 className="font-medium mb-1">Your vault (real dreamDEX position)</h3>
              <p className="text-xs opacity-70 mb-2">Your own contract holds your ${params?.bankrollUsd ?? 50} bankroll. Only you (or your bot) can trade from it, and it pays only you.{position ? ` Open: ${position.size > 0 ? 'long' : 'short'} ${Math.abs(position.size)} ${ticker} @ ${position.entry.toFixed(2)}.` : ' No open position.'}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className={`border rounded px-3 py-1 ${side === 'bulls' ? 'ring-2' : ''}`} onClick={() => setSide('bulls')}>Buy</button>
                <button className={`border rounded px-3 py-1 ${side === 'bears' ? 'ring-2' : ''}`} onClick={() => setSide('bears')}>Sell</button>
                <label>Position $<input className="w-20 border rounded px-1 ml-1 bg-transparent" type="number" min={1} value={positionUsd} onChange={(e) => setPositionUsd(Math.max(1, Number(e.target.value)))} /></label>
                <button className="border rounded px-3 py-1" onClick={trade} disabled={!vault}>Place trade</button>
                <button className="border rounded px-3 py-1" onClick={close} disabled={!vault || !position}>Close all</button>
              </div>
              {(() => {
                void actTick;
                const longNow = (position?.size ?? 0) > 0;
                const mine2 = readActivity(me).filter((a) => a.kind === 'trade' && a.status === 'confirmed' && a.trade && a.match?.ticker === ticker && a.match.number === match.number && position && (a.trade.side === 'buy') === longNow);
                return mine2.length ? (
                  <ul className="mt-2 text-sm space-y-1">
                    {mine2.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 border rounded px-2 py-1">
                        <span>{a.trade!.side === 'buy' ? 'Buy' : 'Sell'} ${a.trade!.usd} <span className="opacity-60 text-xs">{new Date(a.t).toLocaleTimeString()}</span></span>
                        <button className="border rounded px-2 py-0.5" onClick={() => closeOne(a.id, a.trade!.side, a.trade!.qty)}>Close this trade</button>
                      </li>
                    ))}
                  </ul>
                ) : null;
              })()}
              <p className="text-xs opacity-70 mt-2">Trade as often as you like in either direction. Your score is how much your vault's equity changed since the lock, open positions included. Nothing outside the match can change it.</p>
              <BotPanel
                active={match.phase === 'trading'}
                price={market ? market.price : null}
                position={position}
                secondsLeft={Math.max(0, match.endsAt - now)}
                team={mine.team === 1 ? 'bulls' : mine.team === 2 ? 'bears' : null}
                bankroll={params?.bankrollUsd ?? 50}
                canTrade={!!vault && !!key}
                onOrder={(sd, usd) => vaultOrder(key as Hex, vault as Hex, ticker, sd, usd, match.number)}
                onClose={() => vaultClose(key as Hex, vault as Hex, ticker)}
              />
            </div>
          )}

          {match.phase === 'ended' && <p className="text-sm mt-3">Time is up. Leading team: {chain ? (w === 3 ? 'tie' : w === 1 ? 'Bulls' : 'Bears') : '…'}. Anyone can press Settle: the contract computes the winner from dreamDEX equity, then winners claim.</p>}
          {match.phase === 'settled' && <p className="text-sm mt-3">Result: {match.result === 3 ? 'tie (refund)' : `${TEAM_NAME[match.result as 1 | 2]} won`}.</p>}
        </section>
  ) : null;


  // Matches that are over and fully paid out leave the 3D hall; one I still have to claim or release stays until I do.
  const stillMine = (m: SquadMatch) => !['settled', 'cancelled', 'ended'].includes(m.phase) || (m.number === match?.number && !!mine && (!claimed || leftover > 0.01 || !!position));
  const hallMatches = matches.filter(stillMine);
  const toGame = (m: SquadMatch): GameMatch => ({
    id: m.id, market: m.ticker as GameMatch['market'], bulls: 0, bears: 0, total: m.players.length, requiredPlayers: m.size, size: m.size,
    slotsRemaining: Math.max(0, m.size - m.players.length), entryFee: params?.stakeUsd ?? 10,
    status: m.phase === 'filling' ? 'filling' : m.phase === 'confirming' ? 'confirming' : m.phase === 'trading' ? 'running' : m.phase === 'cancelled' ? 'cancelled' : m.phase === 'settled' ? 'settled' : 'running',
    lobbyEndsAt: m.lobbyEndsAt,
    playersList: m.players.map((p) => ({ isUser: !!me && p.address.toLowerCase() === me.toLowerCase(), side: 'bulls' })),
  } as unknown as GameMatch);
  const draft: SquadMatch | null = draftNumber ? { id: `${ticker} #${draftNumber}`, ticker, number: draftNumber, size: Math.max(2, Math.min(newSize, params?.size ?? newSize)), players: [], phase: 'filling', firstAt: 0, lockAt: 0, endsAt: 0, lobbyEndsAt: 0, confirmEndsAt: 0, result: 0, bulls: 0, bears: 0 } : null;
  const ticketMatch = ticket === 'new' ? draft : ticket;
  const arena: SquadArenaView | null = match
    ? { id: match.id, phase: match.phase, left: Math.max(0, left), size: match.size, players: match.players.map((p) => ({ team: p.team, confirmed: p.confirmed, isMe: !!me && p.address.toLowerCase() === me.toLowerCase() })), bulls: chain ? chain.bulls : null, bears: chain ? chain.bears : null, result: match.result, scale: Math.max(2, (params?.bankrollUsd ?? 50) * 0.1), kick: readActivity(me).filter((a) => a.kind === 'trade' && a.status === 'confirmed' && a.match?.ticker === ticker && a.match.number === match.number).length + (void actTick, 0), myTeam: (mine?.team ?? 0) as 0 | 1 | 2 }
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
        matches={hallMatches.map(toGame)}
        selectedMatch={ticketMatch ? toGame(ticketMatch) : null}
        ticketOpen={ticket !== null}
        onEnterMarket={(t) => { setTicker(t); setSelected(null); setTicket(null); setRoom({ kind: 'market', ticker: t }); }}
        onPickSide={() => {}}
        onPickMatch={(g) => {
          const m = matches.find((x) => x.id === g.id);
          if (!m) return;
          if (blocked()) return;
          setSelected(m.number);
          if (me && m.players.some((p) => p.address.toLowerCase() === me.toLowerCase())) { setTicket(null); toArena(); } else setTicket(m);
        }}
        onOpenNew={openRoomModal}
        onConfirmSeat={() => { if (ticket && ticket !== 'new') void join(ticket); }}
        onCloseTicket={() => setTicket(null)}
        onModelStatus={(s) => setModelsLoading(s === 'loading')}
        onModelFail={(what) => setLiveWarn(`Could not load the 3D model for ${what}, so plain stand-ins are shown. The game still works; reload to try again.`)}
        onBackToLobby={() => { setTicket(null); if (room.kind === 'arena') setRoom({ kind: 'market', ticker }); else setRoom({ kind: 'hub' }); }}
        onResume={() => {}}
        onFail={() => setView('screens')}
      />
      {room.kind === 'arena' && panel && (
        <div className="absolute left-3 top-16 z-10 w-[min(92vw,26rem)] max-h-[calc(100%-5rem)] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/90 text-zinc-100 p-2 text-sm">{panel}</div>
      )}
      {!error && liveWarn && <div className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-amber-500/40 bg-amber-950/80 px-3 py-2 text-xs text-amber-200">{liveWarn}</div>}
      {error && <div className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-rose-500/40 bg-rose-950/80 px-3 py-2 text-xs text-rose-200">{error}</div>}
      {!wallet.ready ? null : !key && (
        <div className="absolute inset-x-3 top-16 z-10 rounded-xl border border-amber-500/40 bg-amber-950/80 px-3 py-2 text-xs text-amber-200">{wallet.locked ? 'Your game wallet is locked. Enter your PIN in the wallet bar above to take a seat.' : 'No game wallet yet. Create one in the wallet bar above to take a seat.'}</div>
      )}
      <LocationBar
        kind={room.kind === 'arena' ? 'arena' : room.kind === 'market' ? 'market' : 'hub'}
        ticker={ticker}
        matchId={match ? match.id : null}
        onHub={() => { setTicket(null); setRoom({ kind: 'hub' }); }}
        onMarket={() => { setTicket(null); setRoom({ kind: 'market', ticker }); }}
        onFind={quickPlay}
        finding={false}
        loadingRooms={!loaded && !error}
      />
      {modelChip && room.kind === 'arena' && <div className="absolute bottom-14 left-3 z-10 inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/90 px-3 py-1.5 text-xs text-zinc-300" role="status"><span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-emerald-400" />Loading characters…</div>}
    </div>
  );

  return (
    <Shell>
      {progress.modal}
      {notice && <Modal title={notice.title} onClose={() => setNotice(null)} footer={<button className={btnPrimary} onClick={() => setNotice(null)}>OK</button>}>{notice.body}</Modal>}
      {openModal && (
        <Modal
          title="Open a new match room"
          onClose={() => setOpenModal(false)}
          footer={<>
            <button className={btnGhost} onClick={() => setOpenModal(false)}>Cancel</button>
            <button className={btnPrimary} disabled={!!sizeError} onClick={() => { setOpenModal(false); void open(Number(sizeText)); }}>Open room and take my seat</button>
          </>}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-400">How many players? (2 to {Math.min(20, params?.size ?? 20)})</span>
            <input
              autoFocus
              inputMode="numeric"
              value={sizeText}
              onChange={(e) => setSizeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !sizeError) { setOpenModal(false); void open(Number(sizeText)); } }}
              className={`w-full rounded-lg border bg-zinc-950 px-3 py-2 text-lg font-mono outline-none focus:border-emerald-500 ${sizeError ? 'border-rose-500' : 'border-zinc-700'}`}
              aria-invalid={!!sizeError}
            />
          </label>
          {sizeError ? <p className="text-xs text-rose-400">{sizeError}</p> : <p className="text-xs text-emerald-400">Your team is drawn at random the moment you take a seat, so teams can be uneven.</p>}
          <dl className="space-y-1 rounded-lg bg-zinc-950/60 p-3 text-xs text-zinc-300">
            <div className="flex justify-between"><dt>Stake</dt><dd>${(params?.stakeUsd ?? 10).toFixed(2)} USDso</dd></div>
            <div className="flex justify-between"><dt>Your trading bankroll (comes back)</dt><dd>${(params?.bankrollUsd ?? 50).toFixed(2)} USDso</dd></div>
            <div className="flex justify-between"><dt>You pay now</dt><dd>${((params?.stakeUsd ?? 10) + (params?.bankrollUsd ?? 50)).toFixed(2)} USDso</dd></div>
          </dl>
        </Modal>
      )}
      {view === 'world' ? worldView : (<>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select className="border rounded px-2 py-1 bg-transparent" value={ticker} onChange={(e) => { setTicker(e.target.value); setSelected(null); }}>
          {(live.markets.length ? live.markets.map((m) => m.ticker) : ['BTC']).map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="border rounded px-3 py-1" onClick={() => openRoomModal()} disabled={!key || !me}>Open a new match (${params?.stakeUsd ?? 10} stake)</button>
      </div>
      <div className="mb-4">
        <Hall matches={hallMatches} size={params?.size ?? 4} me={me} now={now} selected={match} onJoinRing={() => setPicker(true)} onOpenRing={() => openRoomModal()} />
      </div>
      {view === 'screens' && picker && (
        <div className="fixed inset-0 z-[96] bg-black/60 overflow-y-auto overscroll-contain" data-world-ui onClick={() => setPicker(false)}>
         <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
          <div className="bg-zinc-900 text-white rounded p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
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
        </div>
      )}
      {view === 'screens' && ticket && (() => {
        const t = ticket === 'new' ? null : ticket;
        const stakeUsd = params?.stakeUsd ?? 10;
        const maxSize = params?.size ?? 4;
        const size = t ? t.size : Math.max(2, Math.min(newSize, maxSize));
        const seated = t ? t.players.length : 0;
        return (
          <div className="fixed inset-0 z-[96] bg-black/60 overflow-y-auto overscroll-contain" data-world-ui onClick={() => setTicket(null)}>
           <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
            <div className="bg-zinc-900 text-white rounded p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs opacity-60">ENTRY TICKET</p>
              <h2 className="text-lg font-semibold">{t ? t.id : `${ticker} · new match room`}</h2>
              <dl className="text-sm my-3 space-y-2">
                <div className="flex justify-between"><dt className="opacity-70">Market</dt><dd>{ticker}-PERP, only {ticker} players</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Stake</dt><dd>${stakeUsd.toFixed(2)} USDso, paid when you take the seat</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Trading bankroll</dt><dd>${(params?.bankrollUsd ?? 50).toFixed(2)} in your own vault, returned to you</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Pool at a full room</dt><dd>${(stakeUsd * size).toFixed(2)}</dd></div>
                <div className="flex justify-between items-center"><dt className="opacity-70">Seats</dt><dd>{seated} / {size} taken</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Your team</dt><dd>Drawn at random when you take the seat</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Winner</dt><dd>Team with the bigger average vault gain</dd></div>
                <div className="flex justify-between"><dt className="opacity-70">Payout</dt><dd>Stake back + {Math.round((1 - (params?.rake ?? 0.2)) * 100)}% of the losers' pool</dd></div>
              </dl>
              <p className="text-xs opacity-70 mb-3">Taking the seat stakes ${stakeUsd} and funds your own trading vault with the bankroll. Leave before the lock and both come straight back. Nobody picks a side: once the match locks you can trade any direction, as often as you like from your vault. A tie or a match that never starts refunds everyone.</p>
              <div className="flex gap-2">
                <button className="border rounded px-3 py-1" onClick={() => setTicket(null)}>Back</button>
                <button className="border rounded px-3 py-1" onClick={() => { const x = ticket; setTicket(null); if (x === 'new') void open(); else join(x); }}>Take my seat</button>
              </div>
            </div>
           </div>
          </div>
        );
      })()}
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {!error && liveWarn && <p className="text-amber-500 text-sm mb-3">{liveWarn}</p>}
      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div>
          <h2 className="font-semibold mb-2">Matches</h2>
          {!loaded && !error && (<div className="space-y-2" aria-busy="true"><Skeleton className="h-12 w-full rounded" /><Skeleton className="h-12 w-full rounded" /><Skeleton className="h-12 w-full rounded" /></div>)}
          {loaded && !matches.length && <p className="text-sm opacity-70">No matches yet on {ticker}. Open one.</p>}
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
