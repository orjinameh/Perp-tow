'use client';

import React, { useState } from 'react';
import {
  CryptoAsset,
  GameMatch,
  MarketQueueData,
  PositionSide,
  PrototypeScreen,
} from '@/lib/types';
import { INITIAL_MATCHES, SUPPORTED_MARKETS } from '@/lib/constants';
import { CORE_RULES } from '@/lib/payout';
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

export default function TugOfWarApp() {
  // Step 1 Initial UI state according to specification
  const [screen, setScreen] = useState<PrototypeScreen>('lobby');
  const [selectedAsset, setSelectedAsset] = useState<CryptoAsset | null>(null);
  const [selectedSide, setSelectedSide] = useState<PositionSide | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<GameMatch | null>(null);

  // Modal and Sound states
  const [isSpecsOpen, setIsSpecsOpen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Active market data based on selectedAsset
  const currentMarket: MarketQueueData =
    SUPPORTED_MARKETS.find((m) => m.ticker === selectedAsset) || SUPPORTED_MARKETS[0];

  // Matches for active asset
  const currentMatches: GameMatch[] = selectedAsset
    ? INITIAL_MATCHES[selectedAsset] || []
    : [];

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
    setSelectedMatch(match);
    setScreen('inspect');
  };

  // Step 5 -> Step 7: Continue to entry screen
  const handleContinueToEntry = (inspectedMatch: GameMatch) => {
    setSelectedMatch(inspectedMatch);
    setScreen('entry');
  };

  // Step 7 -> Step 8: Confirm demo entry
  const handleConfirmEntry = () => {
    setScreen('done');
  };

  // Step 8: Return to global lobby
  const handleReturnToLobby = () => {
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
      />

      {/* Step Flow Ribbon Indicator */}
      <FlowBreadcrumbs
        currentScreen={screen}
        selectedAsset={selectedAsset}
        selectedSide={selectedSide}
        selectedMatchId={selectedMatch?.id || null}
        onNavigate={handleBreadcrumbNavigate}
      />

      {/* Dynamic Screen Viewport */}
      <main className="flex-1 pb-16">
        {screen === 'lobby' && (
          <GlobalLobby
            onSelectMarket={handleSelectMarket}
            onOpenSpecs={() => setIsSpecsOpen(true)}
          />
        )}

        {screen === 'chart' && selectedAsset && (
          <MarketChartScreen
            market={currentMarket}
            onSelectSide={handleSelectSide}
            onBackToLobby={handleReturnToLobby}
          />
        )}

        {screen === 'matches' && selectedAsset && selectedSide && (
          <MatchesListScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            matches={currentMatches}
            onSelectMatch={handleSelectMatch}
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
            onConfirmEntry={handleConfirmEntry}
            onBackToInspect={() => setScreen('inspect')}
          />
        )}

        {screen === 'done' && selectedAsset && selectedSide && selectedMatch && (
          <EntrySuccessScreen
            market={selectedAsset}
            selectedSide={selectedSide}
            match={selectedMatch}
            onReturnToLobby={handleReturnToLobby}
            onInspectAnother={handleInspectAnother}
            onOpenSpecs={() => setIsSpecsOpen(true)}
          />
        )}
      </main>

      {/* Footer Notice */}
      <footer className="border-t border-zinc-900 bg-zinc-950/80 py-6 text-center text-xs text-zinc-500">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-400">Tug of War</span>
            <span>·</span>
            <span>20-Player Long vs Short Crypto Game Prototype</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-zinc-400">
            <span>$10 Fixed Stake</span>
            <span>·</span>
            <span>10% Loser Pool Rake</span>
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

      {/* Algorithm Specs & Production Safeguards Modal */}
      <AlgorithmSafeguardsModal
        isOpen={isSpecsOpen}
        onClose={() => setIsSpecsOpen(false)}
      />
    </div>
  );
}
