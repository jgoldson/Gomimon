import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client();
export async function verifyNativeGoogleIdentity(identityToken, {
  client = googleClient, audience = process.env.GOOGLE_CLIENT_ID,
  iosClientId = process.env.GOOGLE_IOS_CLIENT_ID, now = Date.now
} = {}) {
  if (!audience || !iosClientId) throw new Error('Native Google sign-in is not configured');
  const ticket = await client.verifyIdToken({ idToken: identityToken, audience });
  const claims = ticket.getPayload();
  // The SDK requests a token for our server, issued to our iOS OAuth client.
  if (!claims || claims.azp !== iosClientId || typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.email !== 'string' || !claims.email || claims.email_verified !== true ||
      !Number.isFinite(claims.iat) || claims.iat < now() / 1000 - 600 ||
      !Number.isFinite(claims.exp) || claims.exp <= now() / 1000) throw new Error('Invalid Google identity');
  return claims;
}

export function registerNativeGoogleAuth(app, { db, verifyIdentity = verifyNativeGoogleIdentity,
  now = Date.now, configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_IOS_CLIENT_ID)
}) {
  const challenges = new Map();
  function prune() { for (const [id, value] of challenges) if (value.expires <= now()) challenges.delete(id); }
  async function signedInAccount(req) {
    const value = req.get('authorization') || '';
    return value.startsWith('Bearer ') ? db.findAccountBySession(value.slice(7)) : null;
  }
  app.post('/v1/auth/google/native/challenge', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!configured()) return res.status(503).json({ message: 'Google sign-in is being configured. Try again shortly.' });
      prune();
      if (challenges.size >= 1000) return res.status(429).json({ message: 'Sign-in busy. Try again shortly.' });
      const link = req.body?.link === true;
      const account = link ? await signedInAccount(req) : null;
      if (link && !account) return res.status(401).json({ message: 'Sign in before linking Google.' });
      const challengeId = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
      challenges.set(challengeId, { nonce, expires: now() + 300000, linkAccountId: account?.id ?? null });
      res.json({ challengeId, nonce });
    } catch (error) { next(error); }
  });
  app.post('/v1/auth/google/native/exchange', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store'); prune();
    const { challengeId, identityToken } = req.body || {};
    const challenge = typeof challengeId === 'string' ? challenges.get(challengeId) : null;
    if (!challenge || typeof identityToken !== 'string' || !identityToken || identityToken.length > 16000) {
      return res.status(400).json({ message: 'Google sign-in expired. Please try again.' });
    }
    challenges.delete(challengeId); // One attempt, consumed before verification or database awaits.
    let claims;
    try {
      claims = await verifyIdentity(identityToken);
      if (claims.nonce !== challenge.nonce) throw new Error('Invalid nonce');
    } catch {
      // Google library errors may contain the token; never forward/log them.
      return res.status(400).json({ message: 'Google sign-in could not be verified. Please try again.' });
    }
    try {
      const profile = { googleSubject: claims.sub, email: claims.email, displayName: claims.name };
      let account;
      if (challenge.linkAccountId !== null) {
        const signedIn = await signedInAccount(req);
        if (!signedIn || String(signedIn.id) !== String(challenge.linkAccountId)) {
          return res.status(401).json({ message: 'Sign in to the same GomiMon account before linking Google.' });
        }
        account = await db.linkGoogleAccount(signedIn.id, profile);
      } else {
        account = await db.upsertAccount(profile);
      }
      res.json({ token: await db.createSession(account.id), providers: await db.getAccountProviders(account.id) });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      next(error);
    }
  });
}
