import { HISTORY_KEY, appendSlopHistory } from './slop-history.js';
// GomiMon Background Service Worker (Refactored)
// Handles pet state, timers, feeding logic with proper error handling

import {
  PLATFORMS,
  HUNGER_DECREASE_RATE,
  HUNGER_TICK_MINUTES,
  LOW_HUNGER_THRESHOLD,
  HIGH_GLITCH_THRESHOLD,
  GLITCH_CRASH_THRESHOLD,
  MAX_FEEDS_PER_MINUTE,
  FEED_COOLDOWN_MS,
  EVOLUTION_NAMES,
  DEFAULT_STATS,
  FOOD_TYPES,
  ANIMATION_DURATION,
  VALIDATION_LIMITS,
  debugLog,
  sanitizeStats,
  DEFAULT_DETECTOR_SETTINGS,
  DETECTOR_API_URL,
  DETECTOR_SETTINGS_KEY,
  DETECTOR_SESSION_KEY,
  sanitizeDetectorSettings,
  LEADERBOARD_PENDING_KEY,
  LEADERBOARD_STATE_KEY,
  validatePetName
} from './constants.js';
import { buildFeedUpdate } from './feed-logic.js';
import { createDetectorBroker } from './detector-broker.js';

const SAFARI_RELEASE = chrome.runtime.getURL('').startsWith('safari-web-extension:');
const AI_CONSENT_VERSION = 1;
const AI_CONSENT_KEY = 'gomimonAIConsent';
let consentGeneration = 0;
const sensitiveRequests = new Set();
async function hasAIConsent() {
  if (!SAFARI_RELEASE) return true;
  const stored = await chrome.storage.local.get(AI_CONSENT_KEY);
  return stored[AI_CONSENT_KEY]?.version === AI_CONSENT_VERSION && stored[AI_CONSENT_KEY]?.accepted === true;
}

// State management
let offscreenDocumentPromise = null;
const injectedTabs = new Set();
const feedTimestamps = [];
const activeFeedKeys = new Set();
const completedFeedEffects = new Map();
const detectorOperationOwners = new Map();
const FEED_EFFECT_DEDUPE_KEY = 'gomimonCompletedFeedEffectsV1';
let lastFeedTime = 0;

// Storage lock to serialize pet updates across overlapping events.
let storageOperationTail = Promise.resolve();

// Error reporting
function reportError(context, error) {
  console.error(`[GomiMon ${context}]`, error);

  // Store recent errors for debugging
  chrome.storage.local.get(['recentErrors']).then(({ recentErrors = [] }) => {
    recentErrors.push({
      context,
      message: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });

    // Keep only last 10 errors
    if (recentErrors.length > VALIDATION_LIMITS.MAX_STORED_ERRORS) {
      recentErrors = recentErrors.slice(-VALIDATION_LIMITS.MAX_STORED_ERRORS);
    }

    chrome.storage.local.set({ recentErrors }).catch(e =>
      console.error('Failed to store error:', e)
    );
  }).catch(e => console.error('Failed to get errors:', e));
}

// Safe storage operations with locking
function withStorageLock(operation) {
  const next = storageOperationTail.then(operation, operation);
  storageOperationTail = next.catch(() => undefined);
  return next;
}

// Get stats with defaults and validation
async function getStats() {
  try {
    const stats = await chrome.storage.local.get(DEFAULT_STATS);
    return sanitizeStats(stats);
  } catch (error) {
    reportError('getStats', error);
    return { ...DEFAULT_STATS };
  }
}

async function getDetectorSettings() {
  try {
    const stored = await chrome.storage.local.get({
      [DETECTOR_SETTINGS_KEY]: DEFAULT_DETECTOR_SETTINGS
    });
    return sanitizeDetectorSettings(stored[DETECTOR_SETTINGS_KEY]);
  } catch (error) {
    reportError('getDetectorSettings', error);
    return { ...DEFAULT_DETECTOR_SETTINGS };
  }
}

// Keep feed filtering paused until the companion has hatched and been fed a diet.
async function getActiveDetectorSettings() {
  const settings = await getDetectorSettings();
  const { onboardingStage } = await chrome.storage.local.get('onboardingStage');
  if (SAFARI_RELEASE) settings.mode = settings.categories.some(category => category !== 'ads') ? 'automatic' : 'manual';
  if (!await hasAIConsent()) { settings.mode = 'manual'; settings.categories = settings.categories.filter(category => category === 'ads'); }
  return onboardingStage && onboardingStage !== 'complete'
    ? { ...settings, mode: 'manual', categories: [], enabledPlatforms: [] } : settings;
}

