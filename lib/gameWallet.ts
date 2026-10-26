import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Testnet-only "game wallet": a key kept in this browser's localStorage. It only ever holds
// dreamDEX testnet funds (STT for gas and paper USDso), never real money.
const STORAGE_KEY = 'tow-game-wallet-key';

type Hex = `0x${string}`;

export function readStoredKey(): Hex | null {
  try {
    const k = window.localStorage.getItem(STORAGE_KEY);
    return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null;
  } catch {
    return null;
  }
}

function storeKey(k: Hex) {
  try {
    window.localStorage.setItem(STORAGE_KEY, k);
  } catch {
    /* private mode: the wallet then lives only until the tab closes */
  }
}

export function createGameKey(): Hex {
  const k = generatePrivateKey();
  storeKey(k);
  return k;
}

export function importGameKey(input: string): Hex {
  const t = input.trim();
  const k = (t.startsWith('0x') ? t : `0x${t}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('A private key is 0x followed by 64 hex characters.');
  privateKeyToAccount(k); // throws if it is not a valid key
  storeKey(k);
  return k;
}

export function forgetGameKey() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to remove */
  }
}

export function addressOfKey(k: Hex): Hex {
  return privateKeyToAccount(k).address;
}

// The "account" is the main wallet the game wallet acts for (a bot). Only its address is stored, never its key.
const ACCOUNT_KEY = 'tow-main-account';

export function readLinkedAccount(): Hex | null {
  try {
    const a = window.localStorage.getItem(ACCOUNT_KEY);
    return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Hex) : null;
  } catch {
    return null;
  }
}

export function linkAccount(input: string): Hex {
  const a = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error('A wallet address is 0x followed by 40 hex characters.');
  try {
    window.localStorage.setItem(ACCOUNT_KEY, a);
  } catch {
    /* kept for this tab only */
  }
  return a as Hex;
}

export function unlinkAccount() {
  try {
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* nothing to remove */
  }
}
