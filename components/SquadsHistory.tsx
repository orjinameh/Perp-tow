'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { GameWallet } from '@/lib/useGameWallet';
import { ACTIVITY_EVENT, Activity, readActivity } from '@/lib/activity';
import { TEAM_NAME, SquadMatch, claimSquad, loadSquadMatches, nextSquadNumber, squadClaimed } from '@/lib/squads';
import { Spinner } from '@/components/ProgressModal';

const EXPLORER = 'https://explorer.testnet.somnia.network/tokyo/tx/';
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tone: Record<Activity['status'], string> = { confirmed: 'text-emerald-300', failed: 'text-rose-300', 'not sent': 'text-amber-300' };
const label: Record<Activity['status'], string> = { confirmed: 'confirmed', failed: 'failed on chain', 'not sent': 'not sent' };

interface Row { ticker: string; number: number; id: string; team: 0 | 1 | 2; text: string; tone: string; claimable: boolean; claimed: boolean }

function describe(m: SquadMatch, me: string, claimed: boolean): Row {
  const mine = m.players.find((p) => p.address.toLowerCase() === me.toLowerCase());
  const team = (mine?.team ?? 0) as 0 | 1 | 2;
  let text = 'In progress';
  let t = 'text-sky-300';
  let claimable = false;
  if (m.phase === 'filling' || m.phase === 'confirming' || m.phase === 'finishable') { text = 'Waiting for the lobby to finish'; t = 'text-amber-300'; }
  else if (m.phase === 'trading') { text = 'Trading now'; t = 'text-sky-300'; }
  else if (m.phase === 'ended') { text = 'Time is up: waiting to be settled'; t = 'text-amber-300'; }
  else if (m.phase === 'cancelled') { text = 'Cancelled: stake and bankroll refundable'; t = 'text-zinc-300'; claimable = true; }
  else if (m.phase === 'settled') {
    claimable = true;
    if (m.result === 3) { text = 'Tie: refund'; t = 'text-zinc-300'; }
    else if (team && m.result === team) { text = `Your team (${TEAM_NAME[team]}) won`; t = 'text-emerald-300'; }
    else { text = `${TEAM_NAME[m.result as 1 | 2]} won, your team lost`; t = 'text-rose-300'; }
  }
  return { ticker: m.ticker, number: m.number, id: m.id, team, text, tone: t, claimable, claimed };
}