async function updateDetectorSettings(settings) {
  const current = await getDetectorSettings();
  const sanitized = sanitizeDetectorSettings({ ...current, ...(settings || {}) });
  if (sanitized.enabledPlatforms.length === 0) throw new Error('Choose at least one platform.');
  detectorBroker.cancelAll('settings_changed');
  await chrome.storage.local.set({ [DETECTOR_SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function getDetectorSessionToken() {
  const stored = await chrome.storage.local.get({ [DETECTOR_SESSION_KEY]: null });
  return typeof stored[DETECTOR_SESSION_KEY] === 'string'
    ? stored[DETECTOR_SESSION_KEY]
    : null;
}

async function clearDetectorSession() {
  await chrome.storage.local.remove(DETECTOR_SESSION_KEY);
}

class DetectorApiError extends Error {
  constructor(message, code, status, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

function detectorRequestId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logDetectorEvent(level, event, fields = {}) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger(`[GomiMon Detector] ${event}`, JSON.stringify(fields));
}

function detectorErrorPayload(error) {
  const payload = {
    message: error?.message || 'Detector request failed',
    code: error?.code || 'DETECTOR_REQUEST_FAILED',
    status: error?.status,
    requestId: error?.requestId,
    serverRequestId: error?.serverRequestId,
    retryAt: error?.retryAt,
    resetAt: error?.resetAt,
    scope: error?.scope,
    quota: error?.quota
  };
  if (typeof error?.transient === 'boolean') payload.transient = error.transient;
  return payload;
}

async function completedEffectExists(effectKey) {
  if (!effectKey) return false;
  const timestamp = completedFeedEffects.get(effectKey);
  if (timestamp && Date.now() - timestamp <= 24 * 60 * 60 * 1000) return true;
  if (!chrome.storage.session?.get) return false;
  try {
    const stored = await chrome.storage.session.get({ [FEED_EFFECT_DEDUPE_KEY]: {} });
    const completed = stored[FEED_EFFECT_DEDUPE_KEY] || {};
    const completedAt = Number(completed[effectKey] || 0);
    if (completedAt && Date.now() - completedAt <= 24 * 60 * 60 * 1000) {
      completedFeedEffects.set(effectKey, completedAt);
      return true;
    }
  } catch (error) {
    // In-memory deduplication remains active when session storage is unavailable.
  }
  return false;
}

async function rememberCompletedEffect(effectKey) {
  if (!effectKey) return;
  const completedAt = Date.now();
  completedFeedEffects.set(effectKey, completedAt);
  if (!chrome.storage.session?.set) return;
  try {
    const stored = await chrome.storage.session.get({ [FEED_EFFECT_DEDUPE_KEY]: {} });
    const completed = stored[FEED_EFFECT_DEDUPE_KEY] || {};
    for (const [key, timestamp] of Object.entries(completed)) {
      if (completedAt - Number(timestamp) > 24 * 60 * 60 * 1000) delete completed[key];
    }
    completed[effectKey] = completedAt;
    await chrome.storage.session.set({ [FEED_EFFECT_DEDUPE_KEY]: completed });
  } catch (error) {
    // Progress has already been persisted; memory deduplication is sufficient
    // for this worker lifetime if session storage cannot be written.
  }
}

async function detectorApiRequest(path, options = {}) {
  const {
    auth = 'required',
    includeMetadata = false,
    requestId: suppliedRequestId,
    platform,
    signal: externalSignal,
    timeoutMs = 18000,
    ...requestOptions
  } = options;
  const requestId = suppliedRequestId || detectorRequestId();
  const sensitive = SAFARI_RELEASE && ['/v1/analyze', '/v1/gomimon/name', '/v1/leaderboard/join'].includes(path);
  const generation = consentGeneration;
  const startedAt = Date.now();
  logDetectorEvent('info', 'request_start', { requestId, path, platform });
  const settings = await getDetectorSettings();
  const token = await getDetectorSessionToken();
  if (!token && auth === 'required') {
    const error = new DetectorApiError('Sign in to use the detector', 'UNAUTHENTICATED', 401);
    error.requestId = requestId;
    logDetectorEvent('warn', 'request_failure', {
      requestId,
      platform,
      path,
      durationMs: Date.now() - startedAt,
      name: error.name,
      code: error.code,
      status: error.status
    });
    throw error;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', abortFromCaller, { once: true });
  let serverRequestId = null;
  if (sensitive) sensitiveRequests.add(controller);
  try {
    if (sensitive && (!await hasAIConsent() || generation !== consentGeneration || controller.signal.aborted)) throw new DetectorApiError('Allow text processing in GomiMon Settings first.', 'CONSENT_REQUIRED', 403);
    const response = await fetch(`${settings.serviceUrl || DETECTOR_API_URL}${path}`, {
      ...requestOptions,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(requestOptions.headers || {}),
        'X-GomiMon-Request-ID': requestId,
        ...(token && auth !== 'none' ? { Authorization: `Bearer ${token}` } : {})
      },
      signal: controller.signal
    });
    serverRequestId = response.headers.get('x-gomimon-request-id');
    logDetectorEvent('info', 'request_response', {
      requestId,
      platform,
      serverRequestId,
      path,
      status: response.status,
      durationMs: Date.now() - startedAt
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.error === 'QUOTA_EXCEEDED') detectorQuotaBlock = { token, scope: payload.scope || 'account', resetAt: payload.resetAt };
      if (response.status === 401) await clearDetectorSession();
      const apiError = new DetectorApiError(
        payload.message || 'Detector service unavailable',
        payload.error || 'DETECTOR_REQUEST_FAILED',
        response.status,
        {
          transient: payload.transient ?? (response.status === 408 || response.status === 429 || response.status >= 500),
          retryAt: payload.retryAt,
          resetAt: payload.resetAt,
          scope: payload.scope,
          quota: payload.quota
        }
      );
      throw apiError;
    }
    return includeMetadata ? { payload, requestId, serverRequestId } : payload;
  } catch (error) {
    if (error && typeof error === 'object') {
      error.requestId ||= requestId;
      error.serverRequestId ||= serverRequestId;
    }
    logDetectorEvent('warn', 'request_failure', {
      requestId,
      platform,
      serverRequestId,
      path,
      durationMs: Date.now() - startedAt,
      name: error?.name,
      code: error?.code,
      status: error?.status
    });
    if (error?.name === 'AbortError') {
      const timeoutError = new DetectorApiError(
        timedOut ? 'Detector request timed out' : 'Detector request cancelled',
        timedOut ? 'DETECTOR_TIMEOUT' : 'DETECTOR_ABORTED',
        timedOut ? 504 : 499,
        { transient: timedOut }
      );
      timeoutError.requestId = requestId;
      timeoutError.serverRequestId = serverRequestId;
      throw timeoutError;
    }
    if (error && typeof error === 'object' && !(error instanceof DetectorApiError)) {
      error.transient ??= true;
      error.code ||= 'DETECTOR_NETWORK_ERROR';
    }
    throw error;
  } finally {
    sensitiveRequests.delete(controller);
    clearTimeout(timeout);
    externalSignal?.removeEventListener?.('abort', abortFromCaller);
  }
}

async function getLeaderboardState() {
  const stored = await chrome.storage.local.get({
    [LEADERBOARD_STATE_KEY]: {
      accountKey: null,
      enabled: false,
      profileName: null,
      attemptedName: null,
      reservationError: null
    }
  });
  return stored[LEADERBOARD_STATE_KEY] || {};
}

async function setLeaderboardState(updates) {
  const current = await getLeaderboardState();
  const next = { ...current, ...updates };
  await chrome.storage.local.set({ [LEADERBOARD_STATE_KEY]: next });
  return next;
}

async function reserveGomimonName(name) {
  const validation = validatePetName(name);
  if (!validation.valid) throw new Error(validation.error);
  const response = await detectorApiRequest('/v1/gomimon/name', {
    method: 'POST',
    body: JSON.stringify({ name: validation.name })
  });
  const profile = response.gomimon;
  await chrome.storage.local.set({ petName: profile.name, pendingPetName: null });
  await setLeaderboardState({
    profileName: profile.name,
    enabled: profile.leaderboardEnabled === true,
    attemptedName: profile.name,
    reservationError: null
  });
  return profile;
}

async function reconcileGomimonProfile(accountResult, { forceReservation = false } = {}) {
  const accountKey = accountResult.account?.accountKey || null;
  const profile = accountResult.gomimon || null;
  if (!await hasAIConsent()) return { profile, nameError: null };
  const stats = await getStats();
  const state = await setLeaderboardState({
    accountKey,
    enabled: profile?.leaderboardEnabled === true,
    profileName: profile?.name || null
  });
  const { pendingPetName, onboardingStage } = await chrome.storage.local.get({ pendingPetName: null, onboardingStage: null });
  const chosenName = pendingPetName || (['platforms', 'diet', 'account'].includes(onboardingStage) ? stats.petName : null);
  if (profile?.name && !chosenName) {
    if (stats.petName !== profile.name) await chrome.storage.local.set({ petName: profile.name });
    return { profile, nameError: null };
  }
  const nameToReserve = chosenName || stats.petName;
  if (!nameToReserve) return { profile: null, nameError: null };
  if (!forceReservation && state.attemptedName === nameToReserve && state.reservationError) {
    return { profile: null, nameError: state.reservationError };
  }
  try {
    return { profile: await reserveGomimonName(nameToReserve), nameError: null };
  } catch (error) {
    await setLeaderboardState({
      attemptedName: nameToReserve,
      reservationError: { code: error.code || 'NAME_RESERVATION_FAILED', message: error.message }
    });
    return {
      profile: null,
      nameError: { code: error.code || 'NAME_RESERVATION_FAILED', message: error.message }
    };
  }
}

async function queueLeaderboardMeal(event) {
  const state = await getLeaderboardState();
  if (!state.enabled || !state.accountKey) return false;
  await withStorageLock(async () => {
    const stored = await chrome.storage.local.get({ [LEADERBOARD_PENDING_KEY]: {} });
    const pending = stored[LEADERBOARD_PENDING_KEY] || {};
    const accountEvents = Array.isArray(pending[state.accountKey]) ? pending[state.accountKey] : [];
    if (!accountEvents.some(item => item.id === event.id)) accountEvents.push(event);
    pending[state.accountKey] = accountEvents.slice(-1000);
    await chrome.storage.local.set({ [LEADERBOARD_PENDING_KEY]: pending });
  });
  return true;
}

async function syncLeaderboardMeals() {
  const token = await getDetectorSessionToken();
  const state = await getLeaderboardState();
  if (!token || !state.enabled || !state.accountKey) return { synced: 0 };
  const stored = await chrome.storage.local.get({ [LEADERBOARD_PENDING_KEY]: {} });
  const pending = stored[LEADERBOARD_PENDING_KEY] || {};
  const batch = (pending[state.accountKey] || []).slice(0, 100);
  if (batch.length === 0) return { synced: 0 };
  const response = await detectorApiRequest('/v1/leaderboard/meals', {
    method: 'POST',
    body: JSON.stringify({ events: batch })
  });
  const sentIds = new Set(batch.map(event => event.id));
  await withStorageLock(async () => {
    const latest = await chrome.storage.local.get({ [LEADERBOARD_PENDING_KEY]: {} });
    const queues = latest[LEADERBOARD_PENDING_KEY] || {};
    queues[state.accountKey] = (queues[state.accountKey] || [])
      .filter(event => !sentIds.has(event.id));
    await chrome.storage.local.set({ [LEADERBOARD_PENDING_KEY]: queues });
  });
  return { synced: batch.length, ...response };
}

async function getLeaderboard(period = 'weekly') {
  const query = encodeURIComponent(period);
  const board = await detectorApiRequest(`/v1/leaderboard?period=${query}`, {
    auth: 'none',
    cache: 'no-store'
  });
  let me = null;
  if (await getDetectorSessionToken()) {
    try {
      me = await detectorApiRequest(`/v1/leaderboard/me?period=${query}`);
    } catch (error) {
      if (error.code !== 'UNAUTHENTICATED') throw error;
    }
  }
  return { ...board, me: me?.entry || null };
}

async function joinLeaderboard() {
  const account = await detectorAccountStatus({ forceReservation: true });
  if (!account.signedIn) throw new DetectorApiError('Sign in to join the leaderboard', 'UNAUTHENTICATED', 401);
  if (!account.gomimon?.name) {
    const error = account.nameError;
    throw new DetectorApiError(
      error?.message || 'Reserve a GomiMon name before joining',
      error?.code || 'PROFILE_REQUIRED',
      409
    );
  }
  const stats = await getStats();
  const response = await detectorApiRequest('/v1/leaderboard/join', {
    method: 'POST',
    body: JSON.stringify({ feedCount: stats.feedCount, evolution: stats.evolution })
  });
  await setLeaderboardState({
    accountKey: account.account?.accountKey,
    enabled: true,
    profileName: response.gomimon.name,
    reservationError: null
  });
  syncLeaderboardMeals().catch(error => reportError('syncLeaderboardMeals', error));
  return response.gomimon;
}

async function leaveLeaderboard() {
  const response = await detectorApiRequest('/v1/leaderboard/leave', { method: 'POST' });
  const state = await setLeaderboardState({ enabled: false });
  if (state.accountKey) {
    const stored = await chrome.storage.local.get({ [LEADERBOARD_PENDING_KEY]: {} });
    const pending = stored[LEADERBOARD_PENDING_KEY] || {};
    delete pending[state.accountKey];
    await chrome.storage.local.set({ [LEADERBOARD_PENDING_KEY]: pending });
  }
  return response.gomimon;
}

async function detectorSessionNamespace() {
  const token = await getDetectorSessionToken();
  if (!token) return null;
  try {
    const bytes = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(token)
    );
    return Array.from(new Uint8Array(bytes))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    let hash = 2166136261;
    for (const character of token) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `session-${(hash >>> 0).toString(16)}`;
  }
}

const detectorBroker = createDetectorBroker({
  storage: chrome.storage.local,
  getSessionNamespace: detectorSessionNamespace,
  getServiceUrl: async () => (await getDetectorSettings()).serviceUrl || DETECTOR_API_URL,
  request: input => detectorApiRequest('/v1/analyze', {
    platform: input.platform || 'reddit',
    method: 'POST',
    includeMetadata: true,
    requestId: detectorRequestId(),
    signal: input.signal,
    timeoutMs: 18000,
    body: JSON.stringify({
      protocolVersion: input.protocolVersion,
      operationId: input.operationId,
      itemKey: input.itemKey,
      revision: input.revision,
      priority: input.priority,
      contentType: input.contentType,
      platform: input.platform || 'reddit',
      quotedText: input.quotedText || '',
      text: input.text,
      title: input.title,
      body: input.body,
      subreddit: input.subreddit,
      flair: input.flair,
      truncated: input.truncated === true,
      includeAi: input.includeAi !== false,
      categories: Array.isArray(input.categories) ? input.categories : []
    })
  })
});

// Update stats safely
async function updateStats(updates) {
  return withStorageLock(async () => {
    const current = await getStats();
    const newStats = sanitizeStats({ ...current, ...updates, lastUpdate: Date.now() });
    await chrome.storage.local.set(newStats);
    return newStats;
  });
}

// Rate limiting for feeds
function checkRateLimit() {
  const now = Date.now();

  // Check cooldown
  if (now - lastFeedTime < FEED_COOLDOWN_MS) {
    debugLog('Feed cooldown active');
    return false;
  }

  // Check rate limit
  const oneMinuteAgo = now - 60000;

  // Remove old timestamps
  while (feedTimestamps.length > 0 && feedTimestamps[0] < oneMinuteAgo) {
    feedTimestamps.shift();
  }

  if (feedTimestamps.length >= MAX_FEEDS_PER_MINUTE) {
    debugLog('Rate limit exceeded');
    return false;
  }

  feedTimestamps.push(now);
  lastFeedTime = now;
  return true;
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  try {
    debugLog('Extension installed, reason:', reason);

    if (reason === 'install') {
      // First install
      await chrome.storage.local.set({
        ...DEFAULT_STATS,
        [DETECTOR_SETTINGS_KEY]: DEFAULT_DETECTOR_SETTINGS,
        onboardingStage: 'hatch',
        lastUpdate: Date.now()
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      debugLog('Initialized with default stats:', DEFAULT_STATS);
    } else if (reason === 'update') {
      // Handle updates/migrations
      await migrateStorage();
      const settings = await getDetectorSettings();
      await updateDetectorSettings(settings);
    }

    // Create context menu
    await chrome.contextMenus?.create({
      id: 'feedGomiMon',
      title: 'Feed to GomiMon 👾',
      contexts: ['all']
    });

    // Create hunger timer alarm
    await chrome.alarms.create('hungerTick', {
      periodInMinutes: HUNGER_TICK_MINUTES
    });

    debugLog('Extension initialized successfully');
  } catch (error) {
    reportError('onInstalled', error);
  }
});

// Handle browser startup - catch up on missed ticks
chrome.runtime.onStartup.addListener(async () => {
  try {
    debugLog('Browser startup detected');

    syncLeaderboardMeals().catch(error => reportError('syncLeaderboardMeals', error));
    const stats = await getStats();
    if (stats.evolution === 'egg') return;
    const timeSinceUpdate = Date.now() - stats.lastUpdate;
    const missedTicks = Math.floor(timeSinceUpdate / (HUNGER_TICK_MINUTES * 60000));

    if (missedTicks > 0) {
      debugLog(`Catching up on ${missedTicks} missed hunger ticks`);
      const newHunger = Math.max(0, stats.hunger - (missedTicks * HUNGER_DECREASE_RATE));
      await updateStats({ hunger: newHunger });

      // Update badge if needed
      updateHungerBadge(newHunger);
    }
  } catch (error) {
    reportError('onStartup', error);
  }
});

// Storage migration
async function migrateStorage() {
  try {
    const data = await chrome.storage.local.get();
    const version = data.schemaVersion || 0;

    debugLog('Current schema version:', version);

    if (version < 1) {
      // Migration from version 0 to 1
      debugLog('Migrating from version 0 to 1');

      // Ensure all required fields exist
      const migrated = {
        ...DEFAULT_STATS,
        ...data,
        schemaVersion: 1
      };

      await chrome.storage.local.set(sanitizeStats(migrated));
      debugLog('Migration complete');
    }
    if (version < 2) {
      const current = await chrome.storage.local.get(DEFAULT_STATS);
      await chrome.storage.local.set(sanitizeStats({
        ...current,
        petName: current.petName || '',
        schemaVersion: 2
      }));
      debugLog('Migrated pet naming and leaderboard storage');
    }
  } catch (error) {
    reportError('migrateStorage', error);
  }
}

// Update hunger badge
function updateHungerBadge(hunger) {
  try {
    if (hunger < LOW_HUNGER_THRESHOLD) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor?.({ color: '#FF0000' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    reportError('updateHungerBadge', error);
  }
}

// Handle hunger timer
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'hungerTick') {
    try {
      debugLog('Hunger tick triggered');

      const stats = await getStats();
      if (stats.evolution === 'egg') return;
      const newHunger = Math.max(0, stats.hunger - HUNGER_DECREASE_RATE);

      await updateStats({ hunger: newHunger });

      debugLog('Hunger decreased to:', newHunger);

      // Update badge
      updateHungerBadge(newHunger);

      // Notify if starving
      if (newHunger === 0) {
        debugLog('Pet is starving!');
        // Could show notification here
      }
    } catch (error) {
      reportError('hungerTick', error);
    }
  }
});

// Validate and sanitize context menu info
function validateContextInfo(info) {
  return {
    x: typeof info.x === 'number'
      ? Math.max(0, Math.min(info.x, VALIDATION_LIMITS.MAX_COORDINATE))
      : undefined,
    y: typeof info.y === 'number'
      ? Math.max(0, Math.min(info.y, VALIDATION_LIMITS.MAX_COORDINATE))
      : undefined,
    srcUrl: typeof info.srcUrl === 'string'
      ? info.srcUrl.substring(0, VALIDATION_LIMITS.MAX_URL_LENGTH)
      : undefined,
    selectionText: typeof info.selectionText === 'string'
      ? info.selectionText.substring(0, VALIDATION_LIMITS.MAX_SELECTION_TEXT)
      : undefined,
    frameId: info.frameId
  };
}

// Determine food type from context
function determineFoodType(info) {
  if (info.srcUrl) {
    return FOOD_TYPES.IMAGE;
  } else if (info.selectionText) {
    return FOOD_TYPES.TEXT;
  }
  return FOOD_TYPES.POST;
}

// Show evolution notification
async function showEvolutionNotification(evolution) {
  try {
    // Check if notifications permission is available
    const hasPermission = await chrome.permissions.contains({
      permissions: ['notifications']
    });

    if (!hasPermission) {
      debugLog('Notification permission not granted');
      return;
    }

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🎉 GomiMon Evolved!',
      message: `Your GomiMon evolved into ${EVOLUTION_NAMES[evolution]}!`,
      priority: 2
    });

    playSound('evolve');
  } catch (error) {
    reportError('showEvolutionNotification', error);
  }
}

// Validate tab before injection
async function validateTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab) {
      debugLog('Tab not found:', tabId);
      return false;
    }

    if (tab.status !== 'complete') {
      debugLog('Tab not ready:', tabId);
      return false;
    }

    // Don't inject into chrome:// or extension pages
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      debugLog('Cannot inject into chrome page:', tab.url);
      return false;
    }

    return true;
  } catch (error) {
    if (error.message && error.message.includes('No tab with id')) {
      debugLog('Tab was closed:', tabId);
    } else {
      reportError('validateTab', error);
    }
    return false;
  }
}

