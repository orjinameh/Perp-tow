// Read only: shows what a contract can read for one account. Run it, deposit $1 in the app, run it again.
//   node --import tsx scripts/probe-account.mts 0xYourMainWallet
import { appendFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const account = process.argv[2] as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(account ?? '')) throw new Error('Pass the wallet address: node --import tsx scripts/probe-account.mts 0x...');
const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}` }[];
const btc = rows.find((r) => r.baseSymbol === 'BTC') ?? rows[0];
const bank = (await pub.readContract({ address: btc.poolAddress, abi: parseAbi(['function marginBank() view returns (address)']), functionName: 'marginBank' })) as `0x${string}`;
const abi = parseAbi([
  'function getAccountEquity(address) view returns (int256)',
  'function getCollateralBasis(address) view returns (uint256)',
  'function getAccountState(address) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))',
  'function getPosition(address, address) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))',
]);
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const lines = [`--- ${new Date().toISOString()} account ${account} bank ${bank}`];
for (const [fn, args] of [['getAccountEquity', [account]], ['getCollateralBasis', [account]], ['getAccountState', [account]], ['getPosition', [account, btc.poolAddress]]] as const) {
  try { lines.push(`${fn}: ${j(await pub.readContract({ address: bank, abi, functionName: fn as never, args: args as never }))}`); } catch (e) { lines.push(`${fn}: FAILED ${(e as Error).message.split('\n')[0]}`); }
}
appendFileSync('probe-out.txt', lines.join('\n') + '\n');
console.log(lines.join('\n') + '\n(also appended to probe-out.txt)');
