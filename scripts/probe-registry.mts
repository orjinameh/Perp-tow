import { createPublicClient, http, parseAbi } from 'viem';
const addr = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}`;
const ticker = process.argv[2] || 'BTC';
if (!addr) throw new Error('NEXT_PUBLIC_REGISTRY_ADDRESS is empty (use --env-file=.env.local)');
const c = createPublicClient({ transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const abi = parseAbi([
  'function latestMatch(string) view returns (uint256)',
  'function lobbySeconds() view returns (uint64)',
  'function confirmSeconds() view returns (uint64)',
  'function size() view returns (uint32)',
  'function roster(string,uint256) view returns (address[],uint8[],bool[],uint64,uint64)',
]);
const rd = (fn: string, args: unknown[] = []) => c.readContract({ address: addr, abi, functionName: fn as never, args: args as never }) as Promise<any>;
const now = Math.floor(Date.now() / 1000);
console.log('registry', addr);
console.log('deployed lobbySeconds', Number(await rd('lobbySeconds')), '| app NEXT_PUBLIC_LOBBY_SECONDS', process.env.NEXT_PUBLIC_LOBBY_SECONDS ?? '(default 300)');
console.log('confirmSeconds', Number(await rd('confirmSeconds')), '| size', Number(await rd('size')));
const latest = Number(await rd('latestMatch', [ticker]));
console.log(ticker, 'latestMatch =', latest);
for (let n = Math.max(1, latest - 6); n <= latest + 2; n++) {
  const [p, s, , first, full] = await rd('roster', [ticker, BigInt(n)]);
  console.log(`#${n}: seats=${p.length} sides=[${s.join(',')}] firstAt=${first ? now - Number(first) + 's ago' : 'never'} full=${full ? 'yes' : 'no'}`);
}