// Inject CSS into tab (only once per tab)
async function injectCSS(tabId) {
  if (injectedTabs.has(tabId)) {
    return true; // Already injected
  }

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css']
    });

    injectedTabs.add(tabId);
    debugLog('CSS injected into tab:', tabId);
    return true;
  } catch (error) {
    reportError('injectCSS', error);
    return false;
  }
}

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  debugLog('Tab removed from tracking:', tabId);
});

let lastBillingQuota = null;
let detectorQuotaBlock = null;
const BILLING_PENDING_KEY = 'gomimonBillingPending';

async function detectorAccountStatus({ forceReservation = false } = {}) {
  const settings = await getDetectorSettings();
  const token = await getDetectorSessionToken();
  if (!token) {
    return { signedIn: false, settings, quota: null };
  }

  try {
    let account = await detectorApiRequest('/v1/account');
    const saved = await chrome.storage.local.get({ [BILLING_PENDING_KEY]: null });
    const pending = saved[BILLING_PENDING_KEY];
    if (pending && pending.accountKey === account.account?.accountKey && account.billing?.available &&
        pending.attempts < 6 && Date.now() - pending.startedAt < 90000 && Date.now() - pending.lastAt >= 5500) {
      pending.attempts += 1;
      pending.lastAt = Date.now();
      await chrome.storage.local.set({ [BILLING_PENDING_KEY]: pending });
      try { account = await detectorApiRequest('/v1/billing/refresh', { method: 'POST' }); }
      catch (error) { debugLog('Billing refresh deferred', error.code); }
    }
    if (pending && (pending.accountKey !== account.account?.accountKey ||
        (pending.action === 'portal' ? pending.attempts > 0 : account.billing?.plan === 'plus') ||
        pending.attempts >= 6 || Date.now() - pending.startedAt >= 90000)) {
      await chrome.storage.local.remove(BILLING_PENDING_KEY);
    }
    if (detectorQuotaBlock && (detectorQuotaBlock.token !== token ||
        Date.parse(detectorQuotaBlock.resetAt || '') <= Date.now() ||
        (detectorQuotaBlock.scope === 'account' && account.quota?.remaining > 0))) detectorQuotaBlock = null;
    account.quotaBlock = detectorQuotaBlock ? { scope: detectorQuotaBlock.scope } : null;
    const nextQuota = { accountKey: account.account?.accountKey, limit: account.quota?.limit, remaining: account.quota?.remaining };
    if (nextQuota.remaining > 0 && (!lastBillingQuota || lastBillingQuota.accountKey !== nextQuota.accountKey ||
        nextQuota.limit > lastBillingQuota.limit || lastBillingQuota.remaining === 0)) {
      await broadcastDetectorMessage({ type: 'DETECTOR_QUOTA_UPDATED', quota: account.quota });
    }
    lastBillingQuota = nextQuota;
    const reconciliation = await reconcileGomimonProfile(account, { forceReservation });
    return {
      signedIn: true,
      settings,
      ...account,
      gomimon: reconciliation.profile || account.gomimon || null,
      nameError: reconciliation.nameError
    };
  } catch (error) {
    if (error.code === 'UNAUTHENTICATED') {
      await clearDetectorSession();
      return { signedIn: false, settings, quota: null };
    }
    throw error;
  }
}

