// Clean reproduction of the paper USDso claim revert, with no game code involved. Writes repro-claim.txt.
//   1) npx tsx scripts/repro-claim.mts            -> makes a fresh testnet wallet, prints its address
//   2) send ~0.5 STT (Hideki) to that address
//   3) npx tsx scripts/repro-claim.mts            -> runs the docs example and records everything
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES, SomniaMarkets } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const KEYFILE = 'repro-claim-key.txt';
if (!existsSync(KEYFILE)) {
  const k = generatePrivateKey();
  writeFileSync(KEYFILE, k + '\n');
  console.log(`Fresh testnet wallet: ${privateKeyToAccount(k).address}\nSend about 0.5 STT (Hideki) to it, then run this again.`);
  process.exit(0);
}
const key = readFileSync(KEYFILE, 'utf8').trim() as `0x${string}`;
const account = privateKeyToAccount(key);
const out: string[] = [];
const log = (s: string) => out.push(s);
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
log(`wallet ${account.address}`);
log(`STT balance (wei): ${await pub.getBalance({ address: account.address })}`);
const sdk = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql', addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: key });
const rows = (await sdk.client.listPerpMarkets()) as unknown as { baseSymbol: string; marginBank: `0x${string}` }[];
const bank = rows.find((r) => r.baseSymbol === 'BTC')!.marginBank;
log(`marginBank ${bank}`);
log(`eligibility before: ${json(await sdk.client.getPerpVoucherEligibility(bank, account.address))}`);
try {
  const res = await sdk.trader.claimPerpVoucher({ marginBank: bank });
  log(`CLAIM OK: ${json(res)}`);
} catch (e) {
  const err = e as { shortMessage?: string; details?: string; cause?: { shortMessage?: string; details?: string; data?: unknown }; message?: string; metaMessages?: string[] };
  log(`CLAIM FAILED`);
  log(`shortMessage: ${err.shortMessage}`);
  log(`details: ${err.details}`);
  log(`cause: ${err.cause?.shortMessage} | ${err.cause?.details} | data ${json(err.cause?.data)}`);
  log(`message: ${(err.message ?? '').slice(0, 600)}`);
}
log(`eligibility after: ${json(await sdk.client.getPerpVoucherEligibility(bank, account.address))}`);
log(`SDK @somnia-chain/markets-sdk ${JSON.parse(readFileSync('node_modules/@somnia-chain/markets-sdk/package.json', 'utf8')).version}`);
writeFileSync('repro-claim.txt', out.join('\n') + '\n');
console.log('Wrote repro-claim.txt');
