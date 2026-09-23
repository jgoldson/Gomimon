// Versioned item state for the Reddit detector.
(function attachStore(global) {
  'use strict';

  const modules = global.GomiMonDetectorModules;
  const { revisionForSnapshot } = modules.revision;

  function createPostStore({ now = () => Date.now(), retentionMs = 5 * 60 * 1000, maxRecords = 500 } = {}) {
    const records = new Map();
    let viewSequence = 0;

    function cloneSnapshot(snapshot) {
      const copy = { ...snapshot };
      delete copy.element;
      delete copy.textContainer;
      return Object.freeze(copy);
    }

    function newRecord(snapshot) {
      const normalized = cloneSnapshot(snapshot);
      const revision = snapshot.revision || revisionForSnapshot(normalized);
      return {
        key: normalized.key,
        contentType: normalized.contentType,
        snapshot: normalized,
        revision,
        extractionStatus: normalized.extractionStatus || 'ready',
        analysisStatus: 'idle',
        scores: null,
        scoreByRevision: new Map(),
        job: null,
        error: null,
        override: false,
        manualHidden: false,
        policy: null,
        views: new Map(),
        createdAt: now(),
        updatedAt: now(),
        lastSeenAt: now(),
        detachedAt: null,
        effect: null
      };
    }

    function trimScoreHistory(record) {
      while (record.scoreByRevision.size > 4) {
        const oldest = record.scoreByRevision.keys().next().value;
        record.scoreByRevision.delete(oldest);
      }
    }

    function upsert(snapshot) {
      if (!snapshot?.key) return null;
      let record = records.get(snapshot.key);
      if (!record) {
        record = newRecord(snapshot);
        records.set(record.key, record);
      } else {
        const nextSnapshot = cloneSnapshot(snapshot);
        const nextRevision = snapshot.revision || revisionForSnapshot(nextSnapshot);
        const changed = record.revision !== nextRevision;
        record.snapshot = nextSnapshot;
        record.contentType = nextSnapshot.contentType;
        record.extractionStatus = nextSnapshot.extractionStatus || 'ready';
        record.updatedAt = now();
        record.lastSeenAt = now();
        record.detachedAt = null;
        if (changed) {
          record.revision = nextRevision;
          record.scores = record.scoreByRevision.get(nextRevision) || null;
          record.analysisStatus = record.scores ? 'ready' : 'idle';
          record.job = null;
          record.error = null;
          record.policy = null;
          record.effect = null;
          record.manualHidden = false;
        } else if (record.scores) {
          record.analysisStatus = 'ready';
        }
      }
      while (records.size > maxRecords) {
        const candidate = Array.from(records.values())
          .filter(item => item.views.size === 0 && item.key !== record.key)
          .sort((left, right) => left.lastSeenAt - right.lastSeenAt)[0];
        if (!candidate) break;
        records.delete(candidate.key);
      }
      return record;
    }

    function get(key) {
      const record = records.get(key);
      if (record) record.lastSeenAt = now();
      return record || null;
    }

    function all() {
      return Array.from(records.values());
    }

    function attachView(key, element) {
      const record = records.get(key);
      if (!record || !element) return null;
      const existing = Array.from(record.views.values()).find(view => view.element === element);
      if (existing) {
        record.lastSeenAt = now();
        existing.connected = true;
        return existing;
      }
      const view = {
        id: `view-${++viewSequence}`,
        element,
        connected: true,
        visible: false,
        near: false,
        target: null,
        placeholder: null,
        originalTargetState: null,
        renderKey: null
      };
      record.views.set(view.id, view);
      record.lastSeenAt = now();
      record.detachedAt = null;
      return view;
    }

    function detachView(key, element) {
      const record = records.get(key);
      if (!record) return;
      for (const [viewId, view] of record.views) {
        if (view.element === element) record.views.delete(viewId);
      }
      if (record.views.size === 0) record.detachedAt ||= now();
    }

    function views(key) {
      return Array.from(records.get(key)?.views.values() || []);
    }

    function setVisibility(key, element, visibility) {
      const record = records.get(key);
      const view = Array.from(record?.views.values() || []).find(item => item.element === element);
      if (!view) return;
      view.visible = Boolean(visibility.visible);
      view.near = Boolean(visibility.near);
      record.lastSeenAt = now();
    }

    function setPolicy(key, policy) {
      const record = records.get(key);
      if (!record) return null;
      record.policy = policy;
      record.updatedAt = now();
      return record;
    }

    function setAnalysisStatus(key, status, job = null, error = null) {
      const record = records.get(key);
      if (!record) return null;
      record.analysisStatus = status;
      record.job = job;
      record.error = error;
      record.updatedAt = now();
      return record;
    }

    function commitScores(key, revision, scores) {
      const record = records.get(key);
      if (!record || record.revision !== revision) return false;
      const normalized = Object.freeze({
        ...scores,
        categoryProbabilities: { ...(scores.categoryProbabilities || {}) },
        assessedAt: scores.assessedAt || now()
      });
      record.scoreByRevision.set(revision, normalized);
      trimScoreHistory(record);
      record.scores = normalized;
      record.analysisStatus = 'ready';
      record.job = null;
      record.error = null;
      record.updatedAt = now();
      return true;
    }

    function setOverride(key, value) {
      const record = records.get(key);
      if (!record) return null;
      record.override = Boolean(value);
      record.updatedAt = now();
      return record;
    }

    function setEffect(key, effect) {
      const record = records.get(key);
      if (!record) return null;
      record.effect = effect;
      record.updatedAt = now();
      return record;
    }

    function setManualHidden(key, value) {
      const record = records.get(key);
      if (!record) return null;
      record.manualHidden = Boolean(value);
      record.updatedAt = now();
      return record;
    }

    function cleanup() {
      const timestamp = now();
      for (const record of records.values()) {
        for (const [viewId, view] of record.views) {
          if (!view.element?.isConnected) record.views.delete(viewId);
        }
        if (record.views.size === 0) {
          record.detachedAt ||= timestamp;
          if (timestamp - record.detachedAt > retentionMs) records.delete(record.key);
        }
      }
    }

    function diagnostics() {
      return all().map(record => ({
        key: record.key,
        platform: record.snapshot.platform || 'reddit',
        revision: record.revision,
        extractionStatus: record.extractionStatus,
        analysisStatus: record.analysisStatus,
        score: Boolean(record.scores),
        views: record.views.size,
        override: record.override,
        manualHidden: record.manualHidden,
        policy: record.policy?.action,
        errorCode: record.error?.code
      }));
    }

    return {
      all,
      attachView,
      cleanup,
      commitScores,
      detachView,
      diagnostics,
      get,
      setEffect,
      setManualHidden,
      setAnalysisStatus,
      setPolicy,
      setOverride,
      setVisibility,
      upsert,
      views
    };
  }

  modules.store = { createPostStore };
})(globalThis);
