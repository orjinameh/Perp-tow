'use client';

import { useCallback, useEffect, useState } from 'react';
import { addressOfKey, createGameKey, forgetGameKey, importGameKey, linkAccount, protectKey, readEncrypted, readLinkedAccount, readStoredKey, unlinkAccount, unlockKey } from './gameWallet';

type Hex = `0x${string}`;

export interface GameWallet {
  ready: boolean; // false until we have looked in localStorage (avoids a flash of "no wallet")
  key: Hex | null; // the readable key: only in memory, and only while the wallet is unlocked
  address: Hex | null; // the ACCOUNT: whose seats, stakes, margin and results these are (the main wallet when linked)
  signer: Hex | null; // this browser's own game wallet address: pays gas, signs (known even while locked)
  linked: boolean; // true when the game wallet acts as a bot for a main wallet
  player: Hex | null; // whose orders count in matches: the account
  locked: boolean; // a protected key is stored here but the PIN has not been entered yet
  protectedKey: boolean; // the stored key is encrypted with a PIN
  linkMain: (address: string) => void; // throws on a bad address
  unlinkMain: () => void;
  create: (pin: string) => Promise<void>; // throws a sentence
  importKey: (input: string, pin: string) => Promise<void>; // throws a sentence
  unlock: (pin: string) => Promise<void>; // throws "Wrong PIN."
  lock: () => void;
  protect: (pin: string) => Promise<void>; // encrypt an old unprotected key
  verifyPin: (pin: string) => Promise<boolean>;
  forget: () => void;
}

export function useGameWallet(): GameWallet {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<Hex | null>(null);
  const [lockedAddr, setLockedAddr] = useState<Hex | null>(null);
  const [isProtected, setIsProtected] = useState(false);
  const [main, setMain] = useState<Hex | null>(null);

  useEffect(() => {
    const plain = readStoredKey(); // an older, unprotected key
    const enc = readEncrypted();
    if (plain) {
      setKey(plain);
    } else if (enc) {
      setLockedAddr(enc.addr);
      setIsProtected(true);
    }
    setMain(readLinkedAccount());
    setReady(true);
  }, []);

  const create = useCallback(async (pin: string) => {
    const k = await createGameKey(pin);
    setKey(k); setLockedAddr(null); setIsProtected(true);
  }, []);
  const importKey = useCallback(async (input: string, pin: string) => {
    const k = await importGameKey(input, pin);
    setKey(k); setLockedAddr(null); setIsProtected(true);
  }, []);
  const unlock = useCallback(async (pin: string) => {
    const k = await unlockKey(pin);
    setKey(k);
  }, []);
  const lock = useCallback(() => {
    const enc = readEncrypted();
    if (!enc) return;
    setKey(null);
    setLockedAddr(enc.addr);
  }, []);
  const protect = useCallback(async (pin: string) => {
    if (!key) throw new Error('There is no key to protect.');
    await protectKey(key, pin);
    setIsProtected(true);
  }, [key]);
  const verifyPin = useCallback(async (pin: string) => {
    try { await unlockKey(pin); return true; } catch (e) {
      if (e instanceof Error && /^Too many/.test(e.message)) throw e;
      return false;
    }
  }, []);
  const forget = useCallback(() => {
    forgetGameKey();
    setKey(null); setLockedAddr(null); setIsProtected(false);
  }, []);

  const linkMain = useCallback((a: string) => setMain(linkAccount(a)), []);
  const unlinkMain = useCallback(() => {
    unlinkAccount();
    setMain(null);
  }, []);

  const signer = key ? addressOfKey(key) : lockedAddr;
  const linked = !!(signer && main && main.toLowerCase() !== signer.toLowerCase());
  const address = linked ? main : signer;
  const locked = !key && !!lockedAddr;
  return { ready, key, address, signer, linked, player: address, locked, protectedKey: isProtected, create, importKey, unlock, lock, protect, verifyPin, linkMain, unlinkMain, forget };
}
