import { Client, GraphRequest } from '@microsoft/microsoft-graph-client';

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

/**
 * Collect every item across all pages of a Graph collection. The first request
 * is built via `configure` (to set $select/$top/$filter etc.); subsequent pages
 * follow the server-provided @odata.nextLink, which already encodes those query
 * options. Transient failures (429/503) are retried by the Graph SDK's default
 * middleware chain.
 */
export async function collectAllPages<T>(
  client: Client,
  path: string,
  configure?: (req: GraphRequest) => GraphRequest,
): Promise<T[]> {
  const items: T[] = [];
  let request = client.api(path);
  if (configure) request = configure(request);

  let page: GraphPage<T> | null = await request.get();
  while (page) {
    if (Array.isArray(page.value)) items.push(...page.value);
    const next = page['@odata.nextLink'];
    if (!next) break;
    page = await client.api(next).get();
  }
  return items;
}
