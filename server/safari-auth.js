import express from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { appleWebClient } from './apple-web-client.js';

const digest = value => createHash('sha256').update(value).digest('base64url');
const audience = 'gomimon-safari-v2';
const valid = (value, min = 43, max = min) => typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(value);
export function registerSafariAuth(app, { db, createGoogleClient, signingKey, apple = appleWebClient, now = Date.now }) {
  const transactions = new Map(), codes = new Map();
  const prune = () => { for (const map of [transactions, codes]) for (const [id, value] of map) if (value.expires <= now()) map.delete(id); };
  const accountFor = req => db.findAccountBySession((req.get('authorization') || '').replace(/^Bearer /, ''));
  async function begin({ provider, challenge, state, accountId = null }) {
    if (!['apple', 'google'].includes(provider) || !valid(challenge) || !valid(state, 32, 128)) throw Object.assign(new Error('Invalid sign-in request'), { status: 400 });
    prune(); if (transactions.size >= 1000) throw Object.assign(new Error('Sign-in busy. Try again.'), { status: 429 });
    const id = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const signedState = await new SignJWT({ id, provider }).setProtectedHeader({ alg: 'HS256' }).setAudience(audience).setIssuedAt().setExpirationTime('10m').sign(signingKey());
    const url = provider === 'apple' ? apple.authorizationURL({ state: signedState, nonce }) : createGoogleClient().generateAuthUrl({ scope: ['openid', 'email', 'profile'], prompt: 'select_account', state: signedState, nonce });
    transactions.set(id, { provider, challenge, state, nonce, accountId, expires: now() + 600000 });
    return url;
  }
  app.get('/auth/safari/start', async (req, res, next) => {
    try { res.setHeader('Cache-Control', 'no-store'); res.redirect(await begin({ provider: req.query.provider || 'google', challenge: req.query.code_challenge, state: req.query.state })); }
    catch (error) { next(error); }
  });
  app.post('/v1/auth/safari/link/start', async (req, res, next) => {
    try {
      const account = await accountFor(req);
      if (!account) return res.status(401).json({ message: 'Sign in before linking a provider.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ url: await begin({ provider: req.body?.provider, challenge: req.body?.codeChallenge, state: req.body?.state, accountId: account.id }) });
    } catch (error) { next(error); }
  });
  async function callback(req, res, next, provider, input) {
    try {
      const { payload } = await jwtVerify(String(input.state || ''), signingKey(), { audience, algorithms: ['HS256'] });
      prune(); const transaction = transactions.get(payload.id);
      if (!transaction || transaction.provider !== provider || payload.provider !== provider) throw new Error('Invalid transaction');
      transactions.delete(payload.id); // Consume before contacting either provider.
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      const destination = new URL('https://unused.invalid/auth/safari/complete');
      destination.searchParams.set('state', transaction.state);
      if (input.error) destination.searchParams.set('error', 'cancelled');
      else {
        if (typeof input.code !== 'string' || input.code.length > 4096) throw new Error('Invalid authorization code');
        let profile;
        if (provider === 'apple') profile = await apple.exchange(input.code, transaction.nonce);
        else {
          const client = createGoogleClient();
          const { tokens } = await client.getToken(input.code);
          const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
          const claims = ticket.getPayload();
          if (!claims?.sub || !claims.email || claims.email_verified !== true || claims.nonce !== transaction.nonce || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Invalid Google identity');
          profile = { googleSubject: claims.sub, email: claims.email, displayName: claims.name };
        }
        if (codes.size >= 1000) throw new Error('Sign-in busy');
        const code = randomBytes(32).toString('base64url');
        codes.set(digest(code), { ...transaction, profile, expires: now() + 60000 });
        destination.searchParams.set('code', code);
      }
      res.redirect(303, destination.pathname + destination.search);
    } catch { res.status(400).send('Sign-in expired or failed. Return to GomiMon and try again.'); }
  }
  app.get('/auth/google/callback', (req, res, next) => {
    try { if (decodeJwt(String(req.query.state || '')).aud !== audience) return next(); } catch { return next(); }
    return callback(req, res, next, 'google', req.query);
  });
  app.post('/auth/apple/web/callback', express.urlencoded({ extended: false, limit: '24kb' }), (req, res, next) => callback(req, res, next, 'apple', req.body));
  app.post('/v1/auth/safari/exchange', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store'); prune();
      const { code, codeVerifier } = req.body || {};
      const entry = typeof code === 'string' ? codes.get(digest(code)) : null;
      if (!entry || !valid(codeVerifier, 43, 128) || !timingSafeEqual(Buffer.from(digest(codeVerifier)), Buffer.from(entry.challenge))) return res.status(400).json({ message: 'Sign-in expired or invalid.' });
      codes.delete(digest(code));
      let account;
      if (entry.accountId) {
        account = await accountFor(req);
        if (!account || String(account.id) !== String(entry.accountId)) return res.status(401).json({ message: 'Sign in to the same account before linking.' });
        if (entry.provider === 'apple') await db.linkAppleAccount(account.id, entry.profile);
        else await db.linkGoogleAccount(account.id, entry.profile);
      } else account = entry.provider === 'apple' ? await db.upsertAppleAccount(entry.profile) : await db.upsertAccount(entry.profile);
      if (entry.provider === 'apple') await db.saveAppleCredential(account.id, entry.profile.clientId, entry.profile.refreshToken);
      res.json({ token: await db.createSession(account.id), provider: entry.provider, linked: Boolean(entry.accountId) });
    } catch (error) { next(error); }
  });
}
