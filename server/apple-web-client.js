import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';
import { verifyAppleIdentity } from './apple-auth.js';

export function appleWebConfig() {
  const clientId = process.env.APPLE_WEB_CLIENT_ID;
  const callback = new URL('/auth/apple/web/callback', process.env.BASE_URL || 'https://gomimon-api.goldentechlabs.com').href;
  if (!clientId || !process.env.APPLE_SIGNIN_KEY_ID || !process.env.APPLE_SIGNIN_PRIVATE_KEY_PATH || !process.env.APPLE_TOKEN_ENCRYPTION_KEY) throw Object.assign(new Error('Apple sign-in is not configured'), { status: 503 });
  return { clientId, callback };
}
async function clientSecret(clientId) {
  const key = await importPKCS8(readFileSync(process.env.APPLE_SIGNIN_PRIVATE_KEY_PATH, 'utf8'), 'ES256');
  return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_SIGNIN_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID || '72UJTW8297').setSubject(clientId).setAudience('https://appleid.apple.com')
    .setIssuedAt().setExpirationTime('5m').sign(key);
}
async function applePost(path, body) {
  const response = await fetch(`https://appleid.apple.com/auth/${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Apple authorization service failed');
  return response;
}
export const appleWebClient = {
  authorizationURL({ state, nonce }) {
    const { clientId, callback } = appleWebConfig();
    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', response_mode: 'form_post', scope: 'email', state, nonce });
    return url.href;
  },
  async exchange(code, nonce) {
    const { clientId, callback } = appleWebConfig();
    const response = await applePost('token', { grant_type: 'authorization_code', code, redirect_uri: callback, client_id: clientId, client_secret: await clientSecret(clientId) });
    const tokens = await response.json();
    const claims = await verifyAppleIdentity(tokens.id_token, { clientIds: [clientId] });
    if (!claims.sub || claims.nonce !== nonce || !tokens.refresh_token) throw new Error('Invalid Apple authorization');
    const email = ['true', true].includes(claims.email_verified) ? claims.email : null;
    return { appleSubject: claims.sub, email, clientId, refreshToken: tokens.refresh_token };
  },
  async revoke({ clientId, token }) {
    await applePost('revoke', { client_id: clientId, client_secret: await clientSecret(clientId), token, token_type_hint: 'refresh_token' });
  }
};
