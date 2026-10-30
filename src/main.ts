import 'dotenv/config';
import express, { Request, Response } from 'express';
import helmet from 'helmet';

import adminRouter from './admin/admin-routes.js';
import { loadConfig, applyConfig } from './admin/config-store.js';
import { graphConfig } from './helpers/graph-config.helper.js';
import { GraphAuthManager } from './graph/graph-auth.js';
import { logger } from './logger/logger.js';
import { Scheduler } from './agent/scheduler.js';

export type RunMode = 'interactive' | 'agent';

/** M365MUTATOR_MODE: 'agent' runs the scheduler with no admin UI (plan Decision 2). */
export function getRunMode(): RunMode {
  return process.env.M365MUTATOR_MODE?.trim().toLowerCase() === 'agent' ? 'agent' : 'interactive';
}

/**
 * Refuse to start in production if global TLS verification has been disabled.
 * NODE_TLS_REJECT_UNAUTHORIZED=0 silently turns off certificate validation
 * for every outbound HTTPS call to Graph, so a MITM on the network path could
 * read or forge credentials. In dev we only warn so local proxies with
 * self-signed certs still work.
 */
export function validateTlsConfig(): void {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    const msg = 'NODE_TLS_REJECT_UNAUTHORIZED=0 disables upstream TLS verification — refusing to start';
    if (process.env.NODE_ENV === 'production') {
      logger.error(`[INIT] ${msg}`);
      throw new Error(msg);
    }
    logger.warn(`[INIT] ${msg.replace('refusing to start', 'allowed only because NODE_ENV is not production')}`);
  }
}

export function validateRequiredEnvVars(): void {
  if (!graphConfig.graphClientId || !graphConfig.graphTenantId) {
    logger.warn('[INIT] GRAPH_CLIENT_ID / GRAPH_TENANT_ID not set — configure via admin UI or restart with env vars set');
  }

  const hasSecret = !!graphConfig.graphClientSecret;
  const hasCert = !!graphConfig.graphCertificatePath;
  if (!hasSecret && !hasCert) {
    logger.warn('[INIT] Neither GRAPH_CLIENT_SECRET nor GRAPH_CERTIFICATE_PATH is set — Graph calls will fail until configured');
  }
}

export function createApp(scheduler?: Scheduler): express.Express {
  const app = express();

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Enforce HTTPS via HSTS in production; leave off in dev so local HTTP works.
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    crossOriginEmbedderPolicy: false,
  }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Agent mode serves only read-only status: no admin UI, no mutating routes.
  if (scheduler) {
    app.get('/api/agent/status', (_req: Request, res: Response) => {
      res.json(scheduler.status());
    });
    return app;
  }

  app.use(express.json());
  app.use(adminRouter);

  return app;
}

async function main() {
  try {
    const config = loadConfig();
    applyConfig(config);
    logger.info('[INIT] Configuration loaded');
  } catch (err) {
    logger.warn('[INIT] Could not load config file, using env vars only', err);
  }

  validateTlsConfig();
  validateRequiredEnvVars();

  const mode = getRunMode();
  logger.info(`Starting M365Mutator (mode: ${mode})`);
  logger.info(`GRAPH_TENANT_ID: ${graphConfig.graphTenantId || 'not set'}`);
  logger.info(`GRAPH_CLIENT_ID: ${graphConfig.graphClientId || 'not set'}`);
  logger.info(`GRAPH_CLIENT_SECRET: ${graphConfig.graphClientSecret ? '[REDACTED]' : 'not set'}`);
  logger.info(`GRAPH_CERTIFICATE_PATH: ${graphConfig.graphCertificatePath || 'not set'}`);
  logger.info(`Graph auth mode: ${graphConfig.graphCertificatePath ? 'certificate' : 'client_secret'}`);

  logger.info('Initializing Microsoft Graph API client');
  try {
    const authManager = new GraphAuthManager();
    await authManager.initialize();
    logger.info('Graph API client initialized successfully');
  } catch (err) {
    logger.warn('[INIT] Graph API initialization failed — Graph-dependent operations will fail until valid credentials are configured', err);
    console.warn('Warning: Graph API initialization failed. The server will start but Graph-dependent operations will not work until credentials are updated via the admin UI.');
  }

  const scheduler = mode === 'agent' ? new Scheduler() : undefined;
  const app = createApp(scheduler);
  const port = process.env.PORT || 3700;

  const server = app.listen(port, () => {
    logger.info(`M365Mutator listening on http://localhost:${port}`);
    console.log(`M365Mutator listening on http://localhost:${port}`);
  });

  scheduler?.start();

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`ERROR: Port ${port} is already in use. Kill the existing process first.`);
      logger.error(`Port ${port} is already in use`);
    } else {
      console.error(`ERROR: Server failed to start: ${err.message}`);
      logger.error(`Server failed to start: ${err.message}`);
    }
    process.exit(1);
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    // Let a running cycle finish (up to 60s) before exiting.
    await scheduler?.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only auto-start when run directly (not when imported by tests)
const isDirectRun = process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts');
if (isDirectRun) {
  main().catch((error) => {
    logger.error('Fatal error in main():', error instanceof Error ? { message: error.message, stack: error.stack } : error);
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
