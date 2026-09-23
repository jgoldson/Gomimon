(() => {
  'use strict';
  if (window !== window.top) return;
  const demo = location.protocol === 'file:' && location.pathname.endsWith('/demo.html');
  const platform = demo ? 'reddit' : window.GomiMonPlatforms?.fromUrl(location.href);
  if (!platform || (!demo && location.protocol !== 'https:')) return;
  const detector = platform === 'x' ? window.GomiMonXDetector : window.GomiMonRedditDetector;
  const policy = window.GomiMonDetectorModules?.policy;
  const states = new Map(), actions = new WeakMap(), cache = new Map();
  const session = Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  let settings = { automatic: false, categories: [], categoryStrength: 'balanced', enabledPlatforms: [], remoteReady: false };
  let timer, lastCount = -1, epoch = 0, pending = null, nextRequest = 0, requestNumber = 0;
  const send = payload => window.webkit.messageHandlers.gomimon.postMessage(payload);
  const enabled = () => settings.automatic && settings.enabledPlatforms.includes(platform) && (demo || platform !== 'x' || detector.isSupportedPage());
  const style = document.createElement('style');
  style.textContent = '.gomimon-post-marker,.gomimon-eaten-placeholder{font:600 13px -apple-system!important;color:#4937a5!important;background:#efebff!important;border:1px solid #d8cffb!important;border-radius:12px!important;padding:14px 18px!important;min-height:48px!important;position:relative!important;z-index:10!important;touch-action:manipulation!important;box-sizing:border-box!important;width:calc(100% - 16px)!important;text-align:center!important;margin:8px!important;cursor:pointer!important;display:block!important}';
  document.head.append(style);
  for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) {
    window.addEventListener(type, event => {
      const control = event.composedPath().find(node => actions.has(node));
      if (!control) return;
      event.stopImmediatePropagation();
      if (type === 'click') { event.preventDefault(); actions.get(control)(); }
    }, { capture: true, passive: false });
  }
  function control(label, className, action) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = className; button.textContent = label;
    actions.set(button, action); return button;
  }
  function restore(state, user = true) {
    state.boundary.style.display = state.display ?? '';
    state.button.style.removeProperty('display');
    state.placeholder?.remove(); state.placeholder = null; state.restored = user;
  }
  function feed(state, reason, labels = []) {
    if (state.placeholder || !state.item.isConnected) return;
    state.display = state.boundary.style.display;
    const label = reason === 'manual' ? 'Post eaten' : reason === 'ad' ? 'Ad eaten' : `${policy.categoryNames(labels).join(', ')} eaten`;
    state.placeholder = control(`${label} · Show post`, 'gomimon-eaten-placeholder', () => restore(state));
    state.boundary.before(state.placeholder); state.boundary.style.display = 'none';
    state.button.style.setProperty('display', 'none', 'important'); state.reason = reason;
    if (!state.credited) { state.credited = true; send({ type: 'meal', key: state.key, reason, demo }); }
  }
  function record(state) { return { contentType: 'post', snapshot: state.snapshot, extractionStatus: state.snapshot.extractionStatus, scores: state.scores }; }
  function matches(state) {
    if (!enabled() || state.restored || state.snapshot.isDiscussionPage) return [];
    if (settings.categories.includes('ads') && state.snapshot.isAd) return ['ads'];
    return policy?.matchingCategories(record(state), settings) || [];
  }
  function apply(state) {
    const labels = matches(state);
    if (labels.length) {
      const rect = state.item.getBoundingClientRect();
      if (state.placeholder || (rect.bottom > 0 && rect.top < innerHeight)) feed(state, labels[0] === 'ads' ? 'ad' : 'category', labels);
    }
    else if (state.placeholder && state.reason !== 'manual') restore(state, false);
  }
  function checks(snapshot) {
    const categories = settings.categories.filter(id => !['ads', 'ai_content'].includes(id));
    const includeAi = settings.categories.includes('ai_content') && snapshot.wordCount >= (platform === 'x' ? 10 : 30);
    return { categories, includeAi };
  }
  function cacheKey(snapshot, requested) { return JSON.stringify([snapshot.revision, requested]); }
  function request(state) {
    if (!enabled() || !settings.remoteReady || demo || pending || Date.now() < nextRequest || state.restored || state.snapshot.isDiscussionPage || state.snapshot.extractionStatus !== 'ready') return;
    const requested = checks(state.snapshot);
    if (!requested.includeAi && !requested.categories.length) return;
    const key = cacheKey(state.snapshot, requested);
    if (cache.has(key)) { state.scores = cache.get(key); apply(state); return; }
    const id = `${session}:${++requestNumber}`;
    pending = { id, state, key, revision: state.snapshot.revision, epoch };
    nextRequest = Date.now() + 2500; // One in flight, at most 24 starts/minute.
    const { text, title, body, subreddit, flair, quotedText, truncated } = state.snapshot;
    send({ type: 'analyze', id, input: { platform, contentType: 'post', text, title, body, subreddit, flair, quotedText: quotedText || '', truncated, ...requested } });
  }
  function scan() {
    for (const [item, state] of states) if (!item.isConnected) { state.placeholder?.remove(); state.button.remove(); states.delete(item); }
    const items = detector.findItems().filter(item => detector.isPost(item));
    for (const item of items) {
      const snapshot = detector.describe(item);
      if (!snapshot) continue;
      let state = states.get(item);
      if (state && (state.snapshot.key !== snapshot.key || state.snapshot.revision !== snapshot.revision)) {
        if (state.placeholder) restore(state, false);
        state.button.remove(); states.delete(item); state = null;
      }
      if (!state) {
        state = { item, snapshot, key: snapshot.key.includes('-session-') ? `${session}:${snapshot.key}` : snapshot.key, credited: false, restored: false };
        state.boundary = item.closest('a, [role="link"]') || item;
        state.button = control('Feed this post to GomiMon', 'gomimon-post-marker', () => feed(state, 'manual'));
        state.button.setAttribute('aria-label', `Feed post: ${snapshot.title || 'Social post'}`);
        state.boundary.after(state.button); states.set(item, state);
      }
      state.snapshot = snapshot;
      if (state.placeholder) { apply(state); continue; }
      const rect = item.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < innerHeight) { apply(state); if (!state.placeholder) request(state); }
    }
    if (lastCount !== items.length) { lastCount = items.length; send({ type: 'status', count: items.length }); }
  }
  function schedule() { if (!timer) timer = setTimeout(() => { timer = null; scan(); }, 100); }
  window.GomiMonMobile = {
    configure(value) {
      // Boolean accepted only for the local smoke fixture and old tests.
      const next = typeof value === 'boolean' ? { automatic: value, categories: ['ads'], enabledPlatforms: ['reddit'], remoteReady: false } : value;
      if (next.accountScope !== settings.accountScope || !next.remoteReady) cache.clear();
      settings = { categoryStrength: 'balanced', ...next }; epoch++;
      for (const state of states.values()) { if (!settings.remoteReady) state.scores = null; apply(state); }
      scan();
    },
    receive(id, result) {
      if (!pending || pending.id !== id) return;
      const request = pending; pending = null;
      const state = request.state;
      if (result.error) { nextRequest = Date.now() + Math.max(60000, result.retryAfterMs || 0); return; }
      if (request.epoch !== epoch || !state.item.isConnected || detector.describe(state.item)?.revision !== request.revision) { schedule(); return; }
      cache.set(request.key, result);
      if (cache.size > 1000) cache.delete(cache.keys().next().value);
      state.scores = result; apply(state); schedule();
    }
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['promoted', 'is-promoted', 'post-type', 'data-promoted', 'data-sponsored', 'data-ad-preview', 'sponsored'] });
  addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule);
  setInterval(() => { if (enabled() && settings.remoteReady) schedule(); }, 2600);
  scan();
})();
