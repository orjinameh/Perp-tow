'use client';

import { Spinner } from '@/components/ProgressModal';
import { BotSetup } from '@/components/BotSetup';
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
  const [closeTicker, setCloseTicker] = useState('BTC');
  const [mainOpen, setMainOpen] = useState(false);
  const [mainText, setMainText] = useState('');
  const [keyShown, setKeyShown] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null); // the key, shown for a short time after the PIN check
  const [revealPin, setRevealPin] = useState('');
  const [revealErr, setRevealErr] = useState<string | null>(null);
  const [sendPin, setSendPin] = useState('');
  const [setup, setSetup] = useState<'create' | 'import' | null>(null);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [unlockPin, setUnlockPin] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTok, setSendTok] = useState<'STT' | 'USDso'>('USDso');
  const [sendTo, setSendTo] = useState('');
  const [sendAmt, setSendAmt] = useState('');
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sendDone, setSendDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const t = await loadTrading();
      setStt(Number(await t.getSttBalance((wallet.signer ?? wallet.address) as `0x${string}`)).toFixed(3)); // gas is paid by the game wallet itself
      setUsdso(Number(await t.getUsdsoBalance((wallet.signer ?? wallet.address) as `0x${string}`)).toFixed(2)); // stakes are paid from the game wallet
    } catch {
      setStt(null);
      setUsdso(null);
    }
  }, [wallet.address, wallet.signer]);

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

  const [amount, setAmount] = useState('');
  const deposit = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setStatus(null);
    try {
      const t = await loadTrading();
      setStatus(await t.depositAllToMargin(wallet.key, wallet.address, amount.trim() ? Number(amount) : undefined));
      refreshBalance();
    } catch (e) {
      setStatus(`Deposit failed: ${e instanceof Error ? e.message.slice(0, 700) : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const closePos = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setStatus(null);
    try {
      const t = await loadTrading();
      setStatus(await t.closeMyPosition(wallet.key, wallet.address, closeTicker.trim().toUpperCase()));
      refreshBalance();
    } catch (e) {
      setStatus(`Close failed: ${e instanceof Error ? e.message.slice(0, 700) : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!wallet.key || !wallet.address) return;
    setBusy(true);
    setStatus(null);
    try {
      const t = await loadTrading();
      setStatus(await t.withdrawAllFromMargin(wallet.key, wallet.address));
      refreshBalance();
    } catch (e) {
      setStatus(`Withdraw failed: ${e instanceof Error ? e.message.slice(0, 700) : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!wallet.key) return;
    setSendErr(null);
    setSendDone(null);
    setSending(true);
    try {
      if (wallet.protectedKey && !(await wallet.verifyPin(sendPin))) throw new Error('Wrong PIN.');
      const t = await import('@/lib/transfer');
      const hash = await t.sendFunds(wallet.key, sendTok, sendTo, sendAmt);
      setSendDone(`Sent ${sendAmt} ${sendTok}. Transaction ${hash.slice(0, 10)}…${hash.slice(-6)}`);
      setSendAmt('');
      setSendPin('');
      refreshBalance();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const showKey = async () => {
    setRevealErr(null);
    try {
      if (!wallet.key) throw new Error('Unlock the wallet first.');
      if (!wallet.protectedKey) throw new Error('Protect the wallet with a PIN first (see the yellow box above).');
      if (!(await wallet.verifyPin(revealPin))) throw new Error('Wrong PIN.');
      setRevealPin('');
      setRevealed(wallet.key);
      setTimeout(() => { setRevealed(null); setKeyShown(false); }, 20_000); // the key hides itself
    } catch (e) {
      setRevealErr(e instanceof Error ? e.message : String(e));
    }
  };
  const copyKey = () => {
    if (!revealed) return;
    navigator.clipboard?.writeText(revealed).then(() => { setKeyCopied(true); setTimeout(() => setKeyCopied(false), 1500); }).catch(() => setStatus('Could not copy automatically. Select the key text and copy it by hand.'));
  };

  const doSetup = async () => {
    setPinErr(null);
    if (pin1 !== pin2) { setPinErr('The two PINs are not the same.'); return; }
    setPinBusy(true);
    try {
      if (setup === 'import') await wallet.importKey(importText, pin1);
      else await wallet.create(pin1);
      setImportText(''); setPin1(''); setPin2(''); setSetup(null); setImportOpen(false); setStatus(null);
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPinBusy(false);
    }
  };
  const doUnlock = async () => {
    setPinErr(null);
    setPinBusy(true);
    try {
      await wallet.unlock(unlockPin);
      setUnlockPin('');
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPinBusy(false);
    }
  };
  const doProtect = async () => {
    setPinErr(null);
    if (pin1 !== pin2) { setPinErr('The two PINs are not the same.'); return; }
    setPinBusy(true);
    try {
      await wallet.protect(pin1);
      setPin1(''); setPin2('');
    } catch (e) {
      setPinErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPinBusy(false);
    }
  };

  const doLink = () => {
    try {
      wallet.linkMain(mainText);
      setMainText('');
      setMainOpen(false);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = () => {
    const mine = wallet.signer ?? wallet.address;
    if (mine && navigator?.clipboard) {
      navigator.clipboard.writeText(mine);
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
            <button className={btn} onClick={() => { setSetup('create'); setPinErr(null); }}>Create game wallet</button>
            <button className={btn} onClick={() => { setSetup('import'); setPinErr(null); }}>Import a testnet key</button>
          </div>
        ) : wallet.locked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-zinc-200">{wallet.address?.slice(0, 8)}...{wallet.address?.slice(-6)}</span>
            <span className="text-amber-300">Locked</span>
            <input
              type="password"
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doUnlock(); }}
              placeholder="Your PIN"
              aria-label="Wallet PIN"
              className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
            <button className={btn} onClick={doUnlock} disabled={pinBusy}>{pinBusy ? 'Unlocking…' : 'Unlock'}</button>
            <button
              className="text-zinc-500 hover:text-rose-300 underline underline-offset-2"
              onClick={() => { if (window.confirm('Forget this game wallet in this browser? Without the key or the PIN it cannot be recovered.')) wallet.forget(); }}
            >
              Forget wallet
            </button>
            {pinErr && <span className="text-rose-300">{pinErr}</span>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button onClick={copy} className="font-mono text-zinc-200 hover:text-white" title="Copy address">
              {copied ? 'Copied!' : wallet.linked ? `Bot ${wallet.signer?.slice(0, 8)}...${wallet.signer?.slice(-6)}` : `${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`}
            </button>
            {wallet.linked && (
              <span>
                Trading for main wallet <span className="font-mono text-zinc-200">{wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}</span>
              </span>
            )}
            <span>
              Gas: <span className="font-mono text-zinc-200">{stt ?? '...'} STT</span>
            </span>
            <span>
              {wallet.linked ? 'Bot USDso (stakes)' : 'USDso'}: <span className="font-mono text-zinc-200">{usdso ?? '...'}</span>
            </span>
            {!wallet.linked && (
              <>
                <input className="w-20 rounded border border-zinc-700 bg-transparent px-2 py-1 text-xs" placeholder="all" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label="Amount to deposit in USDso, empty for all" />
                <button className={btn} onClick={deposit} disabled={busy}>
                  {busy ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Working…</span> : 'Deposit USDso to margin'}
                </button>
                <button className={btn} onClick={claim} disabled={busy}>
                  Claim paper USDso
                </button>
              </>
            )}
            <span className="inline-flex items-center gap-1">
              <input
                value={closeTicker}
                onChange={(e) => setCloseTicker(e.target.value)}
                className="w-14 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                aria-label="Market to close"
              />
              <button className={btn} onClick={closePos} disabled={busy}>Close position</button>
            </span>
            {!wallet.linked && <button className={btn} onClick={withdraw} disabled={busy}>Withdraw margin to wallet</button>}
            <button className={btn} onClick={refreshBalance}>Refresh</button>
            {wallet.protectedKey && <button className={btn} onClick={() => { wallet.lock(); setRevealed(null); setKeyShown(false); setSendOpen(false); }}>Lock</button>}
            <button className={btn} onClick={() => { setSendOpen((o) => !o); setSendErr(null); setSendDone(null); }}>Send funds</button>
            <button className={btn} onClick={() => setKeyShown((o) => !o)}>{keyShown ? 'Hide my key' : 'Back up my key'}</button>
            {wallet.linked ? (
              <button className="text-zinc-500 hover:text-amber-300 underline underline-offset-2" onClick={wallet.unlinkMain}>
                Stop trading for my main wallet
              </button>
            ) : (
              <button className={btn} onClick={() => setMainOpen((o) => !o)}>Let this game wallet trade for my main wallet</button>
            )}
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

        {wallet.key && !wallet.protectedKey && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3">
            <div className="font-semibold text-amber-200">Protect this wallet with a PIN</div>
            <p className="text-zinc-400">Your key is stored in this browser without protection, so anyone who opens this browser can use it. Choose a PIN (at least 6 characters, 8 or more is safer) and the key is encrypted. You will enter the PIN each time you open the site. The PIN cannot be recovered, so back up your key first if it holds funds you care about.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="password" value={pin1} onChange={(e) => setPin1(e.target.value)} placeholder="New PIN" aria-label="New PIN" className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none" />
              <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} placeholder="Repeat PIN" aria-label="Repeat PIN" className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none" />
              <button className={btn} onClick={doProtect} disabled={pinBusy}>{pinBusy ? 'Encrypting…' : 'Protect wallet'}</button>
            </div>
            {pinErr && <div className="text-rose-300">{pinErr}</div>}
          </div>
        )}

        {keyShown && wallet.key && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/30 p-3">
            <div className="font-semibold text-amber-200">Your game wallet key (testnet only)</div>
            <p className="text-zinc-400">Anyone with this key controls this wallet and everything in it. Make sure nobody is watching or recording. The key hides itself after 20 seconds. Paste it into &quot;Import a testnet key&quot; on another browser or site to use the same wallet there.</p>
            {!revealed ? (
              <div className="flex flex-wrap items-center gap-2">
                <input type="password" value={revealPin} onChange={(e) => setRevealPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void showKey(); }} placeholder="Enter your PIN" aria-label="PIN to show the key" className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none" />
                <button className={btn} onClick={showKey}>Show key</button>
                {revealErr && <span className="text-rose-300">{revealErr}</span>}
              </div>
            ) : (
              <>
                <div className="break-all rounded bg-zinc-950 p-2 font-mono text-zinc-100 select-all">{revealed}</div>
                <button className={btn} onClick={copyKey}>{keyCopied ? 'Copied!' : 'Copy key'}</button>
              </>
            )}
          </div>
        )}

        {sendOpen && wallet.key && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="font-semibold text-zinc-100">Send from this game wallet</div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" value={sendTok} onChange={(e) => setSendTok(e.target.value as 'STT' | 'USDso')}>
                <option value="USDso">USDso</option>
                <option value="STT">STT</option>
              </select>
              <input
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                placeholder="To address 0x..."
                className="w-full sm:w-96 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              <input
                value={sendAmt}
                onChange={(e) => setSendAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="Amount"
                className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              {wallet.protectedKey && <input type="password" value={sendPin} onChange={(e) => setSendPin(e.target.value)} placeholder="Your PIN" aria-label="PIN to send" className="w-28 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none" />}
              <button className={btn} onClick={doSend} disabled={sending}>{sending ? <span className="inline-flex items-center gap-1.5"><Spinner className="h-3 w-3" />Sending…</span> : 'Send'}</button>
            </div>
            <p className="text-zinc-500">Pays gas in STT from this wallet. Money in your dreamDEX margin or in a match vault is not here; withdraw or claim it first.</p>
            {sendErr && <div className="text-rose-300">{sendErr}</div>}
            {sendDone && <div className="text-emerald-300">{sendDone}</div>}
          </div>
        )}

        {mainOpen && wallet.address && !wallet.linked && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <input
              value={mainText}
              onChange={(e) => setMainText(e.target.value)}
              placeholder="Your main wallet address 0x..."
              className="w-full sm:w-96 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
            <button className={btn} onClick={doLink}>Continue</button>
          </div>
        )}

        {wallet.linked && wallet.address && wallet.signer && <BotSetup main={wallet.address} bot={wallet.signer} />}

        {setup && !wallet.address && (
          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="font-semibold text-zinc-100">{setup === 'import' ? 'Import a testnet key' : 'Create a game wallet'}</div>
            <p className="text-zinc-400">Choose a PIN (at least 6 characters, 8 or more is safer). The key is encrypted with it in this browser. You enter the PIN each time you open the site, and it cannot be recovered.</p>
            <div className="flex flex-wrap items-center gap-2">
              {setup === 'import' && (
                <input type="password" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="0x... testnet private key" className="w-full sm:w-96 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none" />
              )}
              <input type="password" value={pin1} onChange={(e) => setPin1(e.target.value)} placeholder="PIN" aria-label="PIN" className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none" />
              <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} placeholder="Repeat PIN" aria-label="Repeat PIN" className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none" />
              <button className={btn} onClick={doSetup} disabled={pinBusy}>{pinBusy ? 'Encrypting…' : setup === 'import' ? 'Use this key' : 'Create wallet'}</button>
              <button className="text-zinc-500 underline underline-offset-2" onClick={() => { setSetup(null); setPinErr(null); }}>Cancel</button>
            </div>
            {pinErr && <div className="text-rose-300">{pinErr}</div>}
          </div>
        )}

        <div className="text-[11px] text-zinc-500">
          Testnet only. The key stays in this browser{wallet.protectedKey ? ', encrypted with your PIN' : ''}. {wallet.linked ? 'The bot needs STT for gas and USDso for stakes. Orders use your main wallet\'s margin; winnings and refunds go to it.' : wallet.address ? 'Send STT for gas to the address above, then claim the paper USDso.' : 'Never import a key that holds real money.'}
        </div>
        {status && <div className="text-[11px] text-amber-300">{status}</div>}
      </div>
    </div>
  );
};
