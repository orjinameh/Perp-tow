'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { GameWallet } from '@/lib/useGameWallet';

// The trading SDK is loaded only when a button needs it, so it never runs during server rendering.
const loadTrading = () => import('@/lib/trading');

export const WalletPanel: React.FC<{ wallet: GameWallet }> = ({ wallet }) => {
  const [stt, setStt] = useState<string | null>(null);
  const [usdso, setUsdso] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [ownerText, setOwnerText] = useState('');

  const refreshBalance = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const t = await loadTrading();
      setStt(Number(await t.getSttBalance(wallet.address)).toFixed(3));
      setUsdso(Number(await t.getUsdsoBalance(wallet.address)).toFixed(2));
    } catch {
      setStt(null);
      setUsdso(null);
    }
  }, [wallet.address]);

  useEffect(() => {
    setStt(null);
    refreshBalance();
    const id = setInterval(refreshBalance, 20_000);
    return () => clearInterval(id);
  }, [refreshBalance]);

  if (!wallet.ready) return null;

  const claim = async () => {
    if (!wallet.key || !wallet.address) return;
    setStatus(null);
    if (stt !== null && Number(stt) === 0) {
      setStatus('This wallet has 0 STT, so it cannot pay gas for the claim. Send it some STT first (tap the address to copy it), then press Refresh.');
      return;
    }
    setBusy(true);
    try {
      const t = await loadTrading();
      setStatus(await t.claimPaperCredit(wallet.key, wallet.address));
    } catch (e) {
      setStatus(`Claim failed: ${e instanceof Error ? e.message.slice(0, 700) : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    try {
      wallet.importKey(importText);
      setImportText('');
      setImportOpen(false);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const saveOwner = () => {
    try {
      wallet.setOwner(ownerText);
      setOwnerText('');
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const checkLinked = async () => {
    if (!wallet.key || !wallet.owner) return;
    setBusy(true);
    setStatus(null);
    try {
      const t = await loadTrading();
      setStatus(await t.checkLink(wallet.key, wallet.owner));
    } catch (e) {
      setStatus(`Link check failed: ${e instanceof Error ? e.message.slice(0, 400) : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (wallet.address && navigator?.clipboard) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const btn = 'rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40';

  return (
    <div className="border-b border-zinc-900 bg-zinc-950/90">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-col gap-2 text-xs text-zinc-400">
        {!wallet.address ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <strong className="text-zinc-200">Game wallet:</strong> entering a match places a real dreamDEX testnet order, so you need a
              testnet wallet.
            </span>
            <button className={btn} onClick={wallet.create}>Create game wallet</button>
            <button className={btn} onClick={() => setImportOpen((o) => !o)}>Import a testnet key</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button onClick={copy} className="font-mono text-zinc-200 hover:text-white" title="Copy address">
              {copied ? 'Copied!' : `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`}
            </button>
            <span>
              Gas: <span className="font-mono text-zinc-200">{stt ?? '...'} STT</span>
            </span>
            <span>
              USDso: <span className="font-mono text-zinc-200">{usdso ?? '...'}</span>
            </span>
            {!wallet.owner && (
              <button className={btn} onClick={claim} disabled={busy}>
                {busy ? 'Working...' : 'Claim paper USDso'}
              </button>
            )}
            <button className={btn} onClick={refreshBalance}>Refresh</button>
            <button
              className="text-zinc-500 hover:text-rose-300 underline underline-offset-2"
              onClick={() => {
                if (window.confirm('Forget this game wallet in this browser? Its key is not saved anywhere else.')) wallet.forget();
              }}
            >
              Forget wallet
            </button>
          </div>
        )}

        {wallet.address && (
          <div className="flex flex-wrap items-center gap-2">
            {wallet.owner ? (
              <>
                <span>
                  Trading for your dreamDEX account{' '}
                  <span className="font-mono text-zinc-200">{wallet.owner.slice(0, 8)}...{wallet.owner.slice(-6)}</span>
                </span>
                <button className={btn} onClick={checkLinked} disabled={busy}>Check link</button>
                <button className="text-zinc-500 hover:text-zinc-200 underline underline-offset-2" onClick={() => wallet.setOwner('')}>
                  Use the game wallet itself
                </button>
              </>
            ) : (
              <>
                <span>Or trade for your dreamDEX account (uses its margin and paper credit):</span>
                <input
                  value={ownerText}
                  onChange={(e) => setOwnerText(e.target.value)}
                  placeholder="0x... your dreamDEX account address"
                  className="w-full sm:w-80 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
                <button className={btn} onClick={saveOwner}>Use this account</button>
              </>
            )}
          </div>
        )}

        {importOpen && !wallet.address && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="0x... testnet private key"
              className="w-full sm:w-96 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
            <button className={btn} onClick={doImport}>Use this key</button>
          </div>
        )}

        <div className="text-[11px] text-zinc-500">
          Testnet only. The key stays in this browser. {wallet.address ? (wallet.owner ? 'In the dreamDEX app, link the game wallet address above as a bot (wallet > Link a bot > Perps). It only signs and pays gas; the account keeps the funds.' : 'Send STT for gas to the address above, then claim the paper USDso.') : 'Never import a key that holds real money.'}
        </div>
        {status && <div className="text-[11px] text-amber-300">{status}</div>}
      </div>
    </div>
  );
};
