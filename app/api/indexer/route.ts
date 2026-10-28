// Server-side pass-through to the dreamDEX Hideki indexer, so the browser never has to deal with CORS.
// Read-only: anything that is not a plain GraphQL query is refused. Each caller gets a request budget so the site
// cannot be used as a free relay (best effort: the counters live in this server instance's memory).
const INDEXER_URL = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 240; // a busy page asks a few times a second at most
const hits = new Map<string, { n: number; reset: number }>();

function allow(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
    return true;
  }
  h.n += 1;
  return h.n <= MAX_PER_WINDOW;
}

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!allow(ip)) {
    return Response.json({ errors: [{ message: 'too many requests, slow down for a minute' }] }, { status: 429, headers: { 'retry-after': '60' } });
  }
  let body: { query?: unknown; variables?: unknown; operationName?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ errors: [{ message: 'invalid JSON body' }] }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query : '';
  if (!query || query.length > 20000 || /\b(mutation|subscription)\b/i.test(query)) {
    return Response.json({ errors: [{ message: 'only read queries are allowed' }] }, { status: 400 });
  }
  try {
    const upstream = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: body.variables, operationName: body.operationName }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return Response.json(
      { errors: [{ message: `indexer unreachable: ${e instanceof Error ? e.message : String(e)}` }] },
      { status: 502 },
    );
  }
}
