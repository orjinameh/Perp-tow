'use client';

import { MATCH_SIZE } from '@/lib/gameTag';

import React from 'react';
import { Swords, Volume2, VolumeX, BookOpen, RotateCcw } from 'lucide-react';
import { PrototypeScreen } from '@/lib/types';
import { soundFx } from '@/lib/sound';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Box, History, Trophy } from 'lucide-react';

interface NavbarProps {
  currentScreen: PrototypeScreen;
  onNavigateHome: () => void;
  onOpenSpecs: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  view?: 'world' | 'classic';
  onToggleView?: () => void;
  onOpenLeaders?: () => void;
  onOpenHistory?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentScreen,
  onNavigateHome,
  onOpenSpecs,
  isMuted,
  onToggleMute,
  view,
  onToggleView,
  onOpenLeaders,
  onOpenHistory,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6">
        {/* Zone 1: Single text element wordmark */}
        <button
          onClick={() => {
            soundFx.playClick();
            onNavigateHome();
          }}
          className="group flex items-center gap-2.5 text-left text-lg font-bold tracking-tight text-white transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-emerald-500 to-rose-500 p-0.5 shadow-sm">
            <div className="flex h-full w-full items-center justify-center rounded-[6px] bg-zinc-950">
              <Swords className="h-4 w-4 text-emerald-400 group-hover:rotate-12 transition-transform" />
            </div>
          </div>
          <span>Tug of War</span>
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-400">
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigateHome();
            }}
            className={`transition-colors whitespace-nowrap shrink-0 hover:text-white ${
              currentScreen === 'lobby' ? 'text-emerald-400 font-semibold' : ''
            }`}
          >
            Lobby
          </button>
          <button
            onClick={onOpenSpecs}
            className="transition-colors whitespace-nowrap shrink-0 hover:text-white"
          >
            Rules & Math
          </button>
          <button
            onClick={onOpenSpecs}
            className="transition-colors whitespace-nowrap shrink-0 hover:text-white"
          >
            Safeguards
          </button>
          <span className="text-zinc-600">·</span>
          <span className="text-xs text-zinc-500 tabular-nums">{MATCH_SIZE} Players · $10 Entry · your leverage · 20% Rake</span>
        </nav>

        {/* Zone 3: 1 primary action & controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          {onOpenHistory && (
            <button
              onClick={onOpenHistory}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
            >
              <History className="h-4 w-4 text-sky-300" />
              <span className="hidden sm:inline">History</span>
            </button>
          )}
          {onOpenLeaders && (
            <button
              onClick={onOpenLeaders}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
            >
              <Trophy className="h-4 w-4 text-amber-400" />
              <span className="hidden sm:inline">Leaders</span>
            </button>
          )}
          {onToggleView && (
            <button
              onClick={onToggleView}
              aria-label="Switch between the 3D world and the classic screens"
              title={view === 'world' ? 'Switch to the classic screens' : 'Switch to the 3D world'}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
            >
              <Box className="h-4 w-4" />
              <span className="hidden sm:inline">{view === 'world' ? '3D' : 'Classic'}</span>
            </button>
          )}
          <ThemeToggle />
          <button
            onClick={onToggleMute}
            aria-label={isMuted ? 'Unmute sounds' : 'Mute sounds'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
            title={isMuted ? 'Sound effects disabled' : 'Sound effects enabled'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>

          <button
            onClick={() => {
              soundFx.playClick();
              onOpenSpecs();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white whitespace-nowrap shrink-0"
          >
            <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
            <span className="hidden sm:inline">Algorithm Specs</span>
            <span className="sm:hidden">Specs</span>
          </button>

          {currentScreen !== 'lobby' && (
            <button
              onClick={() => {
                soundFx.playClick();
                onNavigateHome();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 sm:px-3 py-2 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20 whitespace-nowrap shrink-0"
              title="Return to Global Lobby"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Back to Lobby</span>
              <span className="sm:hidden">Lobby</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
