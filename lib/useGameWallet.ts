'use client';

import { useCallback, useEffect, useState } from 'react';
import { addressOfKey, createGameKey, forgetGameKey, importGameKey, linkAccount, readLinkedAccount, readStoredKey, unlinkAccount } from './gameWallet';

type Hex = `0x${string}`;

export interface GameWallet {
  ready: boolean; // false until we have looked in localStorage (avoids a flash of "no wallet")
  key: Hex | null;
  address: Hex | null; // the ACCOUNT: whose seats, stakes, margin and results these are (the main wallet when linked)
  signer: Hex | null; // this browser's own game wallet address: pays gas, signs
  linked: boolean; // true when the game wallet acts as a bot for a main wallet
  player: Hex | null; // whose orders count in matches: the account
  linkMain: (address: string) => void; // throws on a bad address
  unlinkMain: () => void;
  create: () => void;
  importKey: (input: string) => void; // throws on a bad key
  forget: () => void;
}

export function useGameWallet(): GameWallet {
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<Hex | null>(null);
  const [main, setMain] = useState<Hex | null>(null);

  useEffect(() => {
    setKey(readStoredKey());
    setMain(readLinkedAccount());
    setReady(true);
  }, []);

  const create = useCallback(() => setKey(createGameKey()), []);
  const importKey = useCallback((input: string) => setKey(importGameKey(input)), []);
  const forget = useCallback(() => {
    forgetGameKey();
    setKey(null);
  }, []);

  const linkMain = useCallback((a: string) => setMain(linkAccount(a)), []);
  const unlinkMain = useCallback(() => {
    unlinkAccount();
    setMain(null);
  }, []);

  const signer = key ? addressOfKey(key) : null;
  const linked = !!(signer && main && main.toLowerCase() !== signer.toLowerCase());
  const address = linked ? main : signer;
  return { ready, key, address, signer, linked, player: address, create, importKey, forget, linkMain, unlinkMain };
}