async function detectorSignIn(provider = 'google', link = false) {
  if (globalThis.gomimonSafariAuth) return globalThis.gomimonSafariAuth.start((await getDetectorSettings()).serviceUrl || DETECTOR_API_URL, { provider, link, token: link ? await getDetectorSessionToken() : null });
  if (!chrome.identity?.launchWebAuthFlow || !chrome.identity.getRedirectURL) {
    throw new DetectorApiError('Chrome identity authentication is unavailable', 'AUTH_UNAVAILABLE', 501);
  }

  const settings = await getDetectorSettings();
  const redirectUri = chrome.identity.getRedirectURL('oauth2');
  const authUrl = new URL(`${settings.serviceUrl || DETECTOR_API_URL}/auth/google/start`);
  authUrl.searchParams.set('redirect_uri', redirectUri);

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      result => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new DetectorApiError(runtimeError.message, 'AUTH_CANCELLED', 400));
          return;
        }
        resolve(result);
      }
    );
  });

  const token = new URL(responseUrl).searchParams.get('token');
  if (!token) {
    throw new DetectorApiError('The sign-in callback did not include a session', 'AUTH_CALLBACK_INVALID', 502);
  }

  return completeDetectorSignIn(token);
}

export async function completeDetectorSignIn(token) {
  await chrome.storage.local.set({ [DETECTOR_SESSION_KEY]: token });
  const account = await detectorAccountStatus({ forceReservation: true });
  syncLeaderboardMeals().catch(error => reportError('syncLeaderboardMeals', error));
  await broadcastDetectorMessage({ type: 'DETECTOR_AUTH_UPDATED', signedIn: true });
  return account;
}

