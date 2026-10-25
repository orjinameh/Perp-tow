// Deploys TugEscrow to the Hideki testnet. The deployer becomes the operator (it posts results and collects the rake).
//   DEPLOYER_KEY=0x... node scripts/deploy-escrow.mjs
// Prints the address: put it in .env.local as NEXT_PUBLIC_ESCROW_ADDRESS=0x...
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';

const require = createRequire(import.meta.url);
const solc = require('solc');
const key = process.env.DEPLOYER_KEY;
if (!key) throw new Error('Set DEPLOYER_KEY to the operator wallet private key (a testnet key).');

const src = readFileSync(new URL('../contracts/TugEscrow.sol', import.meta.url), 'utf8');
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'TugEscrow.sol': { content: src } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})));
const errs = (out.errors ?? []).filter((e) => e.severity === 'error');
if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
const c = out.contracts['TugEscrow.sol'].TugEscrow;

const size = Number(process.env.NEXT_PUBLIC_MATCH_SIZE) > 1 ? Number(process.env.NEXT_PUBLIC_MATCH_SIZE) : 20;
const duration = Number(process.env.NEXT_PUBLIC_MATCH_SECONDS) > 0 ? Number(process.env.NEXT_PUBLIC_MATCH_SECONDS) : 300;
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72';

const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });
const pub = createPublicClient({ chain: hidekiTestnet, transport: http('https://api.hideki2.infra.testnet.somnia.network') });

const hash = await wallet.deployContract({
  abi: c.abi,
  bytecode: `0x${c.evm.bytecode.object}`,
  args: [USDSO, parseUnits('10', 18), size, BigInt(duration), 3600n, 1000],
});
const rc = await pub.waitForTransactionReceipt({ hash });
console.log(`size ${size}, ${duration}s, stake 10 USDso, rake 10%`);
console.log(`Deployed: ${rc.contractAddress}`);
console.log(`Tx: https://explorer.testnet.somnia.network/tokyo/tx/${hash}`);
console.log(`Add to .env.local: NEXT_PUBLIC_ESCROW_ADDRESS=${rc.contractAddress}`);
