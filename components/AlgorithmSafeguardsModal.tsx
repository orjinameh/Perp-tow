'use client';

import { MATCH_SIZE } from '@/lib/gameTag';

import React, { useState } from 'react';
import {
  X,
  BookOpen,
  Calculator,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { calculatePayout, CORE_RULES } from '@/lib/payout';
import { soundFx } from '@/lib/sound';

interface AlgorithmSafeguardsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AlgorithmSafeguardsModal: React.FC<AlgorithmSafeguardsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'flow' | 'math' | 'limitations' | 'safeguards'>('flow');

  // Interactive sandbox for the formula tab (defaults to matched 10 Bulls vs 10 Bears)
  const [sandboxBulls, setSandboxBulls] = useState<number>(Math.floor(MATCH_SIZE / 2));
  const sandboxBears = Math.max(1, MATCH_SIZE - sandboxBulls);

  const sandboxBullsWin = calculatePayout({
    entryFee: 10,
    winnerCount: sandboxBulls,
    loserCount: sandboxBears,
    rake: 0.20,
  });

  const sandboxBearsWin = calculatePayout({
    entryFee: 10,
    winnerCount: sandboxBears,
    loserCount: sandboxBulls,
    rake: 0.20,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-zinc-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-4xl rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-zinc-950/50">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Tug of War: Prototype Algorithm Specification
              </h2>
              <p className="text-xs text-zinc-400">
                Full documentation of rules, 8-step flow, math formulas, and production safeguards
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playClick();
              onClose();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 border-b border-zinc-800/80 px-6 py-2.5 bg-zinc-950/30 overflow-x-auto text-xs">
          <button
            onClick={() => {
              soundFx.playClick();
              setActiveTab('flow');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'flow' ? 'bg-zinc-800 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            1. Player Flow (8 Steps)
          </button>
          <button
            onClick={() => {
              soundFx.playClick();
              setActiveTab('math');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'math' ? 'bg-zinc-800 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            2. Payout Math & Sandbox
          </button>
          <button
            onClick={() => {
              soundFx.playClick();
              setActiveTab('limitations');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'limitations' ? 'bg-zinc-800 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            3. Prototype vs Production
          </button>
          <button
            onClick={() => {
              soundFx.playClick();
              setActiveTab('safeguards');
            }}
            className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'safeguards' ? 'bg-zinc-800 text-emerald-400 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            4. Production Safeguards
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6 text-xs text-zinc-300">
          {activeTab === 'flow' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                Complete 8-Step Algorithmic Player Flow
              </h3>
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 1 — Initialize Application (Global Lobby)</span>
                  <p className="text-zinc-400 mt-1">
                    Displays supported markets (every live dreamDEX perp market) with real prices, 24h change, and global waiting queues (Bulls/Bears counts searching for matches).
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 2 — Select Market</span>
                  <p className="text-zinc-400 mt-1">
                    Stores chosen asset, displays price & interactive chart. User inspects technicals before making their directional decision.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 3 — Choose Bulls or Bears</span>
                  <p className="text-zinc-400 mt-1">
                    Bulls = Long position (expects price to rise); Bears = Short position (expects price to fall). Selected side is recorded.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 4 — Display Available Matches</span>
                  <p className="text-zinc-400 mt-1">
                    Calculates total players <code className="text-emerald-400 font-mono">N = B + S</code> and remaining slots <code className="text-emerald-400 font-mono">20 - N</code> for each match instance.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 5 — Inspect a Match & Capacity Check</span>
                  <p className="text-zinc-400 mt-1">
                    If the roster is not full: displays composition & remaining slots, and <strong>hides payout estimates</strong>. If the roster is full: activates payout calculator.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 6 — Calculate Payout When Full (20 Players)</span>
                  <p className="text-zinc-400 mt-1">
                    Takes entry fee $e = $10$, rake rate $r = 20\%$, winners $W$, losers $L$. Payout per winner is <code className="text-emerald-400 font-mono">P = e + (1 - r)eL / W</code>.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 7 — Continue to Entry Screen</span>
                  <p className="text-zinc-400 mt-1">
                    Reviews market, position, match ID, entry fee, and locked payout estimate (if full).
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/40">
                  <span className="font-bold text-white">Step 8 — Demo Confirmation</span>
                  <p className="text-zinc-400 mt-1">
                    Confirms local prototype entry, issues receipt ticket, and lets the player return to the global lobby.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'math' && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-2">
                <h4 className="font-bold text-emerald-400 text-sm">Step 6 Mathematical Formulas</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-zinc-300 font-mono">
                  <div className="bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Losing Pool</span>
                    <code>Losing Pool = e × L</code>
                  </div>
                  <div className="bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Platform Rake (20%)</span>
                    <code>Rake = r × e × L</code>
                  </div>
                  <div className="bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Redistributed Pool</span>
                    <code>Redistributed = (1 - r) × e × L</code>
                  </div>
                  <div className="bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Winning Payout per Player</span>
                    <code>P = e + (1 - r)·e·L / W</code>
                  </div>
                </div>
              </div>

              {/* Interactive Math Sandbox */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-950 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-white text-sm">Interactive Payout Sandbox (20 Players Total)</h4>
                  <span className="text-xs font-mono text-zinc-400">
                    {sandboxBulls} Bulls vs {sandboxBears} Bears
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 flex justify-between">
                    <span>Adjust Team Composition:</span>
                    <span>{sandboxBulls} Bulls / {sandboxBears} Bears</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max={MATCH_SIZE - 1}
                    value={sandboxBulls}
                    onChange={(e) => setSandboxBulls(parseInt(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-2">
                  <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20">
                    <div className="font-bold text-emerald-400">If Bulls Win ({sandboxBulls} winners):</div>
                    <div className="mt-1 space-y-0.5 text-[11px]">
                      <div>Losing Pool: <span className="font-mono">${sandboxBullsWin?.losingPool}</span></div>
                      <div>Rake (20%): <span className="font-mono">-${sandboxBullsWin?.platformRake.toFixed(2)}</span></div>
                      <div className="font-bold text-white pt-1">
                        Payout: <span className="text-emerald-400 font-mono">${sandboxBullsWin?.payoutPerWinner.toFixed(2)}</span>
                      </div>
                      <div className="text-zinc-400">
                        Net Profit: <span className="font-mono">+${sandboxBullsWin?.netProfitPerWinner.toFixed(2)} (+{sandboxBullsWin?.roiPercentage.toFixed(0)}%)</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-950/20">
                    <div className="font-bold text-rose-400">If Bears Win ({sandboxBears} winners):</div>
                    <div className="mt-1 space-y-0.5 text-[11px]">
                      <div>Losing Pool: <span className="font-mono">${sandboxBearsWin?.losingPool}</span></div>
                      <div>Rake (20%): <span className="font-mono">-${sandboxBearsWin?.platformRake.toFixed(2)}</span></div>
                      <div className="font-bold text-white pt-1">
                        Payout: <span className="text-rose-400 font-mono">${sandboxBearsWin?.payoutPerWinner.toFixed(2)}</span>
                      </div>
                      <div className="text-zinc-400">
                        Net Profit: <span className="font-mono">+${sandboxBearsWin?.netProfitPerWinner.toFixed(2)} (+{sandboxBearsWin?.roiPercentage.toFixed(0)}%)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'limitations' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                Section 4: Current Prototype vs Production Requirements
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border border-zinc-800 rounded-xl overflow-hidden">
                  <thead className="bg-zinc-950 text-zinc-400 uppercase font-mono text-[10px]">
                    <tr>
                      <th className="p-3">Area</th>
                      <th className="p-3">Current Prototype</th>
                      <th className="p-3">Production Requirement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Global lobby</td>
                      <td className="p-3 text-zinc-400">Hardcoded market counts</td>
                      <td className="p-3 text-emerald-400">Live, authoritative queue counts</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Market prices</td>
                      <td className="p-3 text-zinc-400">Live dreamDEX data</td>
                      <td className="p-3 text-emerald-400">Live price feed with timestamps</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Match list</td>
                      <td className="p-3 text-zinc-400">Hardcoded examples</td>
                      <td className="p-3 text-emerald-400">Persistent matches & real membership</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Team composition</td>
                      <td className="p-3 text-zinc-400">Local UI state</td>
                      <td className="p-3 text-emerald-400">Backend-authoritative player counts</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Match capacity</td>
                      <td className="p-3 text-zinc-400">Displayed as 20 players</td>
                      <td className="p-3 text-emerald-400">Atomic enforcement of 20-player limit</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Payout visibility</td>
                      <td className="p-3 text-zinc-400">Hidden below 20 players</td>
                      <td className="p-3 text-emerald-400">Backend also refuses premature quotes</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Entry confirmation</td>
                      <td className="p-3 text-zinc-400">Demo state change</td>
                      <td className="p-3 text-emerald-400">Idempotent entry & confirmed result</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Funds</td>
                      <td className="p-3 text-zinc-400">No real funds</td>
                      <td className="p-3 text-emerald-400">Actual payment, escrow & settlement</td>
                    </tr>
                    <tr className="hover:bg-zinc-800/30">
                      <td className="p-3 font-semibold text-white">Match outcome</td>
                      <td className="p-3 text-zinc-400">Not implemented</td>
                      <td className="p-3 text-emerald-400">Defined price oracle & timestamps</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'safeguards' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider text-emerald-400">
                Section 5: Production Safeguards Required Before Real-Money Play
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Prevent Overfilling</span>
                  </div>
                  <p className="text-zinc-400">
                    Two players must not both claim the 20th slot. Match admission needs an atomic capacity check with mutex or transaction locking.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Prevent Duplicate Entries</span>
                  </div>
                  <p className="text-zinc-400">
                    Retrying an entry request must use idempotent tokens to prevent charging or registering the same player twice.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Define the Entry Lock</span>
                  </div>
                  <p className="text-zinc-400">
                    The system must establish the exact instant the roster becomes immutable and what happens if a downstream transaction fails.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Freeze Payout Inputs</span>
                  </div>
                  <p className="text-zinc-400">
                    Calculate payouts strictly using final locked team counts ($W$ and $L$), never counts read at different times.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Define Match Outcomes</span>
                  </div>
                  <p className="text-zinc-400">
                    Specify the cryptographic price oracle (Chainlink/Pyth), opening & closing timestamps, and explicit tie handling.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 space-y-1">
                  <div className="flex items-center gap-2 font-bold text-white">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Handle Unmatched Demand</span>
                  </div>
                  <p className="text-zinc-400">
                    If a match cannot fill within a defined window, players must receive clean refunds or voluntary migration—never silent reassignment.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-zinc-800 px-6 py-4 bg-zinc-950/50 flex items-center justify-between">
          <span className="text-xs text-zinc-500 font-mono">
            Tug of War Prototype Spec v1.0
          </span>
          <button
            onClick={() => {
              soundFx.playClick();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-xs transition-colors"
          >
            Close Documentation
          </button>
        </div>
      </div>
    </div>
  );
};
