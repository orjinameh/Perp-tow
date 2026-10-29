// A local log of everything this browser's game wallet did on the chain: seats, trades, claims, transfers.
// It is kept in this browser only (the chain remains the source of truth for money). Every read and write is guarded
// because browser storage can be unavailable.

export type ActivityStatus = 'confirmed' | 'failed' | 'not sent';

export interface Activity {
  id: string;
  t: number; // ms
  signer: string; // the game wallet address that sent it
  kind: string; // seat, leave, confirm, lock, trade, close, settle, claim, release, transfer, deposit, withdraw, approve, faucet
  title: string;
  detail?: string;
  hash?: string;
  status: ActivityStatus;
  match?: { ticker: string; number: number };
}

const KEY = 'tow-activity-v1';
const MAX = 400;
export const ACTIVITY_EVENT = 'tow-activity';

function readAll(): Activity[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Activity[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function logActivity(a: Omit<Activity, 'id' | 'signer' | 't'> & { signer: string }) {
  if (typeof window === 'undefined') return;
  try {
    const rec: Activity = { ...a, signer: a.signer.toLowerCase(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, t: Date.now() };
    const next = [rec, ...readAll()].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
  } catch {
    /* storage full or unavailable: the chain still has the record */
  }
}

export function readActivity(signer: string | null | undefined): Activity[] {
  if (typeof window === 'undefined' || !signer) return [];
  const s = signer.toLowerCase();
  return readAll().filter((a) => a.signer === s);
}
