// Fetch a random image from a curated Wikimedia Commons category.
//
// Deliberately bounded: only a curated category, an image-mime allowlist, and a
// size cap, so an operation can't pull an arbitrary or oversized file into a
// tenant. Network access is required at run time; callers treat any failure as a
// failed operation rather than aborting a run.

const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'M365Mutator/0.x (https://github.com/probichaux/m365mutator)';

export const DEFAULT_CATEGORY = 'Category:Featured pictures on Wikimedia Commons';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']);
const MAX_BYTES = 8 * 1024 * 1024;
const CATEGORY_SAMPLE = 500;
const CANDIDATES_TRIED = 8;
const FETCH_TIMEOUT_MS = 15_000;

export interface WikimediaImage {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface ImageInfo {
  url: string;
  mime: string;
  size?: number;
}

async function wmJson(params: Record<string, string>): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' }).toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`Wikimedia API HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Titles ("File:…") of files that are direct members of the category. */
async function categoryFiles(category: string): Promise<string[]> {
  const data = await wmJson({
    action: 'query',
    list: 'categorymembers',
    cmtitle: category,
    cmtype: 'file',
    cmlimit: String(CATEGORY_SAMPLE),
  }) as { query?: { categorymembers?: { title?: string }[] } };
  return (data.query?.categorymembers ?? [])
    .map(m => m.title)
    .filter((t): t is string => typeof t === 'string');
}

async function imageInfo(title: string): Promise<ImageInfo | null> {
  const data = await wmJson({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
  }) as { query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> } };
  const pages = data.query?.pages ?? {};
  const info = Object.values(pages)[0]?.imageinfo?.[0];
  return info?.url && info.mime ? info : null;
}

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`image download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** In-place Fisher–Yates shuffle. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** "File:Some Name.jpg" → "Some Name.jpg" (Graph handles the rest of the escaping). */
function toFilename(title: string): string {
  return title.replace(/^File:/i, '').trim();
}

/**
 * Pick a random Commons image from `category` that passes the mime allowlist and
 * size cap, and return its bytes in native format. Throws if nothing suitable is
 * found (empty category, all candidates filtered out, or a network failure).
 */
export async function fetchRandomImage(category: string = DEFAULT_CATEGORY): Promise<WikimediaImage> {
  const titles = await categoryFiles(category);
  if (titles.length === 0) throw new Error(`no files in category "${category}"`);

  for (const title of shuffle(titles).slice(0, CANDIDATES_TRIED)) {
    const info = await imageInfo(title);
    if (!info || !ALLOWED_MIME.has(info.mime)) continue;
    if (info.size && info.size > MAX_BYTES) continue;
    const buffer = await download(info.url);
    if (buffer.length > MAX_BYTES) continue;
    return { buffer, filename: toFilename(title), contentType: info.mime };
  }
  throw new Error('no suitable image found (mime/size filtered)');
}
