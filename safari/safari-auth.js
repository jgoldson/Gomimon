// The pending PKCE transaction survives Safari suspending its background worker.
// No session token travels through a browser URL or a content script.
const KEY = 'safariAuthTransaction';
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function createSafariAuth({ api, complete, crypto = globalThis.crypto, fetch = globalThis.fetch, now = Date.now }) {
  let completing = false;
  const storage = api.storage.local;
  async function cancel() { await storage.remove(KEY); }
  async function start(serviceUrl, { provider = 'google', link = false, token = null } = {}) {
    if (!['google', 'apple'].includes(provider)) throw new Error('Unsupported sign-in provider.');
    const service = new URL(serviceUrl);
    if (service.protocol !== 'https:') throw new Error('Safari sign-in requires HTTPS.');
    const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
    const state = encode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const pending = { verifier, state, provider, link, token, origin: service.origin, expires: now() + 600000 };
    await storage.set({ [KEY]: pending });
    const url = new URL('/auth/safari/start', service);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('state', state);
    url.searchParams.set('provider', provider);
    try {
      let destination = url.href;
      if (link) {
        if (!token) throw new Error('Sign in before linking accounts.');
        const response = await fetch(`${service.origin}/v1/auth/safari/link/start`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ provider, state, codeChallenge: challenge }), signal: AbortSignal.timeout(20000), redirect: 'error', credentials: 'omit'
        });
        if (!response.ok) throw new Error('Could not start account linking.');
        destination = (await response.json()).url;
        const target = new URL(destination);
        if (target.protocol !== 'https:' || !['appleid.apple.com', 'accounts.google.com'].includes(target.hostname)) throw new Error('Invalid sign-in destination.');
      }
      const tab = await api.tabs.create({ url: destination });
      await storage.set({ [KEY]: { ...pending, tabId: tab.id } });
    } catch (error) { await cancel(); throw error; }
    return { signedIn: false, pending: true };
  }
  async function updated(tabId, change) {
    if (!change.url || completing) return;
    const pending = (await storage.get(KEY))[KEY];
    if (!pending || completing) return;
    if (pending.expires <= now()) { await cancel(); return; }
    const url = new URL(change.url);
    if (tabId !== pending.tabId || url.origin !== pending.origin || url.pathname !== '/auth/safari/complete' || url.searchParams.get('state') !== pending.state) return;
    completing = true;
    try {
      if (url.searchParams.has('error')) { await cancel(); return; }
      const code = url.searchParams.get('code');
      if (!code) return;
      const response = await fetch(`${pending.origin}/v1/auth/safari/exchange`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(pending.link ? { Authorization: `Bearer ${pending.token}` } : {}) },
        body: JSON.stringify({ code, codeVerifier: pending.verifier }),
        signal: AbortSignal.timeout(20000), credentials: 'omit', redirect: 'error'
      });
      if (!response.ok) throw new Error('Safari sign-in expired or failed. Please try again.');
      const { token, provider, linked } = await response.json();
      if (provider !== pending.provider || Boolean(linked) !== pending.link) throw new Error('Sign-in provider mismatch.');
      if (typeof token !== 'string' || !token) throw new Error('Missing sign-in session.');
      // A sign-out/new attempt while the exchange ran invalidates this result.
      if ((await storage.get(KEY))[KEY]?.state !== pending.state) return;
      await cancel();
      await complete(token);
      await api.tabs.update(tabId, { url: api.runtime.getURL('popup.html') });
    } catch (error) {
      if ((await storage.get(KEY))[KEY]?.state === pending.state) await cancel();
      throw error;
    } finally { completing = false; }
  }
  api.tabs.onUpdated.addListener((id, change) => { updated(id, change).catch(() => {}); });
  api.tabs.onRemoved.addListener(async id => {
    if ((await storage.get(KEY))[KEY]?.tabId === id) await cancel();
  });
  return { start, cancel, updated };
}
