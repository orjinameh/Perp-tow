// The registry decides every deadline with the chain's block time, not with this device's clock.
// This keeps a small offset between the two so countdowns and "can I confirm now" use the chain's time.
let offset = 0; // chain seconds minus device seconds
let started = false;

async function sync() {
  try {
    const res = await fetch('https://api.hideki2.infra.testnet.somnia.network', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }),
    });
    const j = (await res.json()) as { result?: { timestamp?: string } };
    const ts = j.result?.timestamp ? Number(BigInt(j.result.timestamp)) : 0;
    if (ts > 0) offset = ts - Math.floor(Date.now() / 1000);
  } catch {
    /* keep the last offset */
  }
}

/** Current time in seconds on the chain's clock (device clock until the first sync lands). */
export function nowSec(): number {
  if (!started && typeof window !== 'undefined') {
    started = true;
    void sync();
    setInterval(sync, 30_000);
  }
  return Math.floor(Date.now() / 1000) + offset;
}