async function detectorSignOut() {
  await globalThis.gomimonSafariAuth?.cancel();
  detectorBroker.cancelAll('signed_out');
  try {
    if (await getDetectorSessionToken()) {
      await detectorApiRequest('/v1/auth/signout', { method: 'POST' });
    }
  } catch (error) {
    debugLog('Detector sign-out request failed; clearing local session');
  } finally {
    await clearDetectorSession();
    await detectorBroker.clearCache();
  }
  await broadcastDetectorMessage({ type: 'DETECTOR_AUTH_UPDATED', signedIn: false });
  return { signedIn: false, quota: null };
}

async function detectorDeleteAccount() {
  const state = await getLeaderboardState();
  await globalThis.gomimonSafariAuth?.cancel();
  const deletion = await detectorApiRequest('/v1/account', { method: 'DELETE' });
  detectorBroker.cancelAll('account_deleted');
  await clearDetectorSession();
  await detectorBroker.clearCache();
  const stored = await chrome.storage.local.get({ [LEADERBOARD_PENDING_KEY]: {} });
  const pending = stored[LEADERBOARD_PENDING_KEY] || {};
  if (state.accountKey) delete pending[state.accountKey];
  await chrome.storage.local.set({
    [LEADERBOARD_PENDING_KEY]: pending,
    [LEADERBOARD_STATE_KEY]: {
      accountKey: null,
      enabled: false,
      profileName: null,
      attemptedName: null,
      reservationError: null
    }
  });
  await broadcastDetectorMessage({ type: 'DETECTOR_AUTH_UPDATED', signedIn: false });
  return { signedIn: false, quota: null, appleRevocationPending: deletion.appleRevocationPending === true };
}

function detectorSenderAllowed(sender) {
  return typeof sender?.tab?.id === 'number' && sender.tab.id >= 0 &&
    sender.frameId === 0 && Boolean(PLATFORMS.fromUrl(sender.url || sender.tab.url));
}

async function validateDetectorSender(message, sender) {
  const platform = PLATFORMS.fromUrl(sender?.url || sender?.tab?.url);
  if (!detectorSenderAllowed(sender) || (message.platform || 'reddit') !== platform ||
      !PLATFORMS.supportsPage(platform, sender.url || sender.tab.url)) {
    const error = new DetectorApiError('Detector request does not match a supported platform tab', 'INVALID_SENDER', 403);
    error.transient = false;
    throw error;
  }
  const settings = await getActiveDetectorSettings();
  if (!settings.enabledPlatforms.includes(platform)) {
    throw new DetectorApiError('This platform is disabled', 'PLATFORM_DISABLED', 403);
  }
  return platform;
}

async function analyzeContent(message, sender) {
  await validateDetectorSender(message, sender);
  if (message.operationId) detectorOperationOwners.set(message.operationId, sender.tab.id);
  try {
    const result = await detectorBroker.analyze(message);
    return result.state === 'complete'
      ? { ...result, success: true }
      : result;
  } finally {
    if (message.operationId) detectorOperationOwners.delete(message.operationId);
  }
}

