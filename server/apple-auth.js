import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const hash = value => createHash('sha256').update(value).digest('hex');
const audiences = () => (process.env.APPLE_CLIENT_IDS || 'com.goldentechlabs.gomimon.prototype').split(',').map(s => s.trim()).filter(Boolean);

export async function verifyAppleIdentity(identityToken, { keys = appleKeys, clientIds = audiences() } = {}) {
  const { payload } = await jwtVerify(identityToken, keys, {
    issuer: 'https://appleid.apple.com', audience: clientIds, algorithms: ['RS256'], maxTokenAge: '10m'
  });
  return payload;
}
export function registerAppleAuth(app, { db, verifyIdentity = verifyAppleIdentity, now = Date.now }) {
  const challenges = new Map();
  function prune() { for (const [id, challenge] of challenges) if (challenge.expires <= now()) challenges.delete(id); }
  async function signedInAccount(req) {
    const value = req.get('authorization') || '';
    return value.startsWith('Bearer ') ? db.findAccountBySession(value.slice(7)) : null;
  }
  app.get('/v1/auth/providers', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const account = await signedInAccount(req);
      if (!account) return res.status(401).json({ message: 'Sign in to manage linked accounts.' });
      res.json({ providers: await db.getAccountProviders(account.id) });
    } catch (error) { next(error); }
  });
  app.post('/v1/auth/apple/challenge', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store'); prune();
      if (challenges.size >= 1000) return res.status(429).json({ message: 'Sign-in busy. Try again shortly.' });
      const link = req.body?.link === true;
      const account = link ? await signedInAccount(req) : null;
      if (link && !account) return res.status(401).json({ message: 'Sign in before linking Apple.' });
      const nonce = randomBytes(32).toString('base64url'), id = randomBytes(32).toString('base64url');
      challenges.set(id, { nonceHash: hash(nonce), expires: now() + 300000, linkAccountId: account?.id ?? null });
      res.json({ challengeId: id, nonce });
    } catch (error) { next(error); }
  });
  app.post('/v1/auth/apple/exchange', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); prune();
    const id = req.body?.challengeId, identityToken = req.body?.identityToken;
    const challenge = typeof id === 'string' ? challenges.get(id) : null;
    if (!challenge || typeof identityToken !== 'string' || identityToken.length > 16000) return res.status(400).json({ message: 'Apple sign-in expired. Please try again.' });
    // A challenge has exactly one attempt, even if token verification fails.
    challenges.delete(id);
    try {
      const claims = await verifyIdentity(identityToken);
      if (typeof claims.sub !== 'string' || !claims.sub || claims.nonce !== challenge.nonceHash) throw new Error('Invalid Apple identity');
      const email = claims.email && (claims.email_verified === true || claims.email_verified === 'true') ? claims.email : null;
      let account;
      if (challenge.linkAccountId) {
        const signedIn = await signedInAccount(req);
        if (!signedIn || String(signedIn.id) !== String(challenge.linkAccountId)) return res.status(401).json({ message: 'Sign in to the same GomiMon account before linking Apple.' });
        account = await db.linkAppleAccount(signedIn.id, { appleSubject: claims.sub });
      } else {
        // Never merge by email: Apple relay addresses and existing accounts must
        // be linked explicitly while authenticated to the destination account.
        account = await db.upsertAppleAccount({ appleSubject: claims.sub, email, displayName: null });
      }
      res.json({ token: await db.createSession(account.id), providers: await db.getAccountProviders(account.id) });
    } catch (error) {
      const status = error.status === 409 ? 409 : 400;
      res.status(status).json({ message: status === 409 ? error.message : 'Apple sign-in could not be verified. Please try again.' });
    }
  });
}
