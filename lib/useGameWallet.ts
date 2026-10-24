'use client';

import { useCallback, useEffect, useState } from 'react';
import { addressOfKey, createGameKey, forgetGameKey, importGameKey, readStoredKey } from './gameWallet';

type Hex = `0x${string}`;

export interface GameWallet {
  ready: boolean; // false until we have looked in localStorage (avoids a flash of "no wallet")
  key: Hex | null;
  address: Hex | null;
  player: Hex | null; // whose orders count in matches: always the game wallet
  create: () => void;
  importKey: (input: string) => void; // throws on a bad key
  forget: () => void;
}

export function useGameWallet(): GameWallet {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<Hex | null>(null);

  useEffect(() => {
    setKey(readStoredKey());
    setReady(true);
  }, []);

  const create = useCallback(() => setKey(createGameKey()), []);
  const importKey = useCallback((input: string) => setKey(importGameKey(input)), []);
  const forget = useCallback(() => {
    forgetGameKey();
    setKey(null);
  }, []);

  const address = key ? addressOfKey(key) : null;
  return { ready, key, address, player: address, create, importKey, forget };
}
