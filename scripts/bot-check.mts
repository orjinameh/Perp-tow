// Checks, without sending anything, that the bot setup works:
//   npm run bot-check -- <main wallet address> <game wallet address> BTC
// It reads the approvals and then simulates the bot's placeOrderFor call on the live pool (an eth_call).
import { createPublicClient, http, parseAbi, formatEther, formatUnits, zeroAddress, isAddress } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const [mainAddr, botAddr, ticker = 'BTC'] = process.argv.slice(2);
if (!mainAddr || !botAddr || !isAddress(mainAddr) || !isAddress(botAddr)) throw new Error('Usage: npm run bot-check -- <main wallet address> <game wallet address> BTC');
const main = mainAddr as `0x${string}`;
const bot = botAddr as `0x${string}`;
const registry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as `0x${string}` | undefined;
const escrow = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;
const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const out: string[] = [];
const say = (s: string) => {
  out.push(s);
  console.log(s);
};

const botOfAbi = parseAbi(['function botOf(address player, address bot) view returns (bool)']);
const erc20 = parseAbi(['function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
if (registry) say(`registry bot approval: ${await pub.readContract({ address: registry, abi: botOfAbi, functionName: 'botOf', args: [main, bot] }).catch((e) => `unreadable (${String(e).slice(0, 80)})`)}`);
if (escrow) {
  say(`escrow bot approval:   ${await pub.readContract({ address: escrow, abi: botOfAbi, functionName: 'botOf', args: [main, bot] }).catch((e) => `unreadable (${String(e).slice(0, 80)})`)}`);
  say(`main wallet USDso allowance for the escrow: ${formatUnits((await pub.readContract({ address: USDSO, abi: erc20, functionName: 'allowance', args: [main, escrow] })) as bigint, 18)}`);
}
say(`main wallet USDso in the wallet: ${formatUnits((await pub.readContract({ address: USDSO, abi: erc20, functionName: 'balanceOf', args: [main] })) as bigint, 18)}`);
say(`bot gas (STT): ${formatEther(await pub.getBalance({ address: bot }))}`);

const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: generatePrivateKey() });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; poolAddress: `0x${string}`; tickSize: string; minQuantity: string; markPrice: string }[];
const m = rows.find((r) => r.baseSymbol === ticker);
if (!m) throw new Error(`${ticker} is not a perp market.`);
const tick = BigInt(m.tickSize);
const slipped = (BigInt(m.markPrice) * 10_050n) / 10_000n;
const price = tick > 0n ? (slipped / tick) * tick : slipped;
const abi = parseAbi(['function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)']);
const future = BigInt(Date.now() + 3_600_000) * 1_000_000n;
for (const [label, expire] of [['expiry 0', 0n], ['expiry in 1 hour', future]] as const) {
  try {
    await pub.simulateContract({ address: m.poolAddress, abi, functionName: 'placeOrderFor', args: [main, true, 0n, price, BigInt(m.minQuantity), expire, 2, 0, zeroAddress, 0n], account: bot });
    say(`simulated ${ticker} placeOrderFor from the bot with ${label}: OK`);
  } catch (e) {
    say(`simulated ${ticker} placeOrderFor from the bot with ${label}: REVERTED  ${((e as { shortMessage?: string }).shortMessage ?? String(e)).replace(/\s+/g, ' ').slice(0, 260)}`);
  }
}
const { writeFileSync } = await import('node:fs');
writeFileSync('probe-out.txt', out.join('\n') + '\n');
console.log('\nAlso saved to probe-out.txt.');
