import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

type Hex = `0x${string}`;
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';

/** Where the seat registry lives. Set it after `npm run deploy:registry`. */
export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || '') as Hex | '';
export const registryEnabled = REGISTRY_ADDRESS !== '';

const ABI = parseAbi([
  'function enter(string market, uint256 matchNumber, uint8 side)',
  'function latestMatch(string market) view returns (uint256)',
  'function roster(string market, uint256 matchNumber) view returns (address[] players, uint8[] sides, uint64 startedAt)',
]);

const pub = () => createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });

export interface RegistryMatch {
  number: number;
  players: { player: string; side: 1 | 2 }[];
  startedAt: number; // unix seconds, 0 while the match is still filling
}

/** Takes a seat. Reverts on chain when the match is full or this wallet is already in it. */
export async function enterRegistry(key: Hex, ticker: string, matchNumber: number, side: 'bulls' | 'bears'): Promise<string | null> {
  if (!registryEnabled) throw new Error('The game registry is not set up yet (NEXT_PUBLIC_REGISTRY_ADDRESS is empty).');
  const wallet = createWalletClient({ chain: hidekiTestnet, transport: http(RPC), account: privateKeyToAccount(key) });
  let hash: Hex;
  try {
    hash = await wallet.writeContract({ address: REGISTRY_ADDRESS as Hex, abi: ABI, functionName: 'enter', args: [ticker, BigInt(matchNumber), side === 'bulls' ? 1 : 2] });
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string };
    const text = err.shortMessage ?? err.message ?? String(e);
    if (/other side/i.test(text)) throw new Error('This match needs both teams. Take the other side, or join a different match.');
    if (/full/i.test(text)) throw new Error('This match is already full. Open a new match.');
    if (/already in/i.test(text)) throw new Error('This wallet already has a seat in this match.');
    throw new Error(text.split('\n')[0]);
  }
  const rc = await pub().waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Taking the seat reverted on chain (${hash}).`);
  return hash;
}

const WINDOW = 30; // only the 30 newest match numbers are read

/** The newest matches on one market, read straight from the registry's storage. */
export async function readMatches(ticker: string): Promise<RegistryMatch[]> {
  if (!registryEnabled) throw new Error('The game registry is not set up yet. Deploy it with `npm run deploy:registry` and set NEXT_PUBLIC_REGISTRY_ADDRESS.');
  const client = pub();
  const latest = Number(await client.readContract({ address: REGISTRY_ADDRESS as Hex, abi: ABI, functionName: 'latestMatch', args: [ticker] }));
  const numbers: number[] = [];
  for (let n = Math.max(1, latest - WINDOW + 1); n <= latest; n++) numbers.push(n);
  const rows = await Promise.all(
    numbers.map(async (n) => {
      const [players, sides, startedAt] = (await client.readContract({
        address: REGISTRY_ADDRESS as Hex,
        abi: ABI,
        functionName: 'roster',
        args: [ticker, BigInt(n)],
      })) as readonly [readonly Hex[], readonly number[], bigint];
      return { number: n, players: players.map((p, i) => ({ player: p as string, side: Number(sides[i]) as 1 | 2 })), startedAt: Number(startedAt) };
    }),
  );
  return rows.filter((r) => r.players.length > 0);
}
