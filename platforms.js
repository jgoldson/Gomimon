// Shared by classic content scripts and the extension's ES modules.
(function attachPlatforms(global) {
  'use strict';
  const registry = Object.freeze({
    reddit: Object.freeze({ id: 'reddit', name: 'Reddit', hosts: Object.freeze(['reddit.com']), minAiWords: 30 }),
    x: Object.freeze({ id: 'x', name: 'X', hosts: Object.freeze(['x.com', 'twitter.com']), minAiWords: 10 })
  });
  const ids = Object.freeze(Object.keys(registry));
  function fromUrl(value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return ids.find(id => registry[id].hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) || null;
    } catch { return null; }
  }
  function supportsPage(id, value) {
    if (fromUrl(value) !== id) return false;
    return id !== 'x' || /^\/home\/?$/u.test(new URL(value).pathname);
  }
  function normalize(value) {
    return Array.isArray(value) ? ids.filter(id => value.includes(id)) : [...ids];
  }
  const matches = Object.freeze(ids.flatMap(id => registry[id].hosts.map(host => `*://*.${host}/*`)));
  global.GomiMonPlatforms = Object.freeze({ registry, ids, fromUrl, supportsPage, normalize, matches });
})(globalThis);
