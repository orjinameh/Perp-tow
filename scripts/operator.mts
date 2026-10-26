// Runs the escrow operator's job by itself, so nobody has to type settle commands:
//   1. when a match's trade window ends, close staking (`start`), which also starts the escrow clock
//   2. when its price clock ends, post the result computed from public dreamDEX candles
//   OPERATOR_KEY=0x... npm run operator -- BTC ETH      (defaults to BTC)
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { loadMatches } from '../lib/matches';
import { ESCROW_ABI, matchKey, RPC } from '../lib/escrow';

const tickers = process.argv.slice(2).length ? process.argv.slice(2) : ['BTC'];
const key = process.env.OPERATOR_KEY as `0x${string}` | undefined;
const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !escrow) throw new Error('Set OPERATOR_KEY (0x + 64 hex characters) and NEXT_PUBLIC_ESCROW_ADDRESS (in .env.local).');

const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account: privateKeyToAccount(key) });
const INDEXER = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';
const log = (s: string) => console.log(`${new Date().toLocaleTimeString()}  ${s}`);
const done = new Set<string>(); // matches that need nothing more
const tries = new Map<string, number>();

async function poolOf(ticker: string) {
  const r = await fetch(INDEXER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}) { id } }` }) }).then((x) => x.json());
  return r.data?.Market?.[0]?.id as string | undefined;
}
const read = async (k: `0x${string}`) => (await pub.readContract({ address: escrow, abi: ESCROW_ABI, functionName: 'matches', args: [k] })) as readonly [number, number, bigint, number, bigint];
const send = async (fn: 'start' | 'settle', args: readonly unknown[]) => {
  const hash = await wallet.writeContract({ address: escrow, abi: ESCROW_ABI, functionName: fn, args } as never);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
};

async function pass() {
  const now = Math.floor(Date.now() / 1000);
  for (const ticker of tickers) {
    const pool = await poolOf(ticker);
    if (!pool) {
      log(`No perp market ${ticker}.`);
      continue;
    }
    for (const m of await loadMatches(pool, ticker, null)) {
      const id = m.id;
      const number = Number(id.split('#')[1]);
      if (done.has(id) || m.status === 'filling' || m.status === 'confirming' || m.status === 'opening') continue;
      if (m.status === 'cancelled') {
        done.add(id);
        continue;
      }
      if (m.tradeEndsAt && now < m.tradeEndsAt + 4) continue; // let the last trades land
      if (m.tradeEndsAt && now - m.tradeEndsAt > 6 * 3600) {
        done.add(id); // too old to bother
        continue;
      }
      const k = matchKey(ticker, number);
      try {
        const [bulls, bears, startedAt, result] = await read(k);
        if (result !== 0) {
          done.add(id);
          continue;
        }
        if (startedAt === 0n) {
          if (bulls + bears === 0) {
            done.add(id); // nobody staked in the escrow: nothing to settle
            log(`${id}: nobody staked in the escrow, skipping.`);
            continue;
          }
          const h = await send('start', [k]);
          log(`${id}: staking closed (${bulls} Bulls, ${bears} Bears staked). Tx ${h}`);
          const [, , , after] = await read(k);
          if (after !== 0) {
            done.add(id);
            log(`${id}: one team or too few stakers, so the escrow made it a refund.`);
            continue;
          }
        }
        if (m.status === 'settled') {
          const res = m.settledResult === 'tie' ? 3 : m.settledResult === 'bulls' ? 1 : 2;
          const h = await send('settle', [k, res]);
          done.add(id);
          log(`${id}: settled, result ${['', 'Bulls', 'Bears', 'Refund'][res]}. Tx ${h}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/still running/i.test(msg)) continue; // the escrow clock is a few seconds behind; try again next pass
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        log(`${id}: ${msg.split('\n')[0]} (attempt ${n}/5)`);
        if (n >= 5) done.add(id);
      }
    }
  }
}

log(`Operator ${privateKeyToAccount(key).address} watching ${tickers.join(', ')}. Press Ctrl+C to stop.`);
for (;;) {
  try {
    await pass();
  } catch (e) {
    log(`pass failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
