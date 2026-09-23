// Background-side analysis broker. It provides shared concurrency, a bounded
// rate budget, persistent score caching, and request coalescing across tabs.
export function createDetectorBroker({
  request,
  storage,
  getSessionNamespace,
  getServiceUrl,
  now = () => Date.now(),
  maxConcurrent = 2,
  maxPerMinute = 25,
  cacheTtlMs = 24 * 60 * 60 * 1000,
  maxCacheEntries = 1000,
  maxCacheBytes = 2 * 1024 * 1024
} = {}) {
  const CACHE_KEY = 'detectorScoreCacheV1';
  const CONTRACT_VERSION = 'social-detector-v3';
  const PROTOCOL_VERSION = 2;
  const inFlight = new Map();
  const operationEntries = new Map();
  const requestTimes = [];
  let active = 0;
  let cacheLoaded = false;
  let cache = { version: 1, entries: {} };
  let cacheLoadPromise;
  let cacheWritePromise = Promise.resolve();
  let pausedUntil = 0;
  let recentFailures = [];
  let cacheGeneration = 0;

  function operationId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function fallbackRevision(input) {
    return `${CONTRACT_VERSION}:${hashString(JSON.stringify({
      platform: input.platform || 'reddit',
      quotedText: input.quotedText || '',
      contentType: input.contentType,
      text: input.text,
      title: input.title,
      body: input.body,
      subreddit: input.subreddit,
      flair: input.flair,
      truncated: input.truncated
    }))}`;
  }

  function normalizeScores(value = {}) {
    return {
      label: value.label ?? null,
      evidenceStatus: value.evidenceStatus || null,
      aiProbability: value.aiProbability === null || value.aiProbability === undefined ? null : Number(value.aiProbability),
      evidenceProbability: value.evidenceProbability === null || value.evidenceProbability === undefined
        ? null
        : Number(value.evidenceProbability),
      categoryProbabilities: { ...(value.categoryProbabilities || {}) },
      truncated: Boolean(value.truncated),
      model: value.model || null,
      rubricVersion: value.rubricVersion || null,
      assessedAt: value.assessedAt || now()
    };
  }

  function mergeScores(existing, incoming) {
    const next = normalizeScores(existing || {});
    const fresh = normalizeScores(incoming || {});
    const incompatible = Boolean(
      existing?.model && fresh.model && existing.model !== fresh.model
    ) || Boolean(
      existing?.rubricVersion && fresh.rubricVersion && existing.rubricVersion !== fresh.rubricVersion
    );
    if (incompatible) return fresh;
    if (fresh.label !== null) next.label = fresh.label;
    if (fresh.evidenceStatus !== null) next.evidenceStatus = fresh.evidenceStatus;
    if (fresh.aiProbability !== null && Number.isFinite(fresh.aiProbability)) next.aiProbability = fresh.aiProbability;
    if (fresh.evidenceProbability !== null && Number.isFinite(fresh.evidenceProbability)) {
      next.evidenceProbability = fresh.evidenceProbability;
    }
    next.categoryProbabilities = {
      ...(existing?.categoryProbabilities || {}),
      ...(incoming?.categoryProbabilities || {})
    };
    next.truncated = fresh.truncated || Boolean(existing?.truncated);
    next.model = fresh.model || existing?.model || null;
    next.rubricVersion = fresh.rubricVersion || existing?.rubricVersion || null;
    next.assessedAt = now();
    return next;
  }

  function missingJudgements(entry, input) {
    const hasProbability = value => value !== null && value !== undefined && Number.isFinite(Number(value));
    return {
      includeAi: Boolean(input.includeAi) && !hasProbability(entry?.scores?.aiProbability),
      categories: (input.categories || []).filter(category =>
        !hasProbability(entry?.scores?.categoryProbabilities?.[category])
      )
    };
  }

  function pruneRateHistory() {
    const cutoff = now() - 60000;
    while (requestTimes.length && requestTimes[0] < cutoff) requestTimes.shift();
  }

  function rateRetryAt() {
    pruneRateHistory();
    return requestTimes.length < maxPerMinute ? now() : requestTimes[0] + 60000;
  }

  function cacheBaseKey(namespace, serviceUrl, revision) {
    return `${namespace}|${serviceUrl}|${CONTRACT_VERSION}|${revision}`;
  }

  async function loadCache() {
    if (cacheLoaded) return cache;
    if (!cacheLoadPromise) {
      cacheLoadPromise = storage.get(CACHE_KEY).then(value => {
        const candidate = value?.[CACHE_KEY];
        if (candidate?.version === 1 && candidate.entries && typeof candidate.entries === 'object') {
          cache = candidate;
        }
        cacheLoaded = true;
        return cache;
      }).catch(() => {
        cacheLoaded = true;
        return cache;
      });
    }
    return cacheLoadPromise;
  }

  function trimCache() {
    const entries = Object.entries(cache.entries)
      .sort((left, right) => Number(left[1].lastUsedAt || 0) - Number(right[1].lastUsedAt || 0));
    while (entries.length > maxCacheEntries) {
      const oldest = entries.shift();
      if (oldest) delete cache.entries[oldest[0]];
    }
    while (JSON.stringify(cache).length > maxCacheBytes && entries.length > 0) {
      const oldest = entries.shift();
      if (oldest) delete cache.entries[oldest[0]];
    }
  }

  function persistCache() {
    trimCache();
    cacheWritePromise = cacheWritePromise
      .catch(() => undefined)
      .then(() => storage.set({ [CACHE_KEY]: cache }));
    return cacheWritePromise;
  }

  async function clearCache() {
    cacheGeneration += 1;
    await loadCache();
    cache = { version: 1, entries: {} };
    await persistCache();
  }

  function cancelAll(reason = 'cancelled') {
    cacheGeneration += 1;
    const error = new Error(`Detector analysis ${reason}`);
    error.code = reason === 'signed_out' ? 'UNAUTHENTICATED' : 'DETECTOR_CANCELLED';
    error.status = reason === 'signed_out' ? 401 : 499;
    error.transient = false;
    for (const [operation, entry] of operationEntries) {
      entry.consumers.get(operation)?.reject(error);
      operationEntries.delete(operation);
      entry.consumers.delete(operation);
    }
    for (const entry of inFlight.values()) {
      for (const consumer of entry.consumers.values()) consumer.reject(error);
      entry.consumers.clear();
      entry.controller.abort();
    }
  }

  function isFresh(entry) {
    return Boolean(entry && now() - Number(entry.analyzedAt || 0) <= cacheTtlMs);
  }

  function failurePauses(error) {
    const status = Number(error?.status);
    return error?.transient !== false && (error?.code === 'DETECTOR_TIMEOUT' || status === 408 || status === 429 || status >= 500);
  }

  async function completeFromCache(input, namespace, serviceUrl, revision) {
    await loadCache();
    const key = cacheBaseKey(namespace, serviceUrl, `${input.platform || 'reddit'}:${revision}:${fallbackRevision(input)}`);
    const entry = cache.entries[key];
    if (!isFresh(entry)) {
      if (entry) delete cache.entries[key];
      return { key, entry: null, missing: { includeAi: Boolean(input.includeAi), categories: [...(input.categories || [])] } };
    }
    entry.lastUsedAt = now();
    await persistCache();
    const missing = missingJudgements(entry, input);
    return { key, entry, missing };
  }

  function setCacheEntry(key, existing, result) {
    cache.entries[key] = {
      scores: mergeScores(existing?.scores, result),
      analyzedAt: now(),
      lastUsedAt: now()
    };
  }

  function finishEntry(entry, error, result) {
    inFlight.delete(entry.key);
    active = Math.max(0, active - 1);
    operationEntries.forEach((candidate, id) => {
      if (candidate === entry) operationEntries.delete(id);
    });
    for (const consumer of entry.consumers.values()) {
      if (error) consumer.reject(error);
      else consumer.resolve({ ...result, operationId: consumer.operationId });
    }
    entry.consumers.clear();
  }

  function startNetwork(input, namespace, serviceUrl, revision, cacheInfo, missing, key) {
    const controller = new AbortController();
    const entry = {
      key,
      controller,
      consumers: new Map(),
      startedAt: now(),
      generation: cacheGeneration
    };
    inFlight.set(key, entry);
    active += 1;
    requestTimes.push(now());
    Promise.resolve()
      .then(() => request({
        ...input,
        revision,
        includeAi: missing.includeAi,
        categories: missing.categories,
        serviceUrl,
        signal: controller.signal
      }))
      .then(async response => {
        if (entry.generation !== cacheGeneration) {
          const invalidated = new Error('Detector cache generation was invalidated');
          invalidated.code = 'DETECTOR_CANCELLED';
          invalidated.status = 499;
          invalidated.transient = false;
          finishEntry(entry, invalidated);
          return;
        }
        const result = mergeScores(cacheInfo?.entry?.scores, response.payload || response.result || response);
        await loadCache();
        // The in-flight key includes the requested judgment set, but the
        // reusable cache key must be shared by every compatible partial result
        // for this revision so AI and category scores can be merged.
        setCacheEntry(cacheInfo.key, cacheInfo?.entry, result);
        await persistCache();
        recentFailures = [];
        finishEntry(entry, null, {
          state: 'complete',
          protocolVersion: PROTOCOL_VERSION,
          itemKey: input.itemKey,
          revision,
          result,
          requestId: response.requestId || null,
          serverRequestId: response.serverRequestId || null,
          cached: false,
          quota: response.payload?.quota
        });
      })
      .catch(error => {
        if (failurePauses(error)) {
          recentFailures = recentFailures.filter(timestamp => now() - timestamp < 30000);
          recentFailures.push(now());
          if (recentFailures.length >= 3) pausedUntil = now() + 30000;
        }
        finishEntry(entry, error);
      });

    return { entry };
  }

  async function analyze(input) {
    const operation = input.operationId || operationId();
    const namespace = await getSessionNamespace();
    if (!namespace) {
      const error = new Error('Sign in to use the detector');
      error.code = 'UNAUTHENTICATED';
      error.status = 401;
      throw error;
    }
    const serviceUrl = input.serviceUrl || await getServiceUrl();
    const revision = input.revision || fallbackRevision(input);
    const cacheInfo = await completeFromCache(input, namespace, serviceUrl, revision);
    if (cacheInfo.entry && !cacheInfo.missing.includeAi && cacheInfo.missing.categories.length === 0) {
      return {
        state: 'complete',
        protocolVersion: PROTOCOL_VERSION,
        operationId: operation,
        itemKey: input.itemKey,
        revision,
        result: cacheInfo.entry.scores,
        requestId: null,
        serverRequestId: null,
        cached: true
      };
    }
    if (pausedUntil > now()) return {
      state: 'deferred',
      protocolVersion: PROTOCOL_VERSION,
      operationId: operation,
      retryAt: pausedUntil,
      reason: 'service_pause'
    };
    pruneRateHistory();
    if (active >= maxConcurrent || requestTimes.length >= maxPerMinute) {
      return {
        state: 'deferred',
        protocolVersion: PROTOCOL_VERSION,
        operationId: operation,
        retryAt: rateRetryAt(),
        reason: active >= maxConcurrent ? 'concurrency' : 'rate_limit'
      };
    }

    const key = `${cacheInfo.key}|${cacheInfo.missing.includeAi ? 'ai' : ''}|${cacheInfo.missing.categories.sort().join(',')}`;
    let entry = inFlight.get(key);
    if (!entry) {
      const started = startNetwork(input, namespace, serviceUrl, revision, cacheInfo, cacheInfo.missing, key);
      entry = started.entry;
    }
    return new Promise((resolve, reject) => {
      entry.consumers.set(operation, { resolve, reject, operationId: operation });
      operationEntries.set(operation, entry);
    });
  }

  function cancel(operation) {
    const entry = operationEntries.get(operation);
    if (!entry) return false;
    operationEntries.delete(operation);
    entry.consumers.delete(operation);
    if (entry.consumers.size === 0) entry.controller.abort();
    return true;
  }

  function diagnostics() {
    return {
      active,
      inFlight: inFlight.size,
      cacheEntries: Object.keys(cache.entries).length,
      pausedUntil,
      rateCount: requestTimes.length
    };
  }

  return { analyze, cancel, cancelAll, clearCache, diagnostics, loadCache };
}
