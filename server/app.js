import { registerSafariAuth } from './safari-auth.js';
import { appleWebClient } from './apple-web-client.js';
import express from 'express';
import { registerMobileAuth } from './mobile-auth.js';
import { registerAppleAuth } from './apple-auth.js';
import { registerNativeGoogleAuth } from './google-native-auth.js';
import { createBilling } from './billing.js';
import { BillingError } from './billing-config.js';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, jwtVerify } from 'jose';
import * as defaultDb from './db.js';
import { evaluateWithTypeSafe, moderateGomimonName } from './typesafe.js';
import {
  InputError,
  MODEL,
  RUBRIC_VERSION,
  validateAnalysisInput
} from './logic.js';
import {
  LEADERBOARD_LIMIT,
  NAME_MODERATION_RUBRIC_VERSION,
  utcWeekBounds,
  validateGomimonName,
  validateLeaderboardJoin,
  validateLeaderboardPeriod,
  validateMealEvents
} from './leaderboard.js';
import { errorDetails, logEvent, logHashPrefix, requestIdFromRequest } from './logging.js';

class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, details);
  }
}

function signingKey() {
  const value = process.env.SESSION_SIGNING_SECRET;
  if (!value || value.length < 32) {
    throw new Error('SESSION_SIGNING_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(value);
}

function callbackUrl() {
  return process.env.GOOGLE_CALLBACK_URL || `${process.env.BASE_URL || 'http://localhost:8090'}/auth/google/callback`;
}

function extensionRedirectAllowed(redirectUri) {
  let url;
  try {
    url = new URL(redirectUri);
  } catch (error) {
    return false;
  }

  if (url.protocol !== 'https:' || !url.hostname.endsWith('.chromiumapp.org')) {
    return false;
  }

  const prefixes = (process.env.CHROME_EXTENSION_REDIRECT_PREFIXES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return prefixes.length > 0 && prefixes.some(prefix => redirectUri.startsWith(prefix));
}

async function makeOAuthState(redirectUri) {
  const nonce = randomUUID();
  const state = await new SignJWT({ redirectUri, nonce })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey());
  return { state, nonce };
}

async function readOAuthState(state) {
  const { payload } = await jwtVerify(state, signingKey());
  if (typeof payload.redirectUri !== 'string' || !extensionRedirectAllowed(payload.redirectUri)) {
    throw new Error('Invalid OAuth redirect');
  }
  if (typeof payload.nonce !== 'string') throw new Error('Invalid OAuth nonce');
  return payload;
}

function createGoogleClient() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google OAuth is not configured');
  }
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl()
  );
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

function accountPayload(account, usage, gomimon, billing) {
  return {
    account: {
      accountKey: account.public_key,
      email: account.email,
      displayName: account.display_name || null
    },
    quota: usage,
    billing,
    gomimon: gomimon || null
  };
}

