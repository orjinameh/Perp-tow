'use client';

import { LobbySkeleton } from '@/components/Skeleton';
import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { addPending, getPending, removePending } from '@/lib/pending';
import type { WorldRoom } from '@/components/World3D';
import { MatchStatusPanel } from '@/components/MatchStatusPanel';
import { LeadersPanel } from '@/components/LeadersPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { useCopyTrade } from '@/lib/useCopyTrade';
import {
  CryptoAsset,
  GameMatch,
  PositionSide,
  PrototypeScreen,
} from '@/lib/types';
import { useLiveMarkets } from '@/lib/useLiveMarkets';
import { useGameWallet } from '@/lib/useGameWallet';
import { useMatches } from '@/lib/useMatches';
import { draftMatch, nextMatchNumber } from '@/lib/matches';
import type { EntryReceipt } from '@/lib/trading';
import { WalletPanel } from '@/components/WalletPanel';
import { useAutoTrade } from '@/lib/useAutoTrade';
import { CORE_RULES } from '@/lib/payout';
import { MATCH_SIZE, LEVERAGE as LEVERAGE_DEFAULT, leverageChoices } from '@/lib/gameTag';
import { soundFx } from '@/lib/sound';
import { Navbar } from '@/components/Navbar';
import { FlowBreadcrumbs } from '@/components/FlowBreadcrumbs';
import { GlobalLobby } from '@/components/GlobalLobby';
import { MarketChartScreen } from '@/components/MarketChartScreen';
import { MatchesListScreen } from '@/components/MatchesListScreen';
import { MatchInspectScreen } from '@/components/MatchInspectScreen';
import { EntryConfirmScreen } from '@/components/EntryConfirmScreen';
import { EntrySuccessScreen } from '@/components/EntrySuccessScreen';
import { AlgorithmSafeguardsModal } from '@/components/AlgorithmSafeguardsModal';

const World3D = dynamic(() => import('@/components/World3D').then((m) => m.World3D), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-zinc-400">Building the 3D hall…</div>,
});

