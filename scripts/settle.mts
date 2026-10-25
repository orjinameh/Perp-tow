// Posts a finished match's result to the escrow. Only the operator (the deployer) can send it.
//   OPERATOR_KEY=0x... NEXT_PUBLIC_ESCROW_ADDRESS=0x... npx tsx scripts/settle.mts BTC 3
// The result is recomputed here from public dreamDEX data (same code as the app), never typed in.
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { loadMatches } from '../lib/matches';
import { ESCROW_ABI, matchKey, RPC } from '../lib/escrow';

const [ticker, numStr] = process.argv.slice(2);
const key = process.env.OPERATOR_KEY as `0x${string}` | undefined;
const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
if (!ticker || !numStr || !key || !escrow) throw new Error('Usage: OPERATOR_KEY=0x.. NEXT_PUBLIC_ESCROW_ADDRESS=0x.. npx tsx scripts/settle.mts BTC 3');
const number = Number(numStr);

const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account: privateKeyToAccount(key) });

const idx = await fetch(process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: `{ Market(where: {baseSymbol: {_eq: "${ticker}"}, perpRegistered: {_eq: true}}) { id } }` }),
}).then((r) => r.json());
const pool = idx.data?.Market?.[0]?.id as string | undefined;
if (!pool) throw new Error(`No perp market ${ticker}.`);

const all = await loadMatches(pool, ticker, null);
console.log(`Matches found on ${ticker}:`, all.length ? all.map((x) => `${x.id} (${x.total}/${x.requiredPlayers}, ${x.status})`).join(', ') : 'none');
const m = all.find((x) => x.id === `${ticker} #${number}`);
if (!m) throw new Error(`No match ${ticker} #${number} was found. Use one of the numbers listed above.`);
if (m.status !== 'settled') throw new Error(`Match is ${m.status}, not finished yet.`);

const k = matchKey(ticker, number);
const escrowMatch = (await pub.readContract({ address: escrow, abi: ESCROW_ABI, functionName: 'matches', args: [k] })) as readonly [number, number, bigint, number, bigint];
const [bulls, bears, startedAt] = escrowMatch;
// The escrow roster is whoever staked in the trade window. The price decides the winning side.
if (startedAt === 0n) {
  const startHash = await wallet.writeContract({ address: escrow, abi: ESCROW_ABI, functionName: 'start', args: [k] });
  await pub.waitForTransactionReceipt({ hash: startHash });
  console.log(`Closed staking and started the escrow match. Tx ${startHash}`);
  const after = (await pub.readContract({ address: escrow, abi: ESCROW_ABI, functionName: 'matches', args: [k] })) as readonly [number, number, bigint, number, bigint];
  if (after[3] === 3) {
    console.log('Fewer than 2 stakers or one team only: the escrow marked this match as a refund. Players claim their stake back.');
    process.exit(0);
  }
}
const result = m.settledResult === 'tie' ? 3 : m.settledResult === 'bulls' ? 1 : 2;
console.log(`${m.id}: escrow ${bulls}v${bears}, start ${m.startPrice} end ${m.endPrice} -> result ${['', 'Bulls', 'Bears', 'Refund'][result]}`);
const hash = await wallet.writeContract({ address: escrow, abi: ESCROW_ABI, functionName: 'settle', args: [k, result] });
await pub.waitForTransactionReceipt({ hash });
console.log(`Settled. Tx https://explorer.testnet.somnia.network/tokyo/tx/${hash}`);
