import { NOMINAL_STAKE_USD } from './gameTag';

/**
 * What every player does at the lock, at the same moment: put the stake in the escrow (when it is
 * switched on) and place the real order. Nothing is staked before this.
 */
export async function openTrade(args: { key: `0x${string}`; address: `0x${string}`; ticker: string; side: 'bulls' | 'bears'; number: number; onStep?: (i: number) => void }) {
  const esc = await import('./escrow');
  if (esc.escrowEnabled) {
    args.onStep?.(0);
    const st = await esc.escrowStatus(args.ticker, args.number, args.address);
    if (!st?.joined) await esc.joinEscrow(args.key, args.address, args.ticker, args.number, args.side, NOMINAL_STAKE_USD);
  }
  args.onStep?.(esc.escrowEnabled ? 1 : 0);
  const t = await import('./trading');
  return t.enterMatch({ key: args.key, address: args.address, ticker: args.ticker, side: args.side, matchNumber: args.number, stakeUsd: NOMINAL_STAKE_USD });
}