export default function TugOfWarApp() {
  // When the squads game is deployed it is the main game: random teams, free trading. `/?classic=1` keeps the old one.
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SQUADS_ADDRESS && !new URLSearchParams(window.location.search).has('classic')) window.location.replace('/squads');
  }, []);

  // Step 1 Initial UI state according to specification
  const [screen, setScreen] = useState<PrototypeScreen>('lobby');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);
  const [selectedSide, setSelectedSide] = useState<PositionSide | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<GameMatch | null>(null);
  const [receipt, setReceipt] = useState<EntryReceipt | null>(null);
  const wallet = useGameWallet();
  const autoTradeNote = useAutoTrade(wallet);
  const copy = useCopyTrade(wallet);
  const [leadersOpen, setLeadersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 3D world or the classic screens. The 3D world drives the very same state and screens.
  const [view, setView] = useState<'world' | 'classic'>('world');
  const [worldNote, setWorldNote] = useState<string | null>(null);
  const [arenaId, setArenaId] = useState<string | null>(null);
  const [hudOpen, setHudOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem('tow.view') === 'classic') setView('classic');
    } catch {
      /* storage unavailable: stay in the 3D world */
    }
  }, []);
  const switchView = (v: 'world' | 'classic') => {
    setView(v);
    try {
      localStorage.setItem('tow.view', v);
    } catch {
      /* ignore */
    }
  };

  // Modal and Sound states
  const [isSpecsOpen, setIsSpecsOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Live prices, candles, volume and open interest from the dreamDEX indexer
  const live = useLiveMarkets();
  const currentMarket = live.markets.find((m) => m.ticker === selectedAsset);

  // Matches are rebuilt from real dreamDEX orders that carry the game tag (see lib/matches.ts).
  const matchState = useMatches(
    screen === 'lobby' ? null : currentMarket?.pool ?? null,
    selectedAsset,
    wallet.player,
  );
  const currentMatches: GameMatch[] = matchState.matches;

  const arenaMatch = arenaId ? currentMatches.find((m) => m.id === arenaId) ?? (selectedMatch?.id === arenaId ? selectedMatch : null) : null;
  const room: WorldRoom =
    arenaId && selectedAsset ? { kind: 'arena', ticker: selectedAsset } : screen === 'lobby' || !selectedAsset ? { kind: 'hub' } : { kind: 'market', ticker: selectedAsset };
  // A finished or cancelled match no longer needs its saved seat, so its "MY MATCH" door goes away.
  useEffect(() => {
    if (!wallet.address) return;
    for (const m of currentMatches) {
      if (m.status !== 'settled' && m.status !== 'cancelled') continue;
      if (m.id === arenaId) continue;
      removePending({ ticker: m.market, number: Number(m.id.split('#')[1]), address: wallet.address as string });
    }
  }, [currentMatches, wallet.address, arenaId]);

  const worldActive = view === 'world' && live.status === 'ok';
  // In the 3D room the match list is a wall and the entry ticket is a board, so only the inspect page is still a panel.
  const panelOpen = view === 'world' && !arenaId && screen === 'inspect';
  const ticketOpen = view === 'world' && !arenaId && screen === 'entry' && !!selectedMatch;
  const confirmRef = useRef<(() => void) | null>(null);
  const [lev3d, setLev3d] = useState<number>(LEVERAGE_DEFAULT);
  const mySeats = wallet.address ? getPending().filter((p) => p.address.toLowerCase() === (wallet.address as string).toLowerCase()) : [];
  const resumeSeat = mySeats.length ? mySeats[mySeats.length - 1] : null;

  const handleOpenNewMatch = () => {
    if (!selectedAsset) return;
    setSelectedMatch(draftMatch(selectedAsset, nextMatchNumber(currentMatches)));
    setScreen('entry');
  };

  // Step 2: Select a market
  const handleSelectMarket = (asset: CryptoAsset) => {
    setSelectedAsset(asset);
    setScreen('chart');
  };

  // Step 3: Choose Bulls or Bears
  const handleSelectSide = (side: PositionSide) => {
    setSelectedSide(side);
    setScreen('matches');
  };

  // Step 4: Display & Select match
  const handleSelectMatch = (match: GameMatch) => {
    // Already seated on chain (walked out of the room, or reloaded): go back to the seat, never re-enter.
    const mine = match.playersList?.find((p) => p.isUser);
    if (mine && wallet.address) {
      const number = Number(match.id.split('#')[1]);
      const have = getPending().some((p) => p.ticker === match.market && p.number === number && p.address.toLowerCase() === (wallet.address as string).toLowerCase());
      if (!have) addPending({ ticker: match.market, pool: currentMarket?.pool ?? '', number, side: mine.side, address: wallet.address as string, placed: false, leverage: LEVERAGE_DEFAULT });
      setSelectedMatch(match);
      setSelectedSide(mine.side);
      if (view === 'world') setArenaId(match.id);
      setScreen('done');
      return;
    }
    setSelectedMatch(match);
    setScreen('entry');
  };

  // Step 5 -> Step 7: Continue to entry screen
  const handleContinueToEntry = (inspectedMatch: GameMatch) => {
    setSelectedMatch(inspectedMatch);
    setScreen('entry');
  };

  // Step 7 -> Step 8: seat taken
  const handleEntered = (r: EntryReceipt) => {
    setReceipt(r);
    matchState.reload();
    if (view === 'world' && selectedMatch) setArenaId(selectedMatch.id);
    setScreen('done');
  };

  // Step 8: Return to global lobby
  const handleReturnToLobby = () => {
    // Leaving a finished match clears the saved seat so its door disappears.
    if (arenaMatch && (arenaMatch.status === 'settled' || arenaMatch.status === 'cancelled') && wallet.address) {
      removePending({ ticker: arenaMatch.market, number: Number(arenaMatch.id.split('#')[1]), address: wallet.address as string });
    }
    setArenaId(null);
    setSelectedAsset(null);
    setSelectedSide(null);
    setSelectedMatch(null);
    setScreen('lobby');
  };

  // Step 8 alternative: Inspect another match in current market
  const handleInspectAnother = () => {
    setScreen('matches');
  };

  // Breadcrumbs navigation jump
  const handleBreadcrumbNavigate = (targetScreen: PrototypeScreen) => {
    if (targetScreen === 'lobby') {
      handleReturnToLobby();
    } else if (targetScreen === 'chart' && selectedAsset) {
      setScreen('chart');
    } else if (targetScreen === 'matches' && selectedAsset && selectedSide) {
      setScreen('matches');
    } else if (targetScreen === 'inspect' && selectedMatch) {
      setScreen('inspect');
    } else if (targetScreen === 'entry' && selectedMatch && selectedSide) {
      setScreen('entry');
    }
  };

  const handleToggleMute = () => {
    const muted = soundFx.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-zinc-950">
      {/* Top Navbar */}
      <Navbar
        currentScreen={screen}
        onNavigateHome={handleReturnToLobby}
        onOpenSpecs={() => setIsSpecsOpen(true)}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        view={view}
        onToggleView={() => switchView(view === 'world' ? 'classic' : 'world')}
        onOpenLeaders={live.status === 'ok' ? () => setLeadersOpen(true) : undefined}
        onOpenHistory={live.status === 'ok' ? () => setHistoryOpen(true) : undefined}
      />

      <WalletPanel wallet={wallet} />
      {autoTradeNote && (
        <div className="border-b border-amber-500/30 bg-amber-950/30 px-4 py-2 text-center text-xs text-amber-200">{autoTradeNote}</div>
      )}

      {copy.follow && (
        <div className="border-b border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-center text-xs text-emerald-200">
          Copying {copy.follow.leader.slice(0, 6)}…{copy.follow.leader.slice(-4)} on {copy.follow.ticker}
          {copy.leaderNow ? ` · they are ${copy.leaderNow}` : ''}
          {copy.events[0] ? ` · ${copy.events[0].text.slice(0, 90)}` : ''}{' '}
          <button onClick={() => copy.stop()} className="ml-2 underline">Stop</button>
        </div>
      )}
      {historyOpen && live.status === 'ok' && <HistoryPanel markets={live.markets} wallet={wallet} onClose={() => setHistoryOpen(false)} />}
      {leadersOpen && live.status === 'ok' && <LeadersPanel markets={live.markets} wallet={wallet} copy={copy} onClose={() => setLeadersOpen(false)} />}
      {worldNote && <div className="border-b border-rose-500/30 bg-rose-950/30 px-4 py-2 text-center text-xs text-rose-200">{worldNote}</div>}

      {/* Step Flow Ribbon Indicator */}
      {view === 'classic' && <FlowBreadcrumbs
        currentScreen={screen}
        selectedAsset={selectedAsset}
        selectedSide={selectedSide}
        selectedMatchId={selectedMatch?.id || null}
        onNavigate={handleBreadcrumbNavigate}
      />}

      {/* Dynamic Screen Viewport */}
      {worldActive && (
        <div className="relative h-[calc(100dvh-9rem)] min-h-[460px] w-full [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:fixed [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:inset-0 [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:z-40 [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:h-auto [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:min-h-0">
          <button
            data-world-ui
            onClick={() => switchView('classic')}
            className="absolute right-3 top-3 z-10 hidden rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs font-semibold text-zinc-200 [@media(pointer:coarse)_and_(orientation:landscape)_and_(max-height:520px)]:block"
          >
            Classic view
          </button>
          <World3D
            room={room}
            markets={live.markets}
            side={selectedSide}
            match={arenaMatch}
            resume={resumeSeat ? { ticker: resumeSeat.ticker, number: resumeSeat.number } : null}
            frozen={panelOpen}
            matches={currentMatches}
            selectedMatch={selectedMatch}
            ticketOpen={ticketOpen}
            leverage={Math.min(lev3d, leverageChoices(currentMarket?.maxLeverage).slice(-1)[0])}
            onPickMatch={handleSelectMatch}
            onOpenNew={handleOpenNewMatch}
            onConfirmSeat={() => confirmRef.current?.()}
            onCloseTicket={() => setScreen('matches')}
            onEnterMarket={handleSelectMarket}
            onPickSide={handleSelectSide}
            onBackToLobby={handleReturnToLobby}
            onResume={() => {
              if (!resumeSeat) return;
              setSelectedAsset(resumeSeat.ticker);
              setSelectedSide(resumeSeat.side);
              setArenaId(`${resumeSeat.ticker} #${resumeSeat.number}`);
              setScreen('done');
            }}
            onFail={(msg) => {
              setWorldNote(`The 3D world could not start (${msg}). Showing the classic screens.`);
              setView('classic');
            }}
          />

          {/* The entry logic stays the same; the 3D ticket board presses its confirm button. */}
          {ticketOpen && selectedAsset && selectedSide && selectedMatch && (
            <div className="absolute h-0 w-0 overflow-hidden" aria-hidden>
              <EntryConfirmScreen
                market={selectedAsset}
                selectedSide={selectedSide}
                match={selectedMatch}
                wallet={wallet}
                pool={currentMarket?.pool ?? ''}
                maxLeverage={currentMarket?.maxLeverage}
                onEntered={handleEntered}
                onBackToInspect={() => setScreen('matches')}
                registerConfirm={(fn) => { confirmRef.current = fn; }}
                leverageOverride={Math.min(lev3d, leverageChoices(currentMarket?.maxLeverage).slice(-1)[0])}
              />
            </div>
          )}
          {ticketOpen && (
            <div data-world-ui className="absolute right-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-950/85 px-3 py-2 text-xs text-zinc-300">
              <span className="mr-1">Leverage</span>
              {leverageChoices(currentMarket?.maxLeverage).map((x) => (
                <button key={x} onClick={() => setLev3d(x)} className={`rounded-md border px-2 py-1 font-mono font-bold ${Math.min(lev3d, leverageChoices(currentMarket?.maxLeverage).slice(-1)[0]) === x ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-300'}`}>{x}x</button>
              ))}
            </div>
          )}

          {/* Room captions */}
          {!arenaId && room.kind === 'market' && !panelOpen && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              {room.ticker} room. Pick Bulls or Bears on a pad, then walk to the match wall on the right. Your ticket is on the left wall.
            </div>
          )}
          {room.kind === 'hub' && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
              Walk into a market door. {MATCH_SIZE} players per match · ${CORE_RULES.ENTRY_FEE} entry · pick your own leverage.
            </div>
          )}

          {/* Tug of war room panel */}
          {arenaId && (
            <div data-world-ui className="absolute left-3 top-3 z-10 w-[min(92vw,22rem)] max-h-[70%] space-y-2 overflow-y-auto">
              <button
                onClick={() => setHudOpen((o) => !o)}
                className="rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-xs font-semibold text-zinc-200"
              >
                {hudOpen ? 'Hide match panel' : 'Show match panel'}
              </button>
              {hudOpen && (
                <>
                  {receipt?.seatOnly && (
                    <div className="rounded-xl border border-emerald-500/30 bg-zinc-950/90 px-3 py-2 text-[11px] text-emerald-300 break-all">
                      Seat taken.{' '}
                      <a className="underline" target="_blank" rel="noreferrer" href={`https://explorer.testnet.somnia.network/tokyo/tx/${receipt.txHash}`}>
                        View the transaction
                      </a>
                    </div>
                  )}
                  {arenaMatch ? (
                    <MatchStatusPanel match={arenaMatch} />
                  ) : (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-400">Reading your match from the chain…</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* The same classic screens, shown over the room while you choose a match */}
          {panelOpen && selectedAsset && selectedSide && (
            <div className="absolute inset-0 z-20 overflow-y-auto bg-zinc-950/95 backdrop-blur-sm">
              <button
                onClick={() => setScreen('chart')}
                className="sticky top-3 z-30 ml-auto mr-3 mt-3 block rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                Back to the room
              </button>
              {screen === 'inspect' && selectedMatch && (
                <MatchInspectScreen
                  market={selectedAsset}
                  selectedSide={selectedSide}
                  match={selectedMatch}
                  onContinueToEntry={handleContinueToEntry}
                  onBackToMatches={() => setScreen('matches')}
                  onOpenSpecs={() => setIsSpecsOpen(true)}
                />
              )}
              
            </div>
          )}
        </div>
      )}

      {!worldActive && (
      <main className="flex-1 pb-16">
        {live.status === 'loading' && (
          <LobbySkeleton />
        )}

        {live.status === 'error' && (
          <div className="mx-auto max-w-3xl px-4 py-16">
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center space-y-3">
              <div className="font-semibold text-rose-300">Market data is offline</div>
              <p className="text-xs text-zinc-400">
                Could not reach the dreamDEX testnet indexer: {live.error}. No prices are shown until it is back.
              </p>
              <button
                onClick={live.reload}
                className="rounded-lg bg-zinc-800 hover:bg-emerald-600 text-white px-4 py-2 text-xs font-semibold transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {live.status === 'ok' && screen === 'lobby' && (
          <GlobalLobby
            markets={live.markets}
            failed={live.failed}
            onSelectMarket={handleSelectMarket}
            onOpenSpecs={() => setIsSpecsOpen(true)}
          />
        )}

        {live.status === 'ok' && screen === 'chart' && selectedAsset && currentMarket && (
          <MarketChartScreen
            market={currentMarket}
            onSelectSide={handleSelectSide}
            onBackToLobby={handleReturnToLobby}
          />
        )}

        {live.status === 'ok' && screen === 'matches' && selectedAsset && selectedSide && (
          <MatchesListScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            matches={currentMatches}
            loading={!matchState.loaded}
            error={matchState.error}
            onSelectMatch={handleSelectMatch}
            onOpenNewMatch={handleOpenNewMatch}
            onBackToChart={() => setScreen('chart')}
          />
        )}

        {screen === 'inspect' && selectedAsset && selectedSide && selectedMatch && (
          <MatchInspectScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            match={selectedMatch}
            onContinueToEntry={handleContinueToEntry}
            onBackToMatches={() => setScreen('matches')}
            onOpenSpecs={() => setIsSpecsOpen(true)}
          />
        )}

        {screen === 'entry' && selectedAsset && selectedSide && selectedMatch && (
          <EntryConfirmScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            match={selectedMatch}
            wallet={wallet}
            pool={currentMarket?.pool ?? ''}
            maxLeverage={currentMarket?.maxLeverage}
            onEntered={handleEntered}
            onBackToInspect={() => setScreen('matches')}
          />
        )}

        {screen === 'done' && selectedAsset && selectedSide && selectedMatch && receipt && (
          <EntrySuccessScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            match={selectedMatch}
            receipt={receipt}
            onReturnToLobby={handleReturnToLobby}
            onInspectAnother={handleInspectAnother}
            onOpenSpecs={() => setIsSpecsOpen(true)}
          />
        )}
      </main>
      )}

      {/* Footer Notice */}
      {!worldActive && (
      <footer className="border-t border-zinc-900 bg-zinc-950/80 py-6 text-center text-xs text-zinc-500">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-400">Tug of War</span>
            <span>·</span>
            <span>{MATCH_SIZE}-Player Long vs Short game on dreamDEX perps</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-zinc-400">
            <span>$10 Fixed Stake</span>
            <span>·</span>
            <span>20% Loser Pool Rake</span>
            <span>·</span>
            <button
              onClick={() => setIsSpecsOpen(true)}
              className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4"
            >
              Algorithm Specifications
            </button>
          </div>
        </div>
      </footer>
      )}

      {/* Algorithm Specs & Production Safeguards Modal */}
      <AlgorithmSafeguardsModal
        isOpen={isSpecsOpen}
        onClose={() => setIsSpecsOpen(false)}
      />
    </div>
  );
}