/** What this game wallet did on the chain, and how its matches ended. Saved in this browser; the chain stays the record of money. */
export const SquadsHistory: React.FC<{ wallet: GameWallet; tickers?: string[]; onClose: () => void }> = ({ wallet, tickers = [], onClose }) => {
  const [tab, setTab] = useState<'activity' | 'matches'>('activity');
  const [items, setItems] = useState<Activity[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const signer = wallet.signer;

  const reloadActivity = useCallback(() => setItems(readActivity(signer)), [signer]);
  useEffect(() => {
    reloadActivity();
    window.addEventListener(ACTIVITY_EVENT, reloadActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, reloadActivity);
  }, [reloadActivity]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadMatches = useCallback(async () => {
    if (!wallet.address) return;
    setLoading(true);
    setError(null);
    try {
      // Read the chain, not just this browser's log: every market that has had a match is scanned for this player's seats,
      // so matches played earlier (or from another browser) show up too.
      const names = new Set<string>(tickers);
      readActivity(signer).forEach((a) => { if (a.match) names.add(a.match.ticker); });
      const list = [...names];
      const out: Row[] = [];
      let failed = 0;
      for (let i = 0; i < list.length; i += 6) {
        await Promise.all(list.slice(i, i + 6).map(async (ticker) => {
          try {
            if ((await nextSquadNumber(ticker)) <= 1) return; // no match was ever opened on this market
            const all = await loadSquadMatches(ticker);
            for (const m of all) {
              if (!m.players.some((p) => p.address.toLowerCase() === wallet.address!.toLowerCase())) continue;
              const claimed = await squadClaimed(ticker, m.number, wallet.address as `0x${string}`).catch(() => false);
              out.push(describe(m, wallet.address!, claimed));
            }
          } catch { failed += 1; }
        }));
      }
      out.sort((a, b) => b.number - a.number);
      setRows(out);
      if (failed > 0) setError(`${failed} market${failed === 1 ? '' : 's'} could not be read just now, so the list may be incomplete. Press Refresh to try again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet.address, signer, tickers.join(',')]);

  useEffect(() => {
    if (tab !== 'matches') return;
    void loadMatches();
    const t = setInterval(() => void loadMatches(), 15000); // keep results, claims and new matches fresh while this is open
    const f = () => void loadMatches();
    window.addEventListener(ACTIVITY_EVENT, f);
    return () => { clearInterval(t); window.removeEventListener(ACTIVITY_EVENT, f); };
  }, [tab, loadMatches]);
  // a wallet with no saved transactions (older play, or another browser) starts on its matches, which come from the chain
  const firstLook = React.useRef(true);
  useEffect(() => {
    if (firstLook.current && signer) { firstLook.current = false; if (readActivity(signer).length === 0) setTab('matches'); }
  }, [signer]);

  const claim = async (r: Row) => {
    if (!wallet.key || !wallet.address) { setNote('Unlock your wallet to claim.'); return; }
    setActing(r.id);
    setNote(null);
    try {
      await claimSquad(wallet.key, r.ticker, r.number, wallet.address as `0x${string}`);
      setNote(`${r.id}: paid out.`);
      void loadMatches();
    } catch (e) {
      setNote(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto overscroll-contain bg-zinc-950/95 backdrop-blur-sm" data-world-ui style={{ touchAction: 'pan-y' }}>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 bg-zinc-950/95 px-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-white">History</h2>
            <p className="text-xs text-zinc-400">Everything this game wallet sent {signer ? `(${signer.slice(0, 6)}…${signer.slice(-4)})` : ''}. Saved in this browser.</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800">Close</button>
        </div>

        {!wallet.address && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">Create or import a game wallet first.</div>}

        <div className="flex gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 text-xs">
          {(['activity', 'matches'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === t ? 'bg-zinc-800 font-semibold text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {t === 'activity' ? `Transactions (${items.length})` : `My matches${rows ? ` (${rows.length})` : ''}`}
            </button>
          ))}
        </div>

        {tab === 'activity' && (
          <div className="space-y-2">
            {items.length === 0 && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">Nothing recorded yet. Transactions sent from this browser from now on (seats, trades, claims, transfers, deposits) appear here. Earlier ones are not saved, but your past matches are listed under My matches, read from the chain.</div>}
            {items.map((a) => (
              <div key={a.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{a.title}</span>
                  <span className={`font-semibold ${tone[a.status]}`}>{label[a.status]}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-zinc-500">
                  <span>{when(a.t)}</span>
                  {a.hash && <a href={EXPLORER + a.hash} target="_blank" rel="noreferrer" className="text-sky-300 underline underline-offset-2">transaction {a.hash.slice(0, 8)}…</a>}
                </div>
                {a.detail && <div className="mt-1 break-words text-zinc-400">{a.detail}</div>}
              </div>
            ))}
          </div>
        )}

        {tab === 'matches' && (
          <div className="space-y-2">
            {loading && <div className="flex items-center gap-2 text-xs text-zinc-400"><Spinner className="h-3 w-3" />Reading your matches from the chain…</div>}
            {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-xs text-rose-200">Could not read your matches: {error}</div>}
            {note && <div className="break-words rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-200">{note}</div>}
            {rows && rows.length === 0 && !loading && <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">No matches found for this wallet. Take a seat in a room and it will show up here.</div>}
            {rows?.map((r) => (
              <div key={r.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs sm:grid-cols-4">
                <div className="font-bold text-white">{r.id}</div>
                <div className={r.team === 1 ? 'text-emerald-300' : r.team === 2 ? 'text-rose-300' : 'text-zinc-400'}>{r.team ? TEAM_NAME[r.team] : 'No team'}</div>
                <div className={`font-semibold ${r.tone}`}>{r.text}</div>
                <div className="text-right">
                  {r.claimable && !r.claimed && (
                    <button onClick={() => claim(r)} disabled={acting !== null} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      {acting === r.id ? 'Sending…' : 'Claim'}
                    </button>
                  )}
                  {r.claimed && <span className="text-zinc-500">claimed</span>}
                </div>
              </div>
            ))}
            <button onClick={loadMatches} disabled={loading} className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50">Refresh</button>
          </div>
        )}
      </div>
    </div>
  );
};
