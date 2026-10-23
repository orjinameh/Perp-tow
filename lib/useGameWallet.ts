'use client';

import { useCallback, useEffect, useState } from 'react';
import { addressOfKey, createGameKey, forgetGameKey, importGameKey, readStoredKey } from './gameWallet';

type Hex = `0x${string}`;
const OWNER_KEY = 'tow-linked-account';

export interface GameWallet {
  ready: boolean; // false until we have looked in localStorage (avoids a flash of "no wallet")
  key: Hex | null;
  address: Hex | null;
  owner: Hex | null; // a dreamDEX account the game wallet trades for (linked bot mode), if set
  player: Hex | null; // whose orders count in matches: the linked account, else the game wallet
  setOwner: (input: string) => void; // throws on a bad address; empty clears it
  create: () => void;
  importKey: (input: string) => void; // throws on a bad key
  forget: () => void;
}

export function useGameWallet(): GameWallet {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<Hex | null>(null);
  const [owner, setOwnerState] = useState<Hex | null>(null);

  useEffect(() => {
    setKey(readStoredKey());
    try {
      const o = window.localStorage.getItem(OWNER_KEY);
      if (o && /^0x[0-9a-fA-F]{40}$/.test(o)) setOwnerState(o as Hex);
    } catch {
      /* no storage */
    }
    setReady(true);
  }, []);

  const setOwner = useCallback((input: string) => {
    const t = input.trim();
    if (t === '') {
      try {
        window.localStorage.removeItem(OWNER_KEY);
      } catch {
        /* nothing to remove */
      }
      setOwnerState(null);
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(t)) throw new Error('An account address is 0x followed by 40 hex characters.');
    try {
      window.localStorage.setItem(OWNER_KEY, t);
    } catch {
      /* kept only for this tab */
    }
    setOwnerState(t as Hex);
  }, []);

  const create = useCallback(() => setKey(createGameKey()), []);
  const importKey = useCallback((input: string) => setKey(importGameKey(input)), []);
  const forget = useCallback(() => {
    forgetGameKey();
    setKey(null);
  }, []);

  const address = key ? addressOfKey(key) : null;
  return { ready, key, address, owner, player: owner ?? address, setOwner, create, importKey, forget };
}
