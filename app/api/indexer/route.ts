// Server-side pass-through to the dreamDEX Hideki indexer, so the browser never has to deal with CORS.
// Read-only: anything that is not a plain GraphQL query is refused.
const INDEXER_URL = process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql';

export async function POST(req: Request) {
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
