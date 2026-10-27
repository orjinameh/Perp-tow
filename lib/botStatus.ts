import { createPublicClient, formatEther, formatUnits, http, parseAbi } from 'viem';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { poolOf } from './pools';

type Hex = `0x${string}`;
const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
const USDSO = '0xed7993A74dAe1e6656B704A424DcD8711aAf4F72' as const;
const PLACE_ORDER_FOR = '0x80054449' as const;

export interface BotStatus {
  added: boolean | null; // dreamDEX knows the game wallet as a bot of the main wallet (null = could not be read)
  gasStt: number;
  usdso: number; // the game wallet's own USDso, used for stakes
}

/** Reads, from the chain, whether the game wallet is ready to act as a bot for a main wallet. */
export async function botStatus(main: Hex, bot: Hex, ticker = 'BTC'): Promise<BotStatus> {
  const pub = createPublicClient({ chain: hidekiTestnet, transport: http(RPC) });
  const [gas, usd, added] = await Promise.all([
    pub.getBalance({ address: bot }),
    pub.readContract({ address: USDSO, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [bot] }) as Promise<bigint>,
    (async () => {
      try {
        const pool = await poolOf(ticker);
        const reg = (await pub.readContract({ address: pool, abi: parseAbi(['function getOperatorPermissionsRegistry() view returns (address)']), functionName: 'getOperatorPermissionsRegistry' })) as Hex;
        const abi = parseAbi([
          'function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)',
          'function isGloballyApproved(address owner, address operator, bytes4 selector) view returns (bool)',
        ]);
        const [byPool, global] = await Promise.all([
          pub.readContract({ address: reg, abi, functionName: 'isApprovedForPool', args: [pool, main, bot, PLACE_ORDER_FOR] }),
          pub.readContract({ address: reg, abi, functionName: 'isGloballyApproved', args: [main, bot, PLACE_ORDER_FOR] }),
        ]);
        return byPool || global;
      } catch {
        return null;
      }
    })(),
  ]);
  return { added, gasStt: Number(formatEther(gas)), usdso: Number(formatUnits(usd, 18)) };
}
