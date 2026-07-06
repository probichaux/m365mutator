import { getGraphClient } from './graph-client.js';
import { collectAllPages } from './graph-paginate.js';

/**
 * Convert a user-entered SharePoint site URL (the https:// prefix is optional)
 * into a Graph /sites path: /sites/{hostname}:/{server-relative-path}.
 * Throws if the value cannot be parsed as a URL.
 */
export function siteUrlToGraphPath(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, '');
  return path && path !== '/'
    ? `/sites/${parsed.hostname}:${path}`
    : `/sites/${parsed.hostname}`;
}

/** Requires the Sites.ReadWrite.All application permission. */
export async function getSiteByUrl(siteUrl: string): Promise<Record<string, unknown>> {
  return getGraphClient().api(siteUrlToGraphPath(siteUrl)).select('id').get();
}

/**
 * List the webUrl of every SharePoint site in the tenant, paginated. Uses the
 * `search=*` wildcard, which returns all sites the app can see. Requires the
 * Sites.Read.All (or Sites.ReadWrite.All) application permission.
 */
export async function listAllSites(): Promise<string[]> {
  const sites = await collectAllPages<{ webUrl?: string }>(getGraphClient(), '/sites', (req) =>
    req.query({ search: '*' }).select(['webUrl']).top(200),
  );
  return sites.map((s) => s.webUrl).filter((u): u is string => typeof u === 'string' && u !== '');
}
