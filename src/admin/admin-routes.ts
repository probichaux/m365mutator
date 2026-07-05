import { Router, Request, Response, static as expressStatic } from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import multer from 'multer';
import { loginHandler, logoutHandler, adminAuthMiddleware, isAdminEnabled } from './admin-auth.js';
import { loadConfig, saveConfig, maskSecrets, applyConfig, getDataDir, AppConfig } from './config-store.js';
import { testGraph } from './connectivity.js';
import { logger } from '../logger/logger.js';

const certUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const startedAt = Date.now();
// Read version from package.json once at startup
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const appVersion: string = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;

const router = Router();

// ── Public routes ────────────────────────────────────────────────────

router.post('/api/login', loginHandler);
router.post('/api/logout', logoutHandler);
router.get('/api/version', (_req: Request, res: Response) => {
  res.json({ version: appVersion });
});

// ── Authenticated routes ─────────────────────────────────────────────

router.get('/api/config', adminAuthMiddleware, (_req: Request, res: Response) => {
  res.json(maskSecrets(loadConfig()));
});

router.put('/api/config', adminAuthMiddleware, (req: Request, res: Response) => {
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

router.post('/api/test-graph', adminAuthMiddleware, async (req: Request, res: Response) => {
  const result = await testGraph(req.body);
  if (result.success && result._apply) result._apply();
  const { _apply, ...response } = result;
  res.json(response);
});

router.get('/api/status', adminAuthMiddleware, (_req: Request, res: Response) => {
  res.json({
    version: appVersion,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

// ── Certificate upload ──────────────────────────────────────────────

router.post('/api/upload-certificate', adminAuthMiddleware, (req: Request, res: Response) => {
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
const staticHandler = expressStatic(staticDir);

router.use('/admin', (req: Request, res: Response, next) => {
  if (!isAdminEnabled()) {
    res.status(403).json({ error: 'Admin UI is disabled' });
    return;
  }
  staticHandler(req, res, next);
});

// Redirect root to admin UI
router.get('/', (_req: Request, res: Response) => {
  res.redirect('/admin');
});

export default router;
