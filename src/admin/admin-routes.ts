import { Router, Request, Response, static as expressStatic } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import multer from 'multer';
import { loadConfig, saveConfig, maskSecrets, applyConfig, getDataDir, AppConfig } from './config-store.js';
import { loadTargets, saveTargets, saveTargetCategory, TARGET_CATEGORIES, TargetCategory, MAX_ITEMS_PER_CATEGORY } from './targets-store.js';
import { checkTargets } from './target-check.js';
import { loadCategory, resolveTargetItems } from './target-load.js';
import { mutateIdentities } from './identity-mutate.js';
import { sanitizeUpstreamError } from './connectivity.js';
import { MUTABLE_ATTRIBUTES } from '../graph/user-attributes.js';
import { testGraph } from './connectivity.js';
import { logger } from '../logger/logger.js';

const certUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const startedAt = Date.now();
// Read version from package.json once at startup
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const appVersion: string = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;

const router = Router();

// This app has no login gate — anyone who can reach it can read/change Graph
// config and drive the Graph-dependent operations. It's meant to run somewhere
// only trusted operators can reach (localhost, an internal network, etc.).

router.get('/api/config', (_req: Request, res: Response) => {
  res.json(maskSecrets(loadConfig()));
});

router.put('/api/config', (req: Request, res: Response) => {
  try {
    const current = loadConfig();
    const body = req.body as Partial<AppConfig>;

    // Merge: only non-empty, non-masked values from the body override current config
    const merged: AppConfig = { ...current };
    for (const key of Object.keys(current) as (keyof AppConfig)[]) {
      const incoming = body[key];
      const currentValue = current[key];
      if (typeof currentValue === 'number') {
        if (typeof incoming === 'number') {
          (merged as unknown as Record<string, unknown>)[key] = incoming;
        }
      } else if (typeof currentValue === 'boolean') {
        if (typeof incoming === 'boolean') {
          (merged as unknown as Record<string, unknown>)[key] = incoming;
        }
      } else {
        if (typeof incoming === 'string' && incoming !== '' && incoming !== '********') {
          (merged as unknown as Record<string, unknown>)[key] = incoming;
        }
      }
    }

    saveConfig(merged);
    applyConfig(merged);

    res.json({ success: true, config: maskSecrets(loadConfig()) });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/test-graph', async (req: Request, res: Response) => {
  const result = await testGraph(req.body);
  if (result.success && result._apply) result._apply();
  const { _apply, ...response } = result;
  res.json(response);
});

// ── Targets ─────────────────────────────────────────────────────────

router.get('/api/targets', (_req: Request, res: Response) => {
  res.json(loadTargets());
});

router.put('/api/targets', (req: Request, res: Response) => {
  try {
    const saved = saveTargets(req.body);
    res.json({ success: true, targets: saved });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update one category, merging into the stored config. Each workload page saves
// its own category independently.
router.put('/api/targets/:category', (req: Request, res: Response) => {
  const category = req.params.category;
  if (!TARGET_CATEGORIES.includes(category as TargetCategory)) {
    res.status(400).json({ success: false, error: 'Unknown target category' });
    return;
  }
  try {
    const saved = saveTargetCategory(category as TargetCategory, req.body ?? {});
    res.json({ success: true, category, targets: saved[category as TargetCategory] });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/targets/check', async (req: Request, res: Response) => {
  const { category, items } = req.body as { category?: unknown; items?: unknown };
  if (!TARGET_CATEGORIES.includes(category as TargetCategory)) {
    res.status(400).json({ error: 'Unknown target category' });
    return;
  }
  if (!Array.isArray(items) || items.some(i => typeof i !== 'string')) {
    res.status(400).json({ error: 'items must be an array of strings' });
    return;
  }
  const cleaned = items.map(i => i.trim()).filter(i => i !== '');
  if (cleaned.length > MAX_ITEMS_PER_CATEGORY) {
    res.status(400).json({ error: `Too many items (max ${MAX_ITEMS_PER_CATEGORY})` });
    return;
  }
  const results = await checkTargets(category as TargetCategory, cleaned);
  res.json({ results });
});

router.post('/api/targets/load', async (req: Request, res: Response) => {
  const { category } = req.body as { category?: unknown };
  if (!TARGET_CATEGORIES.includes(category as TargetCategory)) {
    res.status(400).json({ error: 'Unknown target category' });
    return;
  }
  try {
    const result = await loadCategory(category as TargetCategory);
    res.json(result);
  } catch (err: unknown) {
    res.status(502).json({ error: sanitizeUpstreamError(err) });
  }
});

// ── Identities: random attribute mutation ───────────────────────────

router.get('/api/identities/attributes', (_req: Request, res: Response) => {
  res.json({ attributes: MUTABLE_ATTRIBUTES.map(a => a.name) });
});

router.post('/api/identities/mutate', async (_req: Request, res: Response) => {
  const identities = loadTargets().identities;
  if (!identities.enabled) {
    res.status(400).json({ error: 'The Identities target category is not enabled' });
    return;
  }
  try {
    // Explicit → the saved list; random → a fresh random % of the tenant's users.
    const resolved = await resolveTargetItems('identities', identities);
    if (resolved.items.length === 0) {
      const msg = resolved.runStyle === 'random'
        ? 'No users were found in the tenant to sample'
        : 'No identities are selected';
      res.status(400).json({ error: msg });
      return;
    }
    const run = await mutateIdentities(resolved.items);
    res.json({ ...run, runStyle: resolved.runStyle, pool: resolved.pool });
  } catch (err: unknown) {
    res.status(502).json({ error: sanitizeUpstreamError(err) });
  }
});

router.get('/api/status', (_req: Request, res: Response) => {
  res.json({
    version: appVersion,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// ── Certificate upload ──────────────────────────────────────────────

router.post('/api/upload-certificate', (req: Request, res: Response) => {
  certUpload.single('certificate')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Certificate file exceeds 1MB limit' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const content = file.buffer.toString('utf-8');
    if (!content.includes('-----BEGIN')) {
      res.status(400).json({ error: 'File does not appear to be a PEM certificate (missing BEGIN marker)' });
      return;
    }

    try {
      const certPath = join(getDataDir(), 'graph-cert.pem');
      writeFileSync(certPath, content, 'utf-8');
      chmodSync(certPath, 0o600);

      // Update config to point to the saved cert
      const config = loadConfig();
      config.graphCertificatePath = certPath;
      saveConfig(config);
      applyConfig(config);

      logger.info(`[ADMIN] Certificate uploaded and saved to ${certPath}`);
      res.json({ success: true, path: certPath });
    } catch (writeErr: any) {
      logger.error('[ADMIN] Failed to save certificate:', writeErr);
      res.status(500).json({ error: 'Failed to save certificate: ' + writeErr.message });
    }
  });
});

// ── Static file serving ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, 'static');
router.use('/admin', expressStatic(staticDir));

// Redirect root to the admin UI
router.get('/', (_req: Request, res: Response) => {
  res.redirect('/admin');
});

export default router;