function authMiddleware(db) {
  return async (req, res, next) => {
    try {
      const token = bearerToken(req);
      const account = await db.findAccountBySession(token);
      if (!account) {
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to use the detector');
      }
      req.account = account;
      req.sessionToken = token;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function configureCors(app) {
  const configured = (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (configured.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && configured.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-GomiMon-Request-ID');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-GomiMon-Request-ID');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

export function createApp({
  db = defaultDb,
  evaluate = evaluateWithTypeSafe,
  moderateName = moderateGomimonName,
  stripe,
  billingConfig
} = {}) {
  const app = express();
  const billing = createBilling({ db, stripe, ...(billingConfig ? { config: billingConfig } : {}) });
  const accountAnalysisRequests = new Map();
  const accountNameChecks = new Map();
  const inFlightAnalyses = new Map();

  function enforceAccountThrottle(accountId) {
    const now = Date.now();
    const windowMs = Number(process.env.ACCOUNT_THROTTLE_WINDOW_MS || 60000);
    const maxRequests = Number(process.env.ACCOUNT_THROTTLE_PER_WINDOW || 30);
    const existing = (accountAnalysisRequests.get(accountId) || [])
      .filter(timestamp => now - timestamp < windowMs);
    if (existing.length >= maxRequests) {
      throw new HttpError(429, 'THROTTLED', 'Too many detector requests; try again shortly', {
        retryAt: Math.min(...existing) + windowMs
      });
    }
    existing.push(now);
    accountAnalysisRequests.set(accountId, existing);
  }

  function enforceNameThrottle(accountId) {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const existing = (accountNameChecks.get(accountId) || [])
      .filter(timestamp => now - timestamp < windowMs);
    if (existing.length >= 5) {
      throw new HttpError(429, 'NAME_CHECK_THROTTLED', 'Too many name checks; try again later', {
        retryAt: Math.min(...existing) + windowMs
      });
    }
    existing.push(now);
    accountNameChecks.set(accountId, existing);
  }

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const requestId = requestIdFromRequest(req);
    const startedAt = Date.now();
    let responseFinished = false;
    req.gomimonRequestId = requestId;
    res.setHeader('X-GomiMon-Request-ID', requestId);

    if (req.path === '/v1/analyze') {
      logEvent('http.request', {
        requestId,
        method: req.method,
        path: req.path
      });
    }

    req.on('aborted', () => {
      logEvent('http.request_aborted', {
        requestId,
        path: req.path,
        durationMs: Date.now() - startedAt
      }, 'warn');
    });

    res.on('finish', () => {
      responseFinished = true;
      if (req.path === '/v1/analyze') {
        logEvent('http.response', {
          requestId,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt
        });
      }
    });

    res.on('close', () => {
      if (!responseFinished && req.path === '/v1/analyze') {
        logEvent('http.response_closed', {
          requestId,
          path: req.path,
          durationMs: Date.now() - startedAt
        }, 'warn');
      }
    });

    next();
  });

  app.post('/v1/billing/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res, next) => {
    try { await billing.webhook(req.body, req.get('stripe-signature')); res.json({ received: true }); }
    catch (error) { next(error); }
  });
  app.get('/billing/return', (req, res) => {
    const message = req.query.result === 'cancel' ? 'Checkout closed. Your plan has not changed.'
      : req.query.result === 'portal' ? 'Your billing changes will appear in GomiMon.'
      : 'Thank you. Payment may still be processing.';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GomiMon billing</title><style>body{font:18px system-ui;background:#fff9e8;color:#233c32;max-width:540px;margin:15vh auto;padding:24px}h1{font-size:36px}</style><h1>Back to your GomiMon</h1><p>${message}</p><p>Open GomiMon from your browser toolbar, then open Settings and select Refresh plan.</p><p>You can close this tab.</p></html>`);
  });
  app.use(express.json({ limit: '160kb' }));
  configureCors(app);
  registerMobileAuth(app, { db, createGoogleClient, signingKey });
  registerSafariAuth(app, { db, createGoogleClient, signingKey });
  app.get('/auth/safari/complete', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GomiMon sign-in</title><h1>Return to GomiMon</h1><p>Open the GomiMon Safari extension to check your sign-in. You can close this tab.</p></html>');
  });
  registerAppleAuth(app, { db });
  registerNativeGoogleAuth(app, { db });

  app.get('/healthz', async (req, res, next) => {
    try {
      await db.getUsage(0);
      res.json({ ok: true, service: 'gomimon-detector-api' });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/leaderboard', async (req, res, next) => {
    try {
      const period = validateLeaderboardPeriod(req.query.period);
      const entries = await db.getLeaderboard(period, LEADERBOARD_LIMIT);
      // Opt-ins, opt-outs, and new meals should be visible immediately. In
      // particular, a cached public response must never keep a departed pet
      // visible after the owner leaves the board.
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        period,
        ...(period === 'weekly' ? utcWeekBounds() : {}),
        entries
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/google/start', async (req, res, next) => {
    try {
      const redirectUri = String(req.query.redirect_uri || '');
      if (!extensionRedirectAllowed(redirectUri)) {
        throw new HttpError(400, 'INVALID_REDIRECT', 'Invalid extension redirect URI');
      }
      const oauthState = await makeOAuthState(redirectUri);
      const client = createGoogleClient();
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        state: oauthState.state,
        nonce: oauthState.nonce
      });
      res.redirect(authUrl);
    } catch (error) {
      next(error);
    }
  });

  app.get('/auth/google/callback', async (req, res, next) => {
    try {
      const oauthState = await readOAuthState(String(req.query.state || ''));
      if (!req.query.code) {
        throw new HttpError(400, 'OAUTH_CODE_MISSING', 'Google did not return an authorization code');
      }
      const client = createGoogleClient();
      const { tokens } = await client.getToken(String(req.query.code));
      if (!tokens.id_token) {
        throw new HttpError(502, 'OAUTH_TOKEN_MISSING', 'Google did not return an identity token');
      }
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      const profile = ticket.getPayload();
      const issuer = profile?.iss;
      if (!profile?.sub || !profile.email || profile.email_verified !== true ||
          profile.nonce !== oauthState.nonce ||
          !['https://accounts.google.com', 'accounts.google.com'].includes(issuer)) {
        throw new HttpError(403, 'GOOGLE_ACCOUNT_UNVERIFIED', 'A verified Google account is required');
      }
      const account = await db.upsertAccount({
        googleSubject: profile.sub,
        email: profile.email,
        displayName: profile.name
      });
      const token = await db.createSession(account.id);
      const separator = oauthState.redirectUri.includes('?') ? '&' : '?';
      res.redirect(`${oauthState.redirectUri}${separator}token=${encodeURIComponent(token)}`);
    } catch (error) {
      next(error);
    }
  });

  const requireAuth = authMiddleware(db);

  app.get('/v1/account', requireAuth, async (req, res, next) => {
    try {
      const [usage, gomimon, subscription] = await Promise.all([
        db.getUsage(req.account.id),
        db.getGomimonProfile(req.account.id),
        billing.state(req.account.id)
      ]);
      res.setHeader('Cache-Control', 'no-store');
      res.json(accountPayload(req.account, usage, gomimon, subscription));
    } catch (error) {
      next(error);
    }
  });

  for (const action of ['checkout', 'portal', 'refresh']) {
    app.post(`/v1/billing/${action}`, requireAuth, async (req, res, next) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        if (req.body && Object.keys(req.body).length) throw new BillingError(400, 'INVALID_BILLING_REQUEST', 'Billing options are selected by the server.');
        const result = await billing[action](req.account);
        if (action !== 'refresh') return res.json(result);
        const [usage, gomimon, subscription] = await Promise.all([
          db.getUsage(req.account.id), db.getGomimonProfile(req.account.id), billing.state(req.account.id)
        ]);
        res.json(accountPayload(req.account, usage, gomimon, subscription));
      } catch (error) { next(error); }
    });
  }

  app.post('/v1/gomimon/name', requireAuth, async (req, res, next) => {
    try {
      const candidate = validateGomimonName(req.body?.name);
      if (!await db.isGomimonNameAvailable(req.account.id, candidate.nameKey)) {
        throw new HttpError(409, 'NAME_TAKEN', 'That GomiMon name is already taken');
      }
      let judgement = await db.getNameModeration({
        nameHash: candidate.nameHash,
        rubricVersion: NAME_MODERATION_RUBRIC_VERSION
      });
      if (!judgement) {
        enforceNameThrottle(req.account.id);
        try {
          judgement = await moderateName({
            name: candidate.name,
            requestId: req.gomimonRequestId
          });
        } catch (error) {
          logEvent('gomimon.name_check_unavailable', {
            requestId: req.gomimonRequestId,
            nameHash: logHashPrefix(candidate.nameHash),
            ...errorDetails(error)
          }, 'warn');
          throw new HttpError(503, 'NAME_CHECK_UNAVAILABLE', 'Name safety check unavailable; try again later', {
            transient: true
          });
        }
        await db.putNameModeration({
          nameHash: candidate.nameHash,
          rubricVersion: NAME_MODERATION_RUBRIC_VERSION,
          ...judgement
        });
      }
      if (!judgement.allowed) {
        throw new HttpError(422, 'NAME_NOT_ALLOWED', 'Choose a different GomiMon name');
      }
      let gomimon;
      try {
        gomimon = await db.reserveGomimonName(req.account.id, candidate);
      } catch (error) {
        if (error?.code === 'NAME_TAKEN') {
          throw new HttpError(409, 'NAME_TAKEN', 'That GomiMon name is already taken');
        }
        throw error;
      }
      logEvent('gomimon.name_reserved', {
        requestId: req.gomimonRequestId,
        nameHash: logHashPrefix(candidate.nameHash),
        cached: Boolean(judgement.checkedAt)
      });
      res.json({ gomimon });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/leaderboard/join', requireAuth, async (req, res, next) => {
    try {
      const input = validateLeaderboardJoin(req.body);
      let gomimon;
      try {
        gomimon = await db.joinLeaderboard(req.account.id, input);
      } catch (error) {
        if (error?.code === 'PROFILE_REQUIRED') {
          throw new HttpError(409, 'PROFILE_REQUIRED', 'Reserve a GomiMon name before joining');
        }
        throw error;
      }
      res.json({ gomimon });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/leaderboard/leave', requireAuth, async (req, res, next) => {
    try {
      const gomimon = await db.leaveLeaderboard(req.account.id);
      if (!gomimon) throw new HttpError(409, 'PROFILE_REQUIRED', 'No GomiMon profile exists');
      res.json({ gomimon });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/leaderboard/meals', requireAuth, async (req, res, next) => {
    try {
      const events = validateMealEvents(req.body);
      try {
        res.json(await db.recordMealEvents(req.account.id, events));
      } catch (error) {
        if (error?.code === 'LEADERBOARD_NOT_JOINED') {
          throw new HttpError(409, 'LEADERBOARD_NOT_JOINED', 'Join the leaderboard before recording meals');
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/leaderboard/me', requireAuth, async (req, res, next) => {
    try {
      const period = validateLeaderboardPeriod(req.query.period);
      res.json({
        period,
        ...(period === 'weekly' ? utcWeekBounds() : {}),
        entry: await db.getLeaderboardRank(req.account.id, period)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/auth/signout', requireAuth, async (req, res, next) => {
    try {
      await db.revokeSession(req.sessionToken);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/v1/account', requireAuth, async (req, res, next) => {
    try {
      const appleIds = db.appleCredentialIds ? await db.appleCredentialIds(req.account.id) : [];
      if (db.withBillingAccount) await billing.deleteAccount(req.account);
      else await db.deleteAccount(req.account.id);
      if (appleIds.length) await db.processAppleRevocations(appleWebClient.revoke).catch(() => {});
      const appleRevocationPending = appleIds.length ? (await db.pendingAppleRevocations(appleIds)) > 0 : false;
      res.json({ ok: true, appleRevocationPending });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/analyze', requireAuth, async (req, res, next) => {
    const requestId = req.gomimonRequestId;
    let input;
    try {
      input = validateAnalysisInput(req.body);
      if (input.aiInsufficient && input.categoryIds.length === 0) {
        logEvent('analyze.insufficient', {
          requestId,
          platform: input.platform,
          contentType: input.contentType,
          chars: input.text.length,
          words: input.words,
          truncated: input.truncated,
          contentHash: logHashPrefix(input.contentHash)
        });
        res.json({
          label: 'insufficient',
          evidenceStatus: 'insufficient',
          aiProbability: null,
          evidenceProbability: null,
          categoryProbabilities: {},
          truncated: input.truncated,
          model: MODEL,
          rubricVersion: RUBRIC_VERSION,
          cached: false,
          quota: await db.getUsage(req.account.id)
        });
        return;
      }
    } catch (error) {
      logEvent('analyze.invalid_input', {
        requestId,
        ...errorDetails(error)
      }, 'warn');
      next(error);
      return;
    }

    logEvent('analyze.accepted', {
      requestId,
      platform: input.platform,
      contentType: input.contentType,
      chars: input.text.length,
      words: input.words,
      truncated: input.truncated,
      includeAi: input.includeAi,
      categories: input.categoryIds,
      contentHash: logHashPrefix(input.contentHash)
    });

    try {
      const cacheKey = `${req.account.id}:${input.contentHash}:${MODEL}:${RUBRIC_VERSION}`;
      const cached = await db.getCachedAnalysis({
        accountId: req.account.id,
        contentHash: input.contentHash,
        modelKey: MODEL,
        rubricVersion: RUBRIC_VERSION
      });
      if (cached) {
        logEvent('analyze.cache_hit', {
          requestId,
          platform: input.platform,
          contentType: input.contentType,
          contentHash: logHashPrefix(input.contentHash)
        });
        let cachedCategories = cached.category_probabilities || {};
        if (typeof cachedCategories === 'string') {
          try {
            cachedCategories = JSON.parse(cachedCategories);
          } catch (error) {
            cachedCategories = {};
          }
        }
        res.json({
          label: cached.label,
          evidenceStatus: cached.evidence_status,
          aiProbability: cached.ai_probability === null || cached.ai_probability === undefined
            ? null
            : Number(cached.ai_probability),
          evidenceProbability: cached.evidence_probability === null || cached.evidence_probability === undefined
            ? null
            : Number(cached.evidence_probability),
          categoryProbabilities: cachedCategories,
          truncated: cached.truncated,
          model: cached.model,
          rubricVersion: cached.rubric_version,
          cached: true,
          quota: await db.getUsage(req.account.id)
        });
        return;
      }

      const existing = inFlightAnalyses.get(cacheKey);
      if (existing) {
        logEvent('analyze.inflight_join', {
          requestId,
          platform: input.platform,
          contentType: input.contentType,
          contentHash: logHashPrefix(input.contentHash)
        });
        const result = await existing;
        res.json({ ...result, cached: true, quota: await db.getUsage(req.account.id) });
        return;
      }

      const analysis = (async () => {
        enforceAccountThrottle(req.account.id);

        let quota;
        let reservationDate;
        try {
          const reservation = await db.reserveCheck(req.account.id);
          reservationDate = reservation.usageDate;
          quota = {
            used: reservation.used,
            remaining: reservation.remaining,
            limit: reservation.limit
          };
        } catch (error) {
          if (error.code === 'ACCOUNT_QUOTA_EXCEEDED' || error.code === 'SERVER_QUOTA_EXCEEDED') {
            const usage = await db.getUsage(req.account.id).catch(() => null);
            throw new HttpError(429, 'QUOTA_EXCEEDED', error.message, {
              resetAt: usage?.resetAt,
              scope: error.code === 'SERVER_QUOTA_EXCEEDED' ? 'server' : 'account',
              quota: usage
            });
          }
          throw error;
        }

        try {
          logEvent('analyze.evaluation_start', {
            requestId,
            platform: input.platform,
            contentType: input.contentType,
            chars: input.text.length,
            words: input.words,
            truncated: input.truncated,
            includeAi: input.includeAi,
            categories: input.categoryIds,
            contentHash: logHashPrefix(input.contentHash)
          });
          const evaluated = await evaluate({ ...input, requestId });
          const normalized = {
            ...evaluated,
            categoryProbabilities: evaluated.categoryProbabilities || {}
          };
          const result = input.aiInsufficient
            ? {
              ...normalized,
              label: 'insufficient',
              evidenceStatus: 'insufficient',
              aiProbability: null,
              evidenceProbability: null
            }
            : normalized;
          logEvent('analyze.evaluation_success', {
            requestId,
            label: result.label,
            aiProbability: result.aiProbability,
            model: result.model
          });
          await db.insertAnalysis({
            accountId: req.account.id,
            contentHash: input.contentHash,
            modelKey: MODEL,
            result
          });
          return { ...result, cached: false, quota };
        } catch (error) {
          await db.releaseCheck(req.account.id, reservationDate);
          logEvent('analyze.evaluation_failure', {
            requestId,
            ...errorDetails(error)
          }, 'warn');
          throw new HttpError(502, 'ANALYSIS_UNAVAILABLE', 'The detector is temporarily unavailable', {
            transient: true,
            retryAt: error.retryAt,
            resetAt: error.resetAt,
            providerRequestId: error.requestId,
            causeCode: error.code
          });
        }
      })();
      inFlightAnalyses.set(cacheKey, analysis);
      try {
        res.json(await analysis);
      } finally {
        if (inFlightAnalyses.get(cacheKey) === analysis) inFlightAnalyses.delete(cacheKey);
      }
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof InputError || error?.type === 'entity.too.large') {
      const code = error.code || 'INVALID_REQUEST';
      return res.status(code === 'NAME_NOT_ALLOWED' ? 422 : 400).json({
        error: code,
        message: error.message,
        requestId: req.gomimonRequestId,
        serverRequestId: req.gomimonRequestId
      });
    }
    if (error instanceof HttpError || error instanceof BillingError) {
      if (error.code !== 'ANALYSIS_UNAVAILABLE') {
        logEvent('http.expected_error', {
          requestId: req.gomimonRequestId,
          ...errorDetails(error)
        }, 'warn');
      }
      return res.status(error.status).json({
        error: error.code,
        message: error.message,
        requestId: error.requestId || req.gomimonRequestId,
        serverRequestId: error.serverRequestId || req.gomimonRequestId,
        ...(error.providerRequestId ? { providerRequestId: error.providerRequestId } : {}),
        ...(error.causeCode ? { causeCode: error.causeCode } : {}),
        ...(error.retryAt ? { retryAt: error.retryAt } : {}),
        ...(error.resetAt ? { resetAt: error.resetAt } : {}),
        ...(error.scope ? { scope: error.scope, quota: error.quota } : {}),
        ...(typeof error.transient === 'boolean' ? { transient: error.transient } : {})
      });
    }
    logEvent('http.unhandled_error', {
      requestId: req.gomimonRequestId,
      ...errorDetails(error)
    }, 'error');
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'The request could not be completed' });
  });

  return app;
}
