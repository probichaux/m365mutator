import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger/logger.js';

const sessions = new Map<string, { createdAt: number }>();
const SESSION_TIMEOUT_MS =
  (parseInt(process.env.M365MUTATOR_SESSION_TIMEOUT_MINUTES || '30', 10)) * 60 * 1000;
const COOKIE_NAME = 'm365mutator_session';

// Sweep expired sessions every minute to prevent unbounded growth and to
// shrink the window in which an expired session ID still lives in memory.
// Per-request validation in adminAuthMiddleware is the primary defense; this
// sweep is a backstop.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 60 * 1000).unref();

/**
 * Returns true if the admin UI is enabled (i.e. M365MUTATOR_ADMIN_PASSWORD is set).
 */
export function isAdminEnabled(): boolean {
  return !!process.env.M365MUTATOR_ADMIN_PASSWORD;
}

/**
 * Derives a cookie-signing secret from the admin password via HMAC,
 * so even a short password produces a strong signing key.
 */
export function getSigningSecret(): string {
  const password = process.env.M365MUTATOR_ADMIN_PASSWORD || '';
  return createHmac('sha256', 'm365mutator-cookie-salt').update(password).digest('hex');
}

/**
 * POST /api/login — validates the supplied password and creates a session.
 */
export function loginHandler(req: Request, res: Response): void {
  if (!isAdminEnabled()) {
    res.status(403).json({ success: false, error: 'Admin UI is disabled; set M365MUTATOR_ADMIN_PASSWORD in your environment and restart the server.' });
    return;
  }

  const { password } = req.body as { password?: string };
  const expected = process.env.M365MUTATOR_ADMIN_PASSWORD || '';

  // timingSafeEqual requires buffers of equal length, so pad the shorter one.
  const inputBuf = Buffer.from(password || '');
  const expectedBuf = Buffer.from(expected);
  const maxLen = Math.max(inputBuf.length, expectedBuf.length);
  const paddedInput = Buffer.alloc(maxLen);
  const paddedExpected = Buffer.alloc(maxLen);
  inputBuf.copy(paddedInput);
  expectedBuf.copy(paddedExpected);

  const match =
    inputBuf.length === expectedBuf.length &&
    timingSafeEqual(paddedInput, paddedExpected);

  if (match) {
    const sessionId = randomUUID();
    sessions.set(sessionId, { createdAt: Date.now() });
    // Only require Secure flag in production (HTTPS). Any other NODE_ENV — including
    // unset — defaults to non-secure so the cookie works over plain HTTP on localhost.
    const secureCookie = process.env.NODE_ENV === 'production';
    if (!secureCookie) {
      logger.warn('Admin session cookie issued without Secure flag (set NODE_ENV=production for HTTPS deployments)');
    }
    res.cookie(COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      path: '/',
      signed: true,
      maxAge: SESSION_TIMEOUT_MS,
    });
    logger.info('Admin login successful');
    res.status(200).json({ success: true });
  } else {
    logger.warn('Admin login failed — invalid password');
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
}

/**
 * POST /api/logout — destroys the current session.
 */
export function logoutHandler(req: Request, res: Response): void {
  const sessionId = (req as any).signedCookies?.[COOKIE_NAME] as string | undefined;
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.status(200).json({ success: true });
}

/**
 * Middleware that gates routes behind a valid, non-expired admin session.
 */
export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminEnabled()) {
    res.status(403).json({ success: false, error: 'Admin UI is disabled' });
    return;
  }

  const sessionId = (req as any).signedCookies?.[COOKIE_NAME] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const session = sessions.get(sessionId)!;
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(sessionId);
    res.status(401).json({ success: false, error: 'Session expired' });
    return;
  }

  next();
}

// Expose sessions map for testing purposes
export { sessions };
