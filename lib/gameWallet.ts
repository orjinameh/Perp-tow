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

// The key is stored encrypted: AES-GCM with a key derived from the player's PIN (PBKDF2, 600k rounds). The PIN is never
// stored. The readable key lives only in memory after unlocking, so a stolen phone or a copy of the browser storage
// does not give the key away without the PIN. A short PIN can still be guessed offline: use 8 or more characters.
const ENC_KEY = 'tow-game-wallet-enc';
const ITER = 600_000;
export const MIN_PIN = 6;

interface EncBlob { v: 1; salt: string; iv: string; ct: string; addr: Hex }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!c || !c.subtle) throw new Error('This browser or connection cannot encrypt the key (it needs https or localhost). Open the site over https.');
  return c.subtle;
}

function checkPin(pin: string) {
  if (pin.length < MIN_PIN) throw new Error(`Use a PIN of at least ${MIN_PIN} characters (8 or more is safer).`);
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const st = subtle();
  const base = await st.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return st.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function readEncrypted(): EncBlob | null {
  try {
    const raw = window.localStorage.getItem(ENC_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as EncBlob;
    return b && b.v === 1 && /^0x[0-9a-fA-F]{40}$/.test(b.addr) ? b : null;
  } catch {
    return null;
  }
}

/** Encrypts the key with the PIN, stores it, and removes any readable copy. Throws a sentence if it cannot. */
export async function protectKey(k: Hex, pin: string): Promise<void> {
  checkPin(pin);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ck = await deriveKey(pin, salt);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, ck, new TextEncoder().encode(k)));
  const blob: EncBlob = { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct), addr: privateKeyToAccount(k).address };
  try {
    window.localStorage.setItem(ENC_KEY, JSON.stringify(blob));
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('This browser would not save the wallet (private mode?). Use a normal window.');
  }
}

// Too many wrong PINs in a row slow guessing down in the app (the real protection is a long PIN).
let wrong = 0;
let blockedUntil = 0;

/** Decrypts the stored key with the PIN. Throws "Wrong PIN" (and slows down repeated guesses). */
export async function unlockKey(pin: string): Promise<Hex> {
  const b = readEncrypted();
  if (!b) throw new Error('There is no protected wallet in this browser.');
  const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
  if (wait > 0) throw new Error(`Too many wrong PINs. Wait ${wait} seconds and try again.`);
  try {
    const ck = await deriveKey(pin, unb64(b.salt));
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(b.iv) as BufferSource }, ck, unb64(b.ct) as BufferSource);
    wrong = 0;
    return new TextDecoder().decode(pt) as Hex;
  } catch (e) {
    if (e instanceof Error && /encrypt|https/.test(e.message)) throw e;
    wrong += 1;
    if (wrong >= 5) { blockedUntil = Date.now() + 30_000 * 2 ** Math.min(wrong - 5, 6); }
    throw new Error('Wrong PIN.');
  }
}

export async function createGameKey(pin: string): Promise<Hex> {
  const k = generatePrivateKey();
  await protectKey(k, pin);
  return k;
}

export async function importGameKey(input: string, pin: string): Promise<Hex> {
  const t = input.trim();
  const k = (t.startsWith('0x') ? t : `0x${t}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('A private key is 0x followed by 64 hex characters.');
  privateKeyToAccount(k); // throws if it is not a valid key
  await protectKey(k, pin);
  return k;
}

export function forgetGameKey() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ENC_KEY);
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
