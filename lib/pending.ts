// What this browser's game wallet has committed to: seats it took, and whether its real trade is placed.
// Kept in localStorage only so the open tab can place the trade when the match locks.
export interface PendingEntry {
  ticker: string;
  pool: string;
  number: number;
  side: 'bulls' | 'bears';
  address: string;
  placed: boolean;
  leverage?: number; // the player's own choice; only sizes their real position
}
const KEY = 'tow.pending';

export function getPending(): PendingEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as PendingEntry[];
  } catch {
    return [];
  }
}
function save(list: PendingEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the manual button still works */
  }
}
const same = (a: PendingEntry, b: Pick<PendingEntry, 'ticker' | 'number' | 'address'>) =>
  a.ticker === b.ticker && a.number === b.number && a.address.toLowerCase() === b.address.toLowerCase();

export function addPending(e: PendingEntry) {
  save([...getPending().filter((p) => !same(p, e)), e]);
}
export function markPlaced(e: Pick<PendingEntry, 'ticker' | 'number' | 'address'>, placed: boolean) {
  save(getPending().map((p) => (same(p, e) ? { ...p, placed } : p)));
}
export function removePending(e: Pick<PendingEntry, 'ticker' | 'number' | 'address'>) {
  save(getPending().filter((p) => !same(p, e)));
}
