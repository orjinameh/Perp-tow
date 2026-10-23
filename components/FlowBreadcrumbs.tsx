'use client';

import React from 'react';
import { PrototypeScreen } from '@/lib/types';
import { ChevronRight } from 'lucide-react';
import { soundFx } from '@/lib/sound';

interface FlowBreadcrumbsProps {
  currentScreen: PrototypeScreen;
  selectedAsset: string | null;
  selectedSide: 'bulls' | 'bears' | null;
  selectedMatchId: string | null;
  onNavigate: (screen: PrototypeScreen) => void;
}

export const FlowBreadcrumbs: React.FC<FlowBreadcrumbsProps> = ({
  currentScreen,
  selectedAsset,
  selectedSide,
  selectedMatchId,
  onNavigate,
}) => {
  const steps: { screen: PrototypeScreen; label: string; activeIf: boolean; enabled: boolean }[] = [
    {
      screen: 'lobby',
      label: '1. Global Lobby',
      activeIf: currentScreen === 'lobby',
      enabled: true,
    },
    {
      screen: 'chart',
      label: selectedAsset ? `2. ${selectedAsset} Chart` : '2. Market Chart',
      activeIf: currentScreen === 'chart',
      enabled: !!selectedAsset,
    },
    {
      screen: 'matches',
      label: selectedSide
        ? `3. Matches (${selectedSide === 'bulls' ? 'Bulls / Long' : 'Bears / Short'})`
        : '3. Choose Side & Matches',
      activeIf: currentScreen === 'matches',
      enabled: !!selectedAsset && !!selectedSide,
    },
    {
      screen: 'inspect',
      label: selectedMatchId ? `4. Inspect ${selectedMatchId}` : '4. Inspect Match',
      activeIf: currentScreen === 'inspect',
      enabled: !!selectedMatchId,
    },
    {
      screen: 'entry',
      label: '5. Entry Summary',
      activeIf: currentScreen === 'entry',
      enabled: !!selectedMatchId && !!selectedSide,
    },
    {
      screen: 'done',
      label: '6. Confirmation',
      activeIf: currentScreen === 'done',
      enabled: currentScreen === 'done',
    },
  ];

  return (
    <div className="w-full border-b border-zinc-800/60 bg-zinc-950/60 py-2.5 overflow-x-auto scrollbar-none">
      <div className="mx-auto flex max-w-7xl items-center gap-1.5 px-4 text-xs sm:px-6">
        <span className="text-zinc-500 font-medium whitespace-nowrap mr-1">Algorithm Flow:</span>
        {steps.map((step, idx) => {
          const isCurrent = step.activeIf;
          const isClickable = step.enabled && !isCurrent;

          return (
            <React.Fragment key={step.screen}>
              {idx > 0 && <ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" />}
              <button
                disabled={!isClickable}
                onClick={() => {
                  if (isClickable) {
                    soundFx.playClick();
                    onNavigate(step.screen);
                  }
                }}
                className={`whitespace-nowrap px-2 py-1 rounded transition-colors text-left ${
                  isCurrent
                    ? 'bg-zinc-800 text-emerald-400 font-semibold ring-1 ring-zinc-700'
                    : isClickable
                    ? 'text-zinc-400 hover:text-white hover:bg-zinc-900 cursor-pointer'
                    : 'text-zinc-600 cursor-not-allowed opacity-60'
                }`}
              >
                {step.label}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
