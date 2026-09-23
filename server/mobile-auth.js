import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, decodeJwt } from 'jose';

const CALLBACK = 'gomimon://auth/callback';
const AUDIENCE = 'gomimon-mobile';
const digest = value => createHash('sha256').update(value).digest('base64url');

// Authorization codes are short-lived, single-use and bound to a device-held
// PKCE verifier. Never put a GomiMon session token into a custom-scheme URL.
export function registerMobileAuth(app, { db, createGoogleClient, signingKey, now = Date.now, channel = 'mobile', callback = CALLBACK }) {
  const audience = channel === 'safari' ? 'gomimon-safari' : AUDIENCE;
  const codes = new Map();
  const prune = () => { for (const [key, value] of codes) if (value.expires <= now()) codes.delete(key); };
  app.post(`/v1/auth/${channel}/link/start`, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const authorization = req.get('authorization') || '';
      const account = authorization.startsWith('Bearer ') ? await db.findAccountBySession(authorization.slice(7)) : null;
      if (!account) return res.status(401).json({ message: 'Sign in before linking Google.' });
      const { codeChallenge, state } = req.body || {};
      if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge || '') || !/^[A-Za-z0-9_-]{32,128}$/.test(state || '')) return res.status(400).json({ message: 'Invalid linking request.' });
      const ticket = await new SignJWT({ challenge: codeChallenge, clientState: state, linkAccountId: account.id })
        .setProtectedHeader({ alg: 'HS256' }).setAudience('gomimon-provider-link').setIssuedAt().setExpirationTime('5m').sign(signingKey());
      res.json({ ticket });
    } catch (error) { next(error); }
  });
  app.get(`/auth/${channel}/start`, async (req, res, next) => {
    try {
      let challenge = String(req.query.code_challenge || '');
      let clientState = String(req.query.state || '');
      let linkAccountId = null;
      if (req.query.link_ticket) {
        try {
          const { payload } = await jwtVerify(String(req.query.link_ticket), signingKey(), { audience: 'gomimon-provider-link', algorithms: ['HS256'] });
          challenge = payload.challenge; clientState = payload.clientState; linkAccountId = payload.linkAccountId;
        } catch { return res.status(400).json({ message: 'Account-linking request expired. Try again.' }); }
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{32,128}$/.test(clientState)) {
        return res.status(400).json({ error: { message: 'Invalid mobile sign-in request' } });
      }
      const nonce = randomBytes(32).toString('base64url');
      const state = await new SignJWT({ nonce, challenge, clientState, linkAccountId })
        .setProtectedHeader({ alg: 'HS256' }).setAudience(audience).setIssuedAt().setExpirationTime('10m').sign(signingKey());
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(createGoogleClient().generateAuthUrl({ scope: ['openid', 'email', 'profile'], prompt: 'select_account', state, nonce }));
    } catch (error) { next(error); }
  });
  // Share Google's already-registered server callback; extension states continue
  // through the existing extension route, unchanged.
  app.get('/auth/google/callback', async (req, res, next) => {
    let claims;
    try { claims = decodeJwt(String(req.query.state || '')); } catch { return next(); }
    if (claims.aud !== audience) return next();
    try {
      const { payload } = await jwtVerify(String(req.query.state), signingKey(), { audience, algorithms: ['HS256'] });
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.error) return res.redirect(`${callback}?error=cancelled&state=${encodeURIComponent(payload.clientState)}`);
      if (typeof req.query.code !== 'string') return res.status(400).send('Missing authorization code');
      const client = createGoogleClient();
      const { tokens } = await client.getToken(req.query.code);
      if (!tokens.id_token) throw new Error('Google did not return an identity token');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      const profile = ticket.getPayload();
      if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== payload.nonce ||
          !['https://accounts.google.com', 'accounts.google.com'].includes(profile.iss)) return res.status(403).send('Verified account required');
      prune();
      if (codes.size >= 1000) return res.status(503).send('Sign-in busy. Try again.');
      const verifiedProfile = { googleSubject: profile.sub, email: profile.email, displayName: profile.name };
      const account = payload.linkAccountId ? { id: payload.linkAccountId } : await db.upsertAccount(verifiedProfile);
      const code = randomBytes(32).toString('base64url');
      codes.set(digest(code), { accountId: account.id, challenge: payload.challenge, expires: now() + 60000, linkProfile: payload.linkAccountId ? verifiedProfile : null });
      res.redirect(`${callback}?code=${code}&state=${encodeURIComponent(payload.clientState)}`);
    } catch { res.status(400).send('Mobile sign-in expired or failed. Return to GomiMon and try again.'); }
  });
  app.post(`/v1/auth/${channel}/exchange`, async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      prune();
      const code = String(req.body?.code || '');
      const verifier = String(req.body?.codeVerifier || '');
      const key = digest(code), entry = codes.get(key);
      if (!entry || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) ||
          !timingSafeEqual(Buffer.from(digest(verifier)), Buffer.from(entry.challenge))) {
        return res.status(400).json({ error: { message: 'Sign-in expired or invalid. Try again.' } });
      }
      codes.delete(key); // Consume synchronously before any awaited work.
      if (entry.linkProfile) {
        const authorization = req.get('authorization') || '';
        const account = authorization.startsWith('Bearer ') ? await db.findAccountBySession(authorization.slice(7)) : null;
        if (!account || String(account.id) !== String(entry.accountId)) return res.status(401).json({ message: 'Sign in to the same GomiMon account before linking Google.' });
        try { await db.linkGoogleAccount(account.id, entry.linkProfile); }
        catch (error) { if (error.status === 409) return res.status(409).json({ message: error.message }); throw error; }
      }
      res.json({ token: await db.createSession(entry.accountId) });
    } catch (error) { next(error); }
  });
}
