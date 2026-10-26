/** One GraphQL call to the dreamDEX indexer, through our own route in the browser. */
export async function gql<T>(query: string): Promise<T> {
  const url = typeof window === 'undefined' ? process.env.INDEXER_URL ?? 'https://hideki-dev.smk.somnia.host/v1/graphql' : '/api/indexer';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}