// Handle messages from popup and minigames
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (SAFARI_RELEASE && ['GET_RELEASE_ACCOUNT', 'SET_AI_CONSENT', 'DETECTOR_LINK_PROVIDER'].includes(message.type)) {
    if (sender.url !== chrome.runtime.getURL('popup.html') || (sender.id && sender.id !== chrome.runtime.id)) {
      sendResponse({ success: false, error: { message: 'Open GomiMon to manage your account.' } }); return false;
    }
    (async () => {
      if (message.type === 'GET_RELEASE_ACCOUNT') {
        const consent = await hasAIConsent();
        const providers = await getDetectorSessionToken() ? (await detectorApiRequest('/v1/auth/providers')).providers : [];
        return { consent, providers };
      }
      if (message.type === 'DETECTOR_LINK_PROVIDER') return detectorSignIn(message.provider, true);
      consentGeneration++;
      for (const controller of sensitiveRequests) controller.abort();
      detectorBroker.cancelAll('consent_changed');
      await chrome.storage.local.set({ [AI_CONSENT_KEY]: { version: AI_CONSENT_VERSION, accepted: message.accepted === true, updatedAt: Date.now() } });
      await detectorBroker.clearCache();
      await broadcastDetectorMessage({ type: 'DETECTOR_SETTINGS_UPDATED', settings: await getActiveDetectorSettings() });
      return { consent: await hasAIConsent() };
    })().then(result => sendResponse({ success: true, ...result })).catch(error => sendResponse({ success: false, error: { message: error.message } }));
    return true;
  }

  if (message.type === 'CLEAR_SLOP_HISTORY') {
    if (sender.url !== chrome.runtime.getURL('popup.html')) {
      sendResponse({ success: false, error: 'Open GomiMon to clear history.' });
      return false;
    }
    withStorageLock(() => chrome.storage.local.set({ [HISTORY_KEY]: [] }))
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false, error: 'Could not clear history.' }));
    return true;
  }
  if (message.type === 'HATCH_PET' || message.type === 'RESET_ONBOARDING') {
    if (sender.tab && sender.url !== chrome.runtime.getURL('popup.html')) {
      sendResponse({ success: false, error: 'Open GomiMon to manage onboarding.' });
      return false;
    }
    withStorageLock(async () => {
      if (message.type === 'RESET_ONBOARDING') {
        detectorBroker.cancelAll('onboarding_reset');
        const settings = await getDetectorSettings();
        await chrome.storage.local.set({
          ...DEFAULT_STATS, pendingPetName: null, lastUpdate: Date.now(), onboardingStage: 'hatch',
          detectorOnboardingSeen: false, [HISTORY_KEY]: [],
          [DETECTOR_SETTINGS_KEY]: { ...DEFAULT_DETECTOR_SETTINGS, serviceUrl: settings.serviceUrl }
        });
        feedTimestamps.length = 0;
        lastFeedTime = 0;
        completedFeedEffects.clear();
        await chrome.storage.session?.remove(FEED_EFFECT_DEDUPE_KEY);
      } else {
        const { onboardingStage } = await chrome.storage.local.get('onboardingStage');
        if (onboardingStage !== 'hatch') throw new Error('Your egg is not ready to hatch.');
        const validation = validatePetName(message.petName);
        if (!validation.valid) throw new Error(validation.error);
        await chrome.storage.local.set({ evolution: 'baby', petName: validation.name, pendingPetName: validation.name, hunger: 100, glitch: 0,
          lastUpdate: Date.now(), onboardingStage: 'platforms', detectorOnboardingSeen: false });
      }
      updateHungerBadge(100);
    }).then(async () => {
      await broadcastDetectorMessage({ type: 'DETECTOR_SETTINGS_UPDATED', settings: await getActiveDetectorSettings() });
      sendResponse({ success: true });
    }).catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_DETECTOR_SETTINGS') {
    getActiveDetectorSettings()
      .then(settings => sendResponse({ success: true, settings }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'SET_DETECTOR_SETTINGS') {
    updateDetectorSettings(message.settings)
      .then(async settings => {
        await broadcastDetectorMessage({
          type: 'DETECTOR_SETTINGS_UPDATED',
          settings: await getActiveDetectorSettings()
        });
        sendResponse({ success: true, settings });
      })
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (['BILLING_CHECKOUT', 'BILLING_PORTAL', 'BILLING_REFRESH'].includes(message.type)) {
    if (SAFARI_RELEASE) { sendResponse({ success: false, error: { message: 'Purchases are unavailable in this version.' } }); return false; }
    const trusted = Boolean(chrome.runtime.id) && sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
    if (!trusted) {
      sendResponse({ success: false, error: { code: 'INVALID_SENDER', message: 'Open billing from GomiMon Settings.' } });
      return false;
    }
    (async () => {
      const action = { BILLING_CHECKOUT: 'checkout', BILLING_PORTAL: 'portal', BILLING_REFRESH: 'refresh' }[message.type];
      const result = await detectorApiRequest(`/v1/billing/${action}`, { method: 'POST', timeoutMs: 45000 });
      if (action !== 'refresh') {
        const url = new URL(result.url);
        const host = action === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com';
        if (url.protocol !== 'https:' || url.hostname !== host) throw new Error('Invalid billing destination');
        const account = await detectorApiRequest('/v1/account');
        await chrome.storage.local.set({ [BILLING_PENDING_KEY]: {
          accountKey: account.account.accountKey, action, startedAt: Date.now(), lastAt: Date.now(), attempts: 0
        } });
        await chrome.tabs.create({ url: url.href });
        return { opened: true };
      }
      await chrome.storage.local.remove(BILLING_PENDING_KEY);
      return detectorAccountStatus();
    })().then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'GET_DETECTOR_ACCOUNT') {
    detectorAccountStatus()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'RESERVE_GOMIMON_NAME') {
    reserveGomimonName(message.name)
      .then(gomimon => sendResponse({ success: true, gomimon }))
      .catch(error => sendResponse({ success: false, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'GET_LEADERBOARD') {
    getLeaderboard(message.period)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'JOIN_LEADERBOARD') {
    joinLeaderboard()
      .then(gomimon => sendResponse({ success: true, gomimon }))
      .catch(error => sendResponse({ success: false, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'LEAVE_LEADERBOARD') {
    leaveLeaderboard()
      .then(gomimon => sendResponse({ success: true, gomimon }))
      .catch(error => sendResponse({ success: false, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'DETECTOR_SIGN_IN') {
    if (SAFARI_RELEASE && sender.url !== chrome.runtime.getURL('popup.html')) { sendResponse({ success: false }); return false; }
    detectorSignIn(message.provider || 'google')
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'DETECTOR_SIGN_OUT') {
    detectorSignOut()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'DETECTOR_DELETE_ACCOUNT') {
    detectorDeleteAccount()
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'ANALYZE_CONTENT' || message.type === 'ANALYZE_REDDIT_CONTENT') {
    analyzeContent(message, sender)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, state: 'error', protocolVersion: 2, error: detectorErrorPayload(error) }));
    return true;
  }

  if (message.type === 'CANCEL_DETECTOR_ANALYSIS') {
    const ownerTabId = detectorOperationOwners.get(message.operationId);
    const allowed = detectorSenderAllowed(sender) && ownerTabId === sender.tab.id;
    sendResponse({ success: true, cancelled: allowed && detectorBroker.cancel(message.operationId) });
    return false;
  }

  if (message.type === 'FEED_CONTENT' || message.type === 'FEED_REDDIT_CONTENT') {
    validateDetectorSender(message, sender).then(() => feedGomiMon({
      tab: sender.tab,
      foodType: message.source === 'category' ? FOOD_TYPES.POST : FOOD_TYPES.TEXT,
      source: message.source || 'manual',
      itemKey: message.itemKey,
      effectId: message.effectId,
      excerpt: message.excerpt,
      categories: message.categories
    }))
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: { message: error.message, code: error.code } }));
    return true;
  }

  if (message.type === 'LAUNCH_MINIGAME') {
    handleLaunchMinigame(message.game)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => {
        reportError('LAUNCH_MINIGAME', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'MINIGAME_COMPLETE') {
    handleMinigameComplete(message)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => {
        reportError('MINIGAME_COMPLETE', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  // Offscreen document sound handling
  if (message.action === 'playSound') {
    // This is handled by offscreen.js, not background
    return false;
  }
});

// Launch a minigame in a new window
async function handleLaunchMinigame(gameName) {
  try {
    debugLog('Launching minigame:', gameName);

    // Validate game name
    const validGames = ['scholar'];
    if (!validGames.includes(gameName)) {
      throw new Error(`Invalid game name: ${gameName}`);
    }

    // Check pet state
    const stats = await getStats();

    // Don't allow playing if crashed or starved
    if (stats.glitch >= GLITCH_CRASH_THRESHOLD) {
      throw new Error('Pet is crashed! Reboot first.');
    }

    if (stats.hunger === 0) {
      throw new Error('Pet is starving! Feed it first.');
    }

    // Get game URL
    const gameUrl = chrome.runtime.getURL(`minigames/${gameName}/minigame-${gameName}.html`);

    // Create window
    const window = await chrome.windows.create({
      url: gameUrl,
      type: 'popup',
      width: 650,
      height: 750,
      focused: true
    });

    debugLog('Minigame window created:', window.id);

    return { windowId: window.id };
  } catch (error) {
    reportError('handleLaunchMinigame', error);
    throw error;
  }
}

// Handle minigame completion and apply rewards
async function handleMinigameComplete(message) {
  try {
    debugLog('Minigame complete:', message);

    const { game, rewards, score, total } = message;

    // Validate rewards
    if (!rewards || typeof rewards.hunger !== 'number' || typeof rewards.glitch !== 'number') {
      throw new Error('Invalid rewards format');
    }

    // Get current stats
    const stats = await getStats();

    // Apply rewards
    const newHunger = Math.min(100, Math.max(0, stats.hunger + rewards.hunger));
    const newGlitch = Math.min(100, Math.max(0, stats.glitch + rewards.glitch));

    // Update stats
    await updateStats({
      hunger: newHunger,
      glitch: newGlitch
    });

    debugLog('Rewards applied:', { hunger: rewards.hunger, glitch: rewards.glitch });
    debugLog('New stats:', { hunger: newHunger, glitch: newGlitch });

    // Update badge if needed
    updateHungerBadge(newHunger);

    // Play success sound
    if (score >= total * 0.7) {
      playSound('feed'); // Good performance
    }

    return {
      appliedRewards: rewards,
      newStats: { hunger: newHunger, glitch: newGlitch }
    };
  } catch (error) {
    reportError('handleMinigameComplete', error);
    throw error;
  }
}

function isDetectorTab(tab) {
  return Boolean(PLATFORMS.fromUrl(tab?.url));
}

async function sendDetectorFeedResult(tab, message, frameId) {
  return chrome.tabs.sendMessage(tab.id, message, frameId ? { frameId } : undefined);
}

async function broadcastDetectorMessage(message) {
  try {
    const tabs = await chrome.tabs.query({ url: PLATFORMS.matches });
    await Promise.allSettled(tabs
      .filter(tab => typeof tab.id === 'number')
      .map(tab => chrome.tabs.sendMessage(tab.id, message)));
  } catch (error) {
    debugLog('Could not broadcast detector state:', error.message);
  }
}

// One serialized feed path serves context-menu, manual detector, and automatic meals.
async function feedGomiMon({ tab, info = {}, foodType = FOOD_TYPES.POST, source = 'manual', itemKey, effectId, excerpt, categories }) {
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) {
    throw new Error('Invalid tab');
  }
  if (!await validateTab(tab.id)) {
    throw new Error('Tab is not ready');
  }

  // Automatic meals are one per platform/post per day, including remounts,
  // revisions and appearances in another tab. Manual meals retain their IDs.
  const effectKey = itemKey && source !== 'manual'
    ? `auto:${PLATFORMS.fromUrl(tab.url)}:${itemKey}`
    : effectId ? `${tab.id}:${effectId}` : null;
  const now = Date.now();
  for (const [key, completedAt] of completedFeedEffects) {
    if (now - completedAt > 24 * 60 * 60 * 1000) completedFeedEffects.delete(key);
  }
  if (effectKey && await completedEffectExists(effectKey)) {
    return { deduplicated: true, source };
  }
  const feedKey = itemKey ? (source !== 'manual' ? effectKey : `${tab.id}:${itemKey}`) : null;
  if (feedKey && activeFeedKeys.has(feedKey)) {
    return { deduplicated: true, source };
  }
  if (feedKey) activeFeedKeys.add(feedKey);

  let newStats;
  let evolution;
  let justEvolved;
  try {
    // Rate-limit, read, calculate, and persist as one operation so two tabs
    // cannot overwrite each other's feed count, diet, hunger, or evolution.
    const applied = await withStorageLock(async () => {
      const { onboardingStage } = await chrome.storage.local.get('onboardingStage');
      if (onboardingStage && onboardingStage !== 'complete') {
        throw new Error('Open GomiMon and hatch your egg before feeding.');
      }
      if (!checkRateLimit()) {
        throw new Error('Feed cooldown or rate limit active');
      }

      const stats = await getStats();
      if (stats.glitch >= GLITCH_CRASH_THRESHOLD) {
        throw new Error('Pet is crashed! Reboot first.');
      }

      const feedUpdate = buildFeedUpdate(stats, foodType, source);
      const nextStats = sanitizeStats({ ...stats, ...feedUpdate.updates, lastUpdate: Date.now() });
      const history = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
      const entries = appendSlopHistory(history[HISTORY_KEY], {
        id: effectId || detectorRequestId(), consumedAt: Date.now(),
        platform: PLATFORMS.fromUrl(tab.url) || new URL(tab.url).hostname,
        excerpt: excerpt || info.selectionText || tab.title || '', source, categories
      });
      await chrome.storage.local.set({ ...nextStats, [HISTORY_KEY]: entries });
      return { ...feedUpdate, newStats: nextStats };
    });
    ({ evolution, justEvolved, newStats } = applied);
    const newHunger = newStats.hunger;

    if (justEvolved) await showEvolutionNotification(evolution);
    updateHungerBadge(newHunger);
    // Progress is durable before presentation begins. Mark the effect now so
    // a tab acknowledgement/animation retry cannot award the pet again.
    await rememberCompletedEffect(effectKey);
    try {
      const queued = await queueLeaderboardMeal({
        id: effectId || detectorRequestId(),
        foodType,
        evolution: newStats.evolution
      });
      if (queued) {
        syncLeaderboardMeals().catch(error => reportError('syncLeaderboardMeals', error));
      }
    } catch (error) {
      reportError('queueLeaderboardMeal', error);
    }
    await injectCSS(tab.id);

    const safeInfo = validateContextInfo(info);
    let presentationApplied = false;
    if (isDetectorTab(tab)) {
      try {
        const result = await sendDetectorFeedResult(tab, itemKey
          ? { type: 'GOMIMON_FEED_RESULT', itemKey, evolution, source, effectId }
          : { type: 'PURGE_AT_POINT', info: safeInfo, evolution, source }, safeInfo.frameId);
        if (result?.success === false) throw new Error('Detector presentation is inactive');
        presentationApplied = true;
      } catch (error) {
        if (!itemKey) {
          try {
            await chrome.scripting.executeScript({
              target: {
                tabId: tab.id,
                frameIds: safeInfo.frameId ? [safeInfo.frameId] : undefined
              },
              func: purgeAtCoordinates,
              args: [safeInfo, evolution]
            });
            presentationApplied = true;
          } catch (fallbackError) {
            reportError('feedPresentation', fallbackError);
          }
        } else {
          logDetectorEvent('warn', 'feed_presentation_failed', {
            itemKey,
            effectId,
            message: error.message
          });
        }
      }
    } else {
      try {
        await chrome.scripting.executeScript({
          target: {
            tabId: tab.id,
            frameIds: safeInfo.frameId ? [safeInfo.frameId] : undefined
          },
          func: purgeAtCoordinates,
          args: [safeInfo, evolution]
        });
        presentationApplied = true;
      } catch (error) {
        reportError('feedPresentation', error);
      }
    }

    playSound('gulp');
    animateIcon();
    return { newStats, evolution, source, progressApplied: true, presentationApplied };
  } finally {
    if (feedKey) activeFeedKeys.delete(feedKey);
  }
}

// Handle context menu clicks (feeding)
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'feedGomiMon') return;

  try {
    const safeInfo = validateContextInfo(info);
    await feedGomiMon({
      tab,
      info: safeInfo,
      foodType: determineFoodType(safeInfo),
      source: 'manual'
    });
  } catch (error) {
    reportError('feedGomiMon', error);
  }
});

// Function injected into page to purge element
function purgeAtCoordinates(info, evolution) {
  console.log('[GomiMon] Purging selection', { evolution, frameId: info.frameId });

  // Find element at click coordinates
  let targetElement = null;

  if (info.x !== undefined && info.y !== undefined) {
    targetElement = document.elementFromPoint(info.x, info.y);
  }

  if (!targetElement) {
    targetElement = document.activeElement;
  }

  if (!targetElement || targetElement === document.body) {
    console.warn('[GomiMon] Could not find target element');
    return;
  }

  // Find parent post container
  function findParentPost(element) {
    if (!element) return null;

    let current = element;
    let maxDepth = 15;
    let depth = 0;

    while (current && depth < maxDepth) {
      // Twitter/X - article elements
      if (current.tagName === 'ARTICLE') {
        return current;
      }

      // Reddit - post containers
      if (current.hasAttribute('data-testid')) {
        const testId = current.getAttribute('data-testid');
        if (testId && (testId.includes('post-container') ||
            testId.includes('post_') ||
            testId === 'post-content')) {
          return current;
        }
      }

      // Reddit - shreddit-post elements
      if (current.tagName === 'SHREDDIT-POST') {
        return current;
      }

      // Facebook - story containers
      if ((current.hasAttribute('data-ad-preview') ||
          current.hasAttribute('data-pagelet')) &&
          current.getAttribute('role') === 'article') {
        return current;
      }

      // Generic post patterns
      const classList = Array.from(current.classList || []);

      if (classList.some(c =>
        c.includes('post') ||
        c.includes('story') ||
        c.includes('feed-item') ||
        c.includes('timeline-item') ||
        c.includes('card')
      )) {
        // Make sure it's substantial
        if (current.offsetHeight > 50) {
          return current;
        }
      }

      // Check for role=article
      if (current.getAttribute('role') === 'article') {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // Fallback: find reasonably-sized parent
    current = element;
    depth = 0;
    while (current && depth < 10) {
      if (current.offsetHeight > 100 && current.offsetHeight < window.innerHeight) {
        return current;
      }
      current = current.parentElement;
      depth++;
    }

    return element;
  }

  const postElement = findParentPost(targetElement);

  if (!postElement) {
    console.warn('[GomiMon] Could not find post element');
    return;
  }

  console.log('[GomiMon] Purging element', { tag: postElement.tagName });

  // Get the post's position for pet animation
  const postRect = postElement.getBoundingClientRect();
  const postCenterX = postRect.left + postRect.width / 2;
  const postCenterY = postRect.top + postRect.height / 2;

  // Map evolution to sprite - use eat animation
  const spriteMap = {
    'egg': {
      idle: 'sprites/animated/egg1_idle.gif',
      eat: 'sprites/animated/egg1_idle.gif'
    },
    'baby': {
      idle: 'sprites/animated/baby1_idle.gif',
      eat: 'sprites/animated/baby1_eat.gif'
    },
    'bubble-gomi': {
      idle: 'sprites/animated/bubble-gomi_idle.gif',
      eat: 'sprites/animated/bubble-gomi_eat.gif'
    },
    'nimbus-gomi': {
      idle: 'sprites/animated/nimbus-gomi_idle.gif',
      eat: 'sprites/animated/nimbus-gomi_eat.gif'
    },
    'typo-ling': {
      idle: 'sprites/typo-ling.svg',
      eat: 'sprites/typo-ling.svg'
    },
    'muta-pixel': {
      idle: 'sprites/muta-pixel.svg',
      eat: 'sprites/muta-pixel.svg'
    },
    'classic-gomi': {
      idle: 'sprites/classic-gomi.svg',
      eat: 'sprites/classic-gomi.svg'
    },
    'null-sprite': {
      idle: 'sprites/starved.svg',
      eat: 'sprites/starved.svg'
    }
  };

  const evolutionSprites = spriteMap[evolution] || spriteMap['baby'];
  const eatSpriteUrl = chrome.runtime.getURL(evolutionSprites.eat);

  // Create pet overlay
  const petOverlay = document.createElement('div');
  petOverlay.id = 'gomimon-pet-overlay';
  petOverlay.innerHTML = `<img src="${eatSpriteUrl}" alt="GomiMon" />`;
  document.body.appendChild(petOverlay);

  // Start from bottom-right corner
  const startX = window.innerWidth + 60;
  const startY = window.innerHeight + 60;

  petOverlay.style.left = `${startX}px`;
  petOverlay.style.top = `${startY}px`;

  // Fly in animation
  setTimeout(() => {
    petOverlay.style.transition = 'left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
    petOverlay.style.left = `${postCenterX}px`;
    petOverlay.style.top = `${postCenterY}px`;
    petOverlay.style.animation = 'gomimon-fly-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
  }, 50);

  // Start eating animation after flying in
  setTimeout(() => {
    petOverlay.style.animation = 'gomimon-eat 0.4s ease-in-out 3';

    // Add purge animation to post while eating
    postElement.classList.add('gomi-purged');
  }, 650);

  // Fly away after eating
  setTimeout(() => {
    petOverlay.style.transition = 'left 0.5s ease-in, top 0.5s ease-in';
    petOverlay.style.animation = 'gomimon-fly-away 0.5s ease-in forwards';
    petOverlay.style.left = `${startX}px`;
    petOverlay.style.top = `${startY}px`;
  }, 1850);

  // Remove pet overlay
  setTimeout(() => {
    petOverlay.remove();
  }, 2400);

  // Remove post element after full animation
  setTimeout(() => {
    try {
      postElement.remove();
      console.log('[GomiMon] Element removed');
    } catch (e) {
      console.error('[GomiMon] Failed to remove element:', e);
    }
  }, 2500);
}

// Animate toolbar icon with badge
function animateIcon() {
  try {
    let count = 0;
    const interval = setInterval(() => {
      const badge = count % 2 === 0 ? '◉' : '◎';
      chrome.action.setBadgeText({ text: badge });
      chrome.action.setBadgeBackgroundColor?.({ color: '#667eea' });

      count++;
      if (count >= 6) {
        clearInterval(interval);
        // Restore hunger badge if needed
        getStats().then(stats => {
          if (stats.hunger < LOW_HUNGER_THRESHOLD) {
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor?.({ color: '#FF0000' });
          } else {
            chrome.action.setBadgeText({ text: '' });
          }
        }).catch(err => reportError('animateIcon-restore', err));
      }
    }, 100);
  } catch (error) {
    reportError('animateIcon', error);
  }
}

// Ensure offscreen document exists
async function ensureOffscreenDocument() {
  // Check if API is available
  if (!chrome.offscreen) {
    debugLog('Offscreen API not available');
    return false;
  }

  // Return existing promise if already creating
  if (offscreenDocumentPromise) {
    return offscreenDocumentPromise;
  }

  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
      debugLog('Offscreen document already exists');
      return true;
    }

    debugLog('Creating offscreen document');
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing sound effects for user feedback'
    });

    await offscreenDocumentPromise;
    debugLog('Offscreen document created');

    return true;
  } catch (error) {
    offscreenDocumentPromise = null;
    reportError('ensureOffscreenDocument', error);
    return false;
  }
}

// Close offscreen document after delay
async function closeOffscreenDocument() {
  if (!chrome.offscreen) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
    offscreenDocumentPromise = null;
    debugLog('Offscreen document closed');
  } catch (error) {
    // Document might already be closed or never opened
    offscreenDocumentPromise = null;
    debugLog('Offscreen document close failed (might already be closed)');
  }
}

// Play sound effect
async function playSound(soundName) {
  try {
    const created = await ensureOffscreenDocument();

    if (!created) {
      debugLog('Could not create offscreen document for sound');
      return;
    }

    // Send message to play sound
    await chrome.runtime.sendMessage({
      action: 'playSound',
      sound: soundName
    });

    debugLog('Sound played:', soundName);

    // Close document after delay to free resources
    setTimeout(() => {
      closeOffscreenDocument();
    }, ANIMATION_DURATION.OFFSCREEN_CLOSE_DELAY);

  } catch (error) {
    reportError('playSound', error);
  }
}

// Global error handlers
self.addEventListener('error', (event) => {
  reportError('global-error', event.error || new Error(event.message));
});

self.addEventListener('unhandledrejection', (event) => {
  reportError('unhandled-rejection', event.reason || new Error('Unhandled promise rejection'));
});

debugLog('Background service worker initialized');

// Onboarding completion activates the chosen platforms in already-open tabs.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.onboardingStage) {
    getActiveDetectorSettings().then(settings => broadcastDetectorMessage({ type: 'DETECTOR_SETTINGS_UPDATED', settings }));
  }
});
