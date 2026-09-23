// Shared social-feed detector composition root.
(function initializeGomiMonDetector(global) {
  'use strict';

  const platform = global.GomiMonPlatforms?.fromUrl(global.location?.href) || 'reddit';
  const detector = platform === 'x' ? global.GomiMonXDetector : global.GomiMonRedditDetector;
  const modules = global.GomiMonDetectorModules;
  if (!detector || !modules?.store || !modules?.policy || !modules?.scheduler || !modules?.renderer) return;

  const { createPostStore } = modules.store;
  const { evaluatePolicy, requestedJudgements } = modules.policy;
  const { createScheduler } = modules.scheduler;
  const { createRenderer } = modules.renderer;
  const { PROTOCOL_VERSION } = modules.revision;

  const DEFAULT_SETTINGS = {
    enabledPlatforms: ['reddit', 'x'],
    mode: 'manual',
    sensitivity: 'strict',
    categories: [],
    categoryStrength: 'balanced',
    showEatingAnimations: true,
    debug: false
  };
  const REMOTE_CATEGORIES = new Set([
    'politics',
    'promotions',
    'ragebait',
    'celebrity_gossip',
    'sports',
    'crypto'
  ]);
  const MIN_WORDS = global.GomiMonPlatforms?.registry[platform]?.minAiWords || 30;
  let active = false;
  const runtimeId = chrome.runtime.id;
  let contextInvalidated = false;
  const MAX_DIAGNOSTICS = 200;
  const SETTLE_MS = 300;
  const MAX_SETTLING_MS = 2000;
  const NEAR_MARGIN = 600;
  const CLIENT_ANALYSIS_TIMEOUT_MS = 20000;

  let settings = { ...DEFAULT_SETTINGS };
  let petEvolution = 'baby';
  let store;
  let renderer;
  let scheduler;
  let observer;
  let visibilityObserver;
  let initialized = false;
  let pageUrl = String(global.location?.href || '');
  let lastContextItem = null;
  let dirtyItems = new Set();
  let dirtyTimer = null;
  let cleanupTimer = null;
  let signedIn = true;
  const settleTimers = new Map();
  const settlingSince = new Map();
  const visibilityTimers = new Map();
  const diagnostics = [];

  function logDetectorEvent(level, event, fields = {}) {
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    const safeFields = { platform, ...fields };
    delete safeFields.quotedText;
    delete safeFields.text;
    delete safeFields.body;
    delete safeFields.title;
    diagnostics.push({ event, fields: safeFields, at: Date.now() });
    if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();
    logger(`[GomiMon Detector] ${event}`, JSON.stringify(safeFields));
  }

  function makeError(payload, fallback = 'Detector request failed') {
    const error = new Error(payload?.message || fallback);
    if (payload && typeof payload === 'object') {
      Object.assign(error, {
        code: payload.code || payload.error,
        status: payload.status,
        requestId: payload.requestId,
        serverRequestId: payload.serverRequestId,
        retryAt: payload.retryAt,
        resetAt: payload.resetAt,
        scope: payload.scope,
        quota: payload.quota,
        transient: payload.transient
      });
    }
    return error;
  }

  function callBackground(message, { timeoutMs = 15000, analysis = false } = {}) {
    if (contextInvalidated) return Promise.reject(makeError({ code: 'CONTEXT_INVALIDATED', message: 'Refresh this page to resume GomiMon.', transient: false }));
    const operationId = message.operationId;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (analysis && operationId) {
          try {
            chrome.runtime.sendMessage({ type: 'CANCEL_DETECTOR_ANALYSIS', operationId }, () => {
              void chrome.runtime.lastError;
            });
          } catch (error) {
            // The worker may already have been terminated; the watchdog still
            // converts the request into a bounded client failure.
          }
        }
        const error = makeError({
          code: 'DETECTOR_CLIENT_TIMEOUT',
          message: 'Detector request timed out in the extension',
          transient: true
        });
        reject(error);
      }, timeoutMs);

      function finish(callback, value) {
        if (/extension context invalidated/i.test(value?.message || '')) stopInvalidatedContext();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      }

      try {
        chrome.runtime.sendMessage(message, response => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            finish(reject, makeError({ code: 'EXTENSION_MESSAGE_FAILED', message: runtimeError.message, transient: true }));
            return;
          }
          if (!response) {
            finish(reject, makeError({ code: 'EMPTY_EXTENSION_RESPONSE', message: 'The detector returned no response', transient: true }));
            return;
          }
          if (response.success === false || response.state === 'error') {
            finish(reject, makeError(response.error || response, 'Detector request failed'));
            return;
          }
          finish(resolve, response);
        });
      } catch (error) {
        finish(reject, makeError({ code: 'EXTENSION_MESSAGE_FAILED', message: error.message, transient: true }));
      }
    });
  }

  function stopInvalidatedContext() {
    if (contextInvalidated) return;
    contextInvalidated = true;
    active = false;
    observer?.disconnect();
    visibilityObserver?.disconnect();
    clearTimeout(dirtyTimer);
    clearInterval(cleanupTimer);
    dirtyItems.clear();
    for (const record of store?.all() || []) {
      clearScheduling(record.key);
      for (const view of record.views.values()) renderer.detachView(view);
    }
    scheduler?.cancelAll('context_invalidated');
    const notice = document.createElement('div');
    notice.className = 'gomimon-refresh-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'GomiMon was updated. Refresh this page to resume checking posts. ';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh page';
    button.addEventListener('click', () => global.location.reload());
    notice.appendChild(button);
    document.body.appendChild(notice);
  }

  function isActive() {
    if (!contextInvalidated && runtimeId && !chrome.runtime?.id) stopInvalidatedContext();
    return !contextInvalidated && settings.enabledPlatforms.includes(platform) && (!detector.isSupportedPage || detector.isSupportedPage());
  }

  function syncActivity() {
    const next = isActive();
    if (active === next) return;
    active = next;
    if (!store) return;
    if (!next) {
      scheduler.cancelAll('platform_inactive');
      for (const record of store.all()) {
        clearScheduling(record.key);
        for (const view of [...record.views.values()]) {
          renderer.detachView(view);
          visibilityObserver?.unobserve(view.element);
          store.detachView(record.key, view.element);
        }
      }
      dirtyItems.clear();
      lastContextItem = null;
    } else {
      inspectRoot(document);
    }
  }

  function currentViewport(element) {
    if (!element?.isConnected || document.hidden) return { visible: false, near: false };
    const rect = element.getBoundingClientRect?.();
    if (!rect) return { visible: true, near: true };
    const visible = rect.bottom >= 0 && rect.top <= global.innerHeight;
    const near = rect.bottom >= -NEAR_MARGIN && rect.top <= global.innerHeight + NEAR_MARGIN;
    return { visible, near };
  }

  function snapshotForDescriptor(descriptor) {
    const snapshot = { ...descriptor };
    delete snapshot.element;
    delete snapshot.textContainer;
    return snapshot;
  }

  function recordViewport(record) {
    return Array.from(record.views.values()).reduce((result, view) => {
      result.visible ||= Boolean(view.visible);
      result.near ||= Boolean(view.near);
      return result;
    }, { visible: false, near: false });
  }

  function isRemoteCategory(category) {
    return REMOTE_CATEGORIES.has(category);
  }

  function remoteScanningEnabled() {
    return isActive() && (settings.mode === 'automatic' || settings.categories.includes('ai_content') || settings.categories.some(isRemoteCategory));
  }

  function isManualJob(job) {
    return job.source === 'manual';
  }

  function priorityFor(record, source) {
    if (source === 'manual') return 0;
    const viewport = recordViewport(record);
    if (viewport.visible) return record.contentType === 'post' ? 1 : 2;
    return record.contentType === 'post' ? 3 : 4;
  }

  function analysisRequestFor(record, force = false) {
    return requestedJudgements(record, settings, force);
  }

  function updatePolicy(record, presentation) {
    const policy = evaluatePolicy(record, settings);
    store.setPolicy(record.key, policy);
    if (isActive()) renderer.render(record, policy, presentation);
    return policy;
  }

  function effectId() {
    return global.crypto?.randomUUID?.() || `effect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function shouldAutoFeed(record, policy) {
    if (record.effect?.revision === record.revision && record.effect?.reason === policy.reason) return false;
    if (policy.reason === 'ai_likelihood') return settings.mode === 'automatic';
    if (policy.reason === 'category' || policy.reason === 'ad') {
      return settings.mode === 'automatic' || settings.categories.length > 0;
    }
    return false;
  }

  function feedEffect(record, policy) {
    if (!isActive() || !shouldAutoFeed(record, policy) || !signedIn) return;
    const id = effectId();
    store.setEffect(record.key, { effectId: id, revision: record.revision, reason: policy.reason, status: 'attempted' });
    callBackground({
      type: 'FEED_CONTENT',
      excerpt: (record.snapshot.text || record.snapshot.title || '').slice(0, 280),
      platform,
      itemKey: record.key,
      contentType: record.contentType,
      categories: modules.policy.historyCategories(record, settings, policy),
      source: policy.reason === 'category' || policy.reason === 'ad' ? 'category' : 'automatic',
      effectId: id
    }, { timeoutMs: 15000 }).then(response => {
      store.setEffect(record.key, {
        effectId: id,
        revision: record.revision,
        reason: policy.reason,
        status: response.deduplicated ? 'deduplicated' : 'applied'
      });
      logDetectorEvent('info', 'feed_effect_complete', {
        itemKey: record.key,
        revision: record.revision,
        effectId: id,
        reason: policy.reason,
        deduplicated: Boolean(response.deduplicated)
      });
    }).catch(error => {
      logDetectorEvent('warn', 'feed_effect_failed', {
        itemKey: record.key,
        revision: record.revision,
        effectId: id,
        reason: policy.reason,
        code: error.code,
        status: error.status
      });
    });
  }

  function applyRecord(record, presentation) {
    if (!isActive()) return;
    const policy = updatePolicy(record, presentation);
    if (policy.action === 'hide') feedEffect(record, policy);
    scheduleRecord(record);
  }

  function clearScheduling(key) {
    for (const [timerKey, timer] of visibilityTimers) {
      if (timerKey.startsWith(`${key}:`)) {
        clearTimeout(timer);
        visibilityTimers.delete(timerKey);
      }
    }
    const timer = settleTimers.get(key);
    if (timer) clearTimeout(timer);
    settleTimers.delete(key);
  }

  function settleRecord(key) {
    const record = store.get(key);
    if (!record || record.extractionStatus !== 'settling') return;
    const started = settlingSince.get(key) || Date.now();
    settlingSince.set(key, started);
    const elapsed = Date.now() - started;
    if (elapsed < MAX_SETTLING_MS) {
      const timer = setTimeout(() => {
        settleTimers.delete(key);
        reconcileRecordViews(record);
      }, SETTLE_MS);
      settleTimers.set(key, timer);
    }
    updatePolicy(record);
  }

  function scheduleRecord(record, force = false) {
    if (!isActive()) return;
    if (!scheduler || !record || record.extractionStatus !== 'ready') {
      if (record?.extractionStatus === 'settling') settleRecord(record.key);
      return;
    }
    const request = analysisRequestFor(record, force);
    if (!request) {
      if (!record.scores && record.snapshot.wordCount < MIN_WORDS) {
        store.commitScores(record.key, record.revision, {
          label: 'insufficient',
          evidenceStatus: 'insufficient',
          aiProbability: null,
          evidenceProbability: null,
          categoryProbabilities: {},
          truncated: record.snapshot.truncated,
          model: null,
          rubricVersion: null
        });
        updatePolicy(record);
      }
      return;
    }
    if (!signedIn && (request.includeAi || request.categories.length > 0)) {
      store.setAnalysisStatus(record.key, 'blocked', null, makeError({ code: 'UNAUTHENTICATED', message: 'Sign in to use the detector' }));
      updatePolicy(record);
      return;
    }
    if (record.override && !force) return;
    if (!force && record.analysisStatus === 'blocked' &&
      ['UNAUTHENTICATED', 'QUOTA_EXCEEDED'].includes(record.error?.code)) return;
    if (!force && (record.analysisStatus === 'queued' || record.analysisStatus === 'running' || record.analysisStatus === 'retry_wait')) return;
    if (force && record.analysisStatus === 'running' && record.job?.revision === record.revision) return;
    const viewport = recordViewport(record);
    if (!force && (!remoteScanningEnabled() || !viewport.near || document.hidden)) return;
    const source = force ? 'manual' : 'automatic';
    const delay = force ? 0 : viewport.visible ? 300 : 750;
    const scheduleKey = `${record.key}:${record.revision}:${request.includeAi}:${request.categories.join(',')}:${source}`;
    if (visibilityTimers.has(scheduleKey)) return;
    const timer = setTimeout(() => {
      visibilityTimers.delete(scheduleKey);
      const current = store.get(record.key);
      if (!isActive() || !current || current.revision !== record.revision) return;
      const currentViewportState = recordViewport(current);
      if (!force && (!currentViewportState.near || document.hidden)) return;
      scheduler.enqueue({
        itemKey: current.key,
        revision: current.revision,
        contentType: current.contentType,
        snapshot: current.snapshot,
        includeAi: request.includeAi,
        categories: request.categories,
        priority: priorityFor(current, source),
        source,
        force
      });
    }, delay);
    visibilityTimers.set(scheduleKey, timer);
  }

  function reconcileRecordViews(record) {
    for (const view of record.views.values()) {
      if (!view.element?.isConnected) continue;
      const descriptor = detector.describe(view.element);
      if (descriptor) reconcileElement(view.element, descriptor);
    }
    applyRecord(record);
  }

  function findOwner(element) {
    for (const record of store.all()) {
      if (Array.from(record.views.values()).some(view => view.element === element)) return record;
    }
    return null;
  }

  function reconcileElement(element, suppliedDescriptor = null) {
    if (!isActive() || !element?.isConnected || detector.isOwnedNode(element)) return null;
    const descriptor = suppliedDescriptor || detector.describe(element);
    const previousOwner = findOwner(element);
    if (previousOwner && previousOwner.key !== descriptor?.key) {
      for (const view of previousOwner.views.values()) {
        if (view.element === element) renderer.detachView(view);
      }
      store.detachView(previousOwner.key, element);
      if (recordViewport(previousOwner).near === false) {
        scheduler.cancelItem(previousOwner.key, 'recycled');
        clearScheduling(previousOwner.key);
      }
    }
    if (!descriptor) return null;

    const previousRevision = store.get(descriptor.key)?.revision || null;
    const record = store.upsert(snapshotForDescriptor(descriptor));
    if (!record) return null;
    if (previousRevision && previousRevision !== record.revision) {
      scheduler.cancelItem(record.key, 'revision_changed');
      clearScheduling(record.key);
      settlingSince.delete(record.key);
    }
    store.attachView(record.key, element);
    store.setVisibility(record.key, element, currentViewport(element));
    if (visibilityObserver) {
      try {
        visibilityObserver.observe(element);
      } catch (error) {
        logDetectorEvent('warn', 'visibility_observer_failed', {
          itemKey: record.key,
          message: error.message
        });
      }
    }

    if (record.extractionStatus === 'settling') {
      settlingSince.set(record.key, settlingSince.get(record.key) || Date.now());
      settleRecord(record.key);
    } else {
      settlingSince.delete(record.key);
      const timer = settleTimers.get(record.key);
      if (timer) clearTimeout(timer);
      settleTimers.delete(record.key);
    }
    applyRecord(record);
    return record;
  }

  function markDirty(element) {
    const item = detector.closestItem(element);
    if (!item || detector.isOwnedNode(element)) return;
    dirtyItems.add(item);
    if (dirtyTimer) return;
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      const items = Array.from(dirtyItems);
      dirtyItems.clear();
      items.forEach(item => reconcileElement(item));
    }, 0);
  }

  function inspectRoot(root) {
    if (!isActive()) return;
    detector.findItems(root).forEach(item => reconcileElement(item));
  }

  function detachRemovedItem(element) {
    const descriptor = detector.describe(element);
    if (!descriptor) return;
    const record = store.get(descriptor.key);
    if (!record) return;
    for (const view of record.views.values()) {
      if (view.element === element) renderer.detachView(view);
    }
    store.detachView(record.key, element);
    if (recordViewport(record).near === false) {
      scheduler.cancelItem(record.key, 'removed');
      clearScheduling(record.key);
    }
    logDetectorEvent('info', 'item_detached', {
      itemKey: record.key,
      revision: record.revision,
      views: record.views.size,
      reason: 'removed'
    });
  }

  function detachRemovedTree(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    detector.findItems(node).forEach(detachRemovedItem);
  }

  function handleMutations(mutations) {
    syncActivity();
    if (!active) return;
    const currentUrl = String(global.location?.href || '');
    if (currentUrl && currentUrl !== pageUrl) {
      pageUrl = currentUrl;
      inspectRoot(document);
    }
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        markDirty(mutation.target.parentElement);
        continue;
      }
      if (mutation.type === 'attributes') {
        if (!detector.isOwnedNode(mutation.target)) markDirty(mutation.target);
        continue;
      }
      const removedContent = Array.from(mutation.removedNodes || []).filter(node =>
        !detector.isOwnedNode(node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)
      );
      removedContent.forEach(detachRemovedTree);
      const relevantNodes = Array.from(mutation.addedNodes || []).filter(node =>
        node.nodeType === Node.ELEMENT_NODE && !detector.isOwnedNode(node)
      );
      if (relevantNodes.length > 0) {
        relevantNodes.forEach(node => {
          inspectRoot(node);
          markDirty(node);
        });
      }
      if (mutation.target && !detector.isOwnedNode(mutation.target)) {
        const item = detector.closestItem(mutation.target);
        if (item && relevantNodes.length === 0 && removedContent.length > 0) markDirty(item);
      }
    }
  }

  function handleVisibility(entries) {
    syncActivity();
    if (!active) return;
    for (const entry of entries) {
      const element = entry.target;
      const descriptor = detector.describe(element);
      if (!descriptor) continue;
      let record = store.get(descriptor.key);
      if (!record || !Array.from(record.views.values()).some(view => view.element === element)) {
        record = reconcileElement(element, descriptor);
      }
      if (!record) continue;
      store.setVisibility(record.key, element, {
        visible: Boolean(entry.isIntersecting && currentViewport(element).visible),
        near: Boolean(entry.isIntersecting)
      });
      if (!entry.isIntersecting && !recordViewport(record).near) {
        scheduler.cancelItem(record.key, 'out_of_view');
      }
      applyRecord(record);
    }
  }

  function applySettings(nextSettings) {
    settings = {
      ...settings,
      ...(nextSettings || {}),
      categories: Array.isArray(nextSettings?.categories) ? [...new Set(nextSettings.categories)] : settings.categories
    };
    syncActivity();
    for (const record of store.all()) {
      clearScheduling(record.key);
      scheduler.cancelItem(record.key, 'settings_changed');
      applyRecord(record);
    }
    logDetectorEvent('info', 'settings_applied', {
      mode: settings.mode,
      sensitivity: settings.sensitivity,
      categories: settings.categories,
      categoryStrength: settings.categoryStrength,
      debug: settings.debug
    });
  }

  function handleAnalysisComplete(job, response) {
    if (!signedIn || !isActive()) return;
    const record = store.get(job.itemKey);
    if (!record) return;
    if (response?.revision && response.revision !== record.revision) {
      reconcileRecordViews(record);
      return;
    }
    const result = response?.result;
    if (!result || typeof result !== 'object') {
      const error = makeError({ code: 'MALFORMED_ANALYSIS_RESPONSE', message: 'The detector returned an invalid score', transient: false });
      store.setAnalysisStatus(record.key, 'unavailable', null, error);
      updatePolicy(record);
      return;
    }
    const committed = store.commitScores(record.key, job.revision, result);
    if (!committed) {
      reconcileRecordViews(record);
      return;
    }
    logDetectorEvent('info', 'analysis_success', {
      itemKey: record.key,
      revision: record.revision,
      operationId: job.operationId,
      requestId: response.requestId,
      serverRequestId: response.serverRequestId,
      cached: Boolean(response.cached),
      queueWaitMs: job.startedAt && job.queuedAt ? job.startedAt - job.queuedAt : undefined,
      requestDurationMs: job.startedAt ? Date.now() - job.startedAt : undefined,
      chars: record.snapshot.text.length,
      words: record.snapshot.wordCount,
      extractionMethod: record.snapshot.extractionMethod,
      completeness: record.snapshot.extractionCompleteness,
      label: result.label,
      aiProbability: result.aiProbability
    });
    applyRecord(record);
  }

  function handleAnalysisError(job, error) {
    const record = store.get(job.itemKey);
    if (!record || record.revision !== job.revision) return;
    if (error?.code === 'UNAUTHENTICATED') {
      signedIn = false;
      scheduler.cancelAll('authentication_required');
    }
    const blocked = ['UNAUTHENTICATED', 'QUOTA_EXCEEDED', 'THROTTLED'].includes(error?.code);
    store.setAnalysisStatus(record.key, blocked ? 'blocked' : 'unavailable', null, error);
    logDetectorEvent('warn', 'analysis_failure', {
      itemKey: record.key,
      revision: record.revision,
      operationId: job.operationId,
      requestId: error?.requestId,
      serverRequestId: error?.serverRequestId,
      code: error?.code,
      status: error?.status
    });
    updatePolicy(record);
  }

  function handleAction({ action, itemKey }) {
    if (!isActive()) return;
    const record = store.get(itemKey);
    if (!record) return;
    if (action === 'restore') {
      store.setOverride(itemKey, true);
      applyRecord(record);
      logDetectorEvent('info', 'item_restored', { itemKey, revision: record.revision });
      return;
    }
    if (action === 'analyze' || action === 'retry') {
      store.setOverride(itemKey, false);
      scheduler.cancelItem(itemKey, 'manual_retry');
      scheduleRecord(record, true);
      return;
    }
    if (action === 'feed') {
      const policy = evaluatePolicy(record, settings);
      const id = effectId();
      callBackground({
        type: 'FEED_CONTENT',
      excerpt: (record.snapshot.text || record.snapshot.title || '').slice(0, 280),
        platform,
        itemKey: record.key,
        contentType: record.contentType,
        source: 'manual',
        categories: modules.policy.historyCategories(record, settings, policy),
        effectId: id
      }).then(response => {
        store.setEffect(record.key, { effectId: id, revision: record.revision, reason: 'manual_feed', status: response.deduplicated ? 'deduplicated' : 'applied' });
        store.setManualHidden(record.key, true);
        store.setOverride(record.key, false);
        applyRecord(store.get(record.key), { evolution: response.evolution });
      }).catch(error => {
        logDetectorEvent('warn', 'manual_feed_failed', { itemKey, code: error.code, status: error.status });
      });
    }
  }

  function setupRuntime() {
    store = createPostStore();
    renderer = createRenderer({
      detector,
      onAction: handleAction,
      getEvolution: () => petEvolution,
      getSettings: () => settings
    });
    scheduler = createScheduler({
      maxQueue: 20,
      maxRunning: 2,
      retryDelayMs: 2000,
      maxRetries: 1,
      canRun: job => {
        if (!isActive()) return false;
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision || record.extractionStatus !== 'ready') return false;
        if (!signedIn && (job.includeAi || job.categories?.length)) return false;
        const currentRequest = analysisRequestFor(record, Boolean(job.force));
        if (!currentRequest || currentRequest.includeAi !== Boolean(job.includeAi) ||
          currentRequest.categories.join(',') !== (job.categories || []).join(',')) return false;
        if (!isManualJob(job)) {
          const viewport = recordViewport(record);
          if (document.hidden || (!viewport.visible && !viewport.near) || record.override) return false;
        }
        return true;
      },
      execute: job => callBackground({
        type: 'ANALYZE_CONTENT',
        platform,
        quotedText: job.snapshot.quotedText || '',
        protocolVersion: PROTOCOL_VERSION,
        operationId: job.operationId,
        itemKey: job.itemKey,
        revision: job.revision,
        priority: job.priority,
        contentType: job.contentType,
        text: job.snapshot.text,
        title: job.snapshot.title,
        body: job.snapshot.body,
        subreddit: job.snapshot.subreddit,
        flair: job.snapshot.flair,
        truncated: job.snapshot.truncated,
        includeAi: job.includeAi,
        categories: job.categories
      }, { timeoutMs: CLIENT_ANALYSIS_TIMEOUT_MS, analysis: true }),
      onQueued: job => {
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision) return;
        job.queuedAt = Date.now();
        const previousState = record.analysisStatus;
        store.setAnalysisStatus(record.key, 'queued', job);
        logDetectorEvent('info', 'analysis_queued', {
          itemKey: job.itemKey,
          revision: job.revision,
          operationId: job.operationId,
          source: job.source,
          priority: job.priority,
          includeAi: job.includeAi,
          categories: job.categories,
          chars: record.snapshot.text.length,
          words: record.snapshot.wordCount,
          extractionMethod: record.snapshot.extractionMethod,
          completeness: record.snapshot.extractionCompleteness,
          previousState,
          newState: 'queued'
        });
        updatePolicy(record);
      },
      onStart: job => {
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision) return;
        job.startedAt = Date.now();
        const previousState = record.analysisStatus;
        store.setAnalysisStatus(record.key, 'running', job);
        logDetectorEvent('info', 'analysis_start', {
          itemKey: job.itemKey,
          revision: job.revision,
          operationId: job.operationId,
          source: job.source,
          priority: job.priority,
          queueWaitMs: job.queuedAt ? job.startedAt - job.queuedAt : undefined,
          chars: record.snapshot.text.length,
          words: record.snapshot.wordCount,
          extractionMethod: record.snapshot.extractionMethod,
          completeness: record.snapshot.extractionCompleteness,
          previousState,
          newState: 'running'
        });
        updatePolicy(record);
      },
      onComplete: handleAnalysisComplete,
      onDeferred: (job, outcome) => {
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision) return;
        store.setAnalysisStatus(record.key, 'retry_wait', job, makeError({ code: outcome.reason || 'DEFERRED', message: outcome.scope === 'server' ? 'Detector service is at capacity. Try again after reset.' : 'Daily checks used. Open GomiMon Settings to view your plan.', scope: outcome.scope, retryAt: outcome.retryAt, transient: true }));
        logDetectorEvent('info', 'analysis_deferred', { itemKey: job.itemKey, revision: job.revision, retryAt: outcome.retryAt, reason: outcome.reason });
        updatePolicy(record);
      },
      onRetry: (job, error) => {
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision) return;
        store.setAnalysisStatus(record.key, 'retry_wait', job, error);
        logDetectorEvent('warn', 'analysis_retry_scheduled', { itemKey: job.itemKey, revision: job.revision, attempt: job.attempt, code: error.code });
        updatePolicy(record);
      },
      onError: handleAnalysisError,
      onCancel: (job, reason) => {
        if (contextInvalidated) return;
        try {
          chrome.runtime.sendMessage({
            type: 'CANCEL_DETECTOR_ANALYSIS',
            operationId: job.operationId,
            reason
          }, () => {
            void chrome.runtime.lastError;
          });
        } catch (error) {
          logDetectorEvent('warn', 'analysis_cancel_failed', {
            itemKey: job.itemKey,
            operationId: job.operationId,
            reason,
            message: error.message
          });
        }
      },
      onDrop: (job, reason) => {
        const record = store.get(job.itemKey);
        if (!record || record.revision !== job.revision) return;
        if (record.job?.operationId === job.operationId || record.analysisStatus === 'queued') {
          store.setAnalysisStatus(record.key, 'idle');
          logDetectorEvent('info', 'analysis_dropped', { itemKey: job.itemKey, revision: job.revision, reason });
          updatePolicy(record);
        }
      }
    });

    visibilityObserver = 'IntersectionObserver' in global
      ? new global.IntersectionObserver(handleVisibility, { rootMargin: `${NEAR_MARGIN}px 0px`, threshold: 0.1 })
      : null;
    syncActivity();
    inspectRoot(document);
    if (visibilityObserver) {
      for (const record of store.all()) {
        for (const view of record.views.values()) visibilityObserver.observe(view.element);
      }
    }

    observer = new MutationObserver(handleMutations);
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'href', 'aria-selected', 'thingid', 'data-fullname', 'id', 'permalink', 'data-permalink',
          'post-title', 'slot', 'data-post-click-location', 'data-testid', 'data-promoted', 'data-ad-preview', 'post-type', 'aria-label',
          'is-promoted', 'promoted', 'data-sponsored', 'sponsored'
        ]
      });
    }
    global.addEventListener?.('popstate', () => {
      if (pageUrl === global.location.href) return;
      pageUrl = global.location.href;
      syncActivity();
      inspectRoot(document);
    });
    global.addEventListener?.('hashchange', () => inspectRoot(document));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) inspectRoot(document);
    });
    // Covers History API navigation even when the route changes without DOM mutations.
    const routeTimer = setInterval(() => {
      if (!isActive() && contextInvalidated) { clearInterval(routeTimer); return; }
      if (pageUrl !== String(global.location?.href || '')) {
        pageUrl = String(global.location?.href || '');
        syncActivity();
        inspectRoot(document);
      }
    }, 500);
    global.addEventListener('pagehide', () => clearInterval(routeTimer), { once: true });
    cleanupTimer = setInterval(() => {
      store.cleanup();
    }, 60000);
    initialized = true;
    logDetectorEvent('info', 'detector_initialized', { protocolVersion: PROTOCOL_VERSION, mode: settings.mode });
  }

  async function loadSettings() {
    try {
      const stats = await chrome.storage?.local?.get({ evolution: 'baby' });
      petEvolution = stats?.evolution || 'baby';
    } catch {
      petEvolution = 'baby';
    }
    try {
      const response = await callBackground({ type: 'GET_DETECTOR_SETTINGS' });
      if (response.settings) settings = {
        ...DEFAULT_SETTINGS,
        ...response.settings,
        categories: Array.isArray(response.settings.categories) ? response.settings.categories : []
      };
    } catch (error) {
      logDetectorEvent('warn', 'settings_unavailable', { code: error.code });
    }
  }

  function handleMessage(message, sendResponse) {
    if (message.type === 'PURGE_AT_POINT') {
      if (!isActive()) { sendResponse({ success: false }); return true; }
      const target = lastContextItem || document.elementFromPoint(message.info?.x, message.info?.y);
      const item = detector.closestItem(target);
      const descriptor = detector.describe(item);
      if (descriptor) {
        const record = store.upsert(snapshotForDescriptor(descriptor));
        store.attachView(record.key, descriptor.element);
        store.setManualHidden(record.key, true);
        applyRecord(record);
      }
      sendResponse({ success: Boolean(descriptor) });
      return true;
    }
    if (message.type === 'GOMIMON_FEED_RESULT') {
      // The analysis policy owns hiding. A late feed acknowledgement can update
      // diagnostics, but it cannot collapse a post by itself.
      logDetectorEvent('info', 'feed_acknowledged', { itemKey: message.itemKey, effectId: message.effectId, source: message.source });
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'DETECTOR_SETTINGS_UPDATED') {
      applySettings(message.settings || {});
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'DETECTOR_QUOTA_UPDATED') {
      if (message.quota?.remaining > 0) {
        for (const record of store.all()) {
          if (record.error?.code === 'QUOTA_EXCEEDED' && record.error?.scope !== 'server') {
            store.setAnalysisStatus(record.key, 'idle');
            updatePolicy(record);
          }
        }
        scheduler.resumeAccountQuotaDeferred();
        inspectRoot(document);
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'DETECTOR_AUTH_UPDATED') {
      signedIn = Boolean(message.signedIn);
      if (!signedIn) {
        scheduler.cancelAll('signed_out');
        for (const record of store.all()) {
          store.setAnalysisStatus(record.key, 'blocked', null, makeError({ code: 'UNAUTHENTICATED', message: 'Sign in to use the detector' }));
          updatePolicy(record);
        }
      } else {
        signedIn = true;
        for (const record of store.all()) {
          if (record.error?.code === 'UNAUTHENTICATED') store.setAnalysisStatus(record.key, 'idle');
        }
        inspectRoot(document);
      }
      sendResponse({ success: true });
      return true;
    }
    if (message.type === 'GET_DETECTOR_DIAGNOSTICS') {
      sendResponse({
        success: true,
        protocolVersion: PROTOCOL_VERSION,
        events: diagnostics.slice(),
        records: store.diagnostics(),
        scheduler: scheduler.diagnostics()
      });
      return true;
    }
    return false;
  }

  function initialize() {
    if (contextInvalidated) return;
    document.addEventListener('contextmenu', event => {
      lastContextItem = detector.closestItem(event.target);
    }, true);
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => handleMessage(message, sendResponse));
    chrome.storage?.onChanged?.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.evolution) {
        petEvolution = changes.evolution.newValue || 'baby';
      }
      if (namespace === 'local' && (changes.detectorSettings || changes.onboardingStage)) {
        callBackground({ type: 'GET_DETECTOR_SETTINGS' }).then(response => applySettings(response.settings)).catch(() => {});
      }
    });
    setupRuntime();
  }

  loadSettings().finally(initialize);
})(globalThis);
