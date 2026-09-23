// Bounded, viewport-aware scheduler for detector analysis jobs.
(function attachScheduler(global) {
  'use strict';

  const modules = global.GomiMonDetectorModules;

  function createScheduler({
    maxQueue = 20,
    maxRunning = 2,
    retryDelayMs = 2000,
    maxRetries = 1,
    now = () => Date.now(),
    setTimer = global.setTimeout.bind(global),
    clearTimer = global.clearTimeout.bind(global),
    execute,
    canRun,
    onQueued = () => {},
    onStart = () => {},
    onComplete = () => {},
    onDeferred = () => {},
    onRetry = () => {},
    onError = () => {},
    onDrop = () => {},
    onCancel = () => {}
  } = {}) {
    const queue = [];
    const jobs = new Map();
    const running = new Map();
    const deferredTimers = new Map();
    let sequence = 0;
    let postStreak = 0;
    let pumping = false;

    function jobKey(job) {
      return `${job.itemKey}:${job.revision}:${job.includeAi ? 'ai' : ''}:${[...(job.categories || [])].sort().join(',')}`;
    }

    function priority(job) {
      return Number.isFinite(job.priority) ? job.priority : 4;
    }

    function isAutomatic(job) {
      return job.source !== 'manual';
    }

    function removeQueued(key, predicate = () => true) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].itemKey === key && predicate(queue[index])) {
          const removed = queue.splice(index, 1)[0];
          jobs.delete(removed.key);
          onDrop(removed, 'cancelled');
        }
      }
    }

    function chooseNext() {
      if (queue.length === 0) return null;
      const candidates = queue
        .map((job, index) => ({ job, index }))
        .sort((left, right) => priority(left.job) - priority(right.job) || left.job.sequence - right.job.sequence);
      let selected = candidates[0];
      if (postStreak >= 4) {
        const comment = candidates.find(candidate =>
          candidate.job.contentType === 'comment' && priority(candidate.job) <= 2
        );
        if (comment) selected = comment;
      }
      queue.splice(selected.index, 1);
      return selected.job;
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (running.size < maxRunning && queue.length > 0) {
          const job = chooseNext();
          if (!job) break;
          jobs.delete(job.key);
          if (!canRun(job)) {
            onDrop(job, 'ineligible');
            continue;
          }
          running.set(job.operationId, job);
          if (job.contentType === 'post') postStreak += 1;
          else postStreak = 0;
          onStart(job);
          run(job);
        }
      } finally {
        pumping = false;
      }
    }

    async function run(job) {
      try {
        const outcome = await execute(job);
        if (outcome?.state === 'deferred') {
          running.delete(job.operationId);
          onDeferred(job, outcome);
          scheduleDeferred(job, outcome.retryAt, outcome);
          pump();
          return;
        }
        running.delete(job.operationId);
        onComplete(job, outcome);
      } catch (error) {
        running.delete(job.operationId);
        const retryAt = error?.retryAt || (
          error?.code === 'QUOTA_EXCEEDED' ? error?.resetAt : null
        );
        if (retryAt) {
          const deferred = { retryAt, reason: error.code || 'deferred', scope: error.scope, quota: error.quota };
          onDeferred(job, deferred);
          scheduleDeferred(job, retryAt, deferred);
          pump();
          return;
        }
        const transient = error?.transient !== false && error?.code !== 'UNAUTHENTICATED' &&
          error?.code !== 'QUOTA_EXCEEDED' && error?.code !== 'INVALID_REQUEST';
        if (transient && job.attempt < maxRetries) {
          const retryJob = { ...job, attempt: job.attempt + 1 };
          onRetry(retryJob, error);
          const timer = setTimer(() => {
            deferredTimers.delete(job.operationId);
            enqueue(retryJob, true);
          }, retryDelayMs);
          deferredTimers.set(job.operationId, { timer, job: retryJob });
        } else {
          onError(job, error);
        }
      } finally {
        pump();
      }
    }

    function scheduleDeferred(job, retryAt, details = {}) {
      const retryTimestamp = typeof retryAt === 'number' ? retryAt : Date.parse(String(retryAt));
      const delay = Math.max(
        250,
        Math.min(24 * 60 * 60 * 1000, Number.isFinite(retryTimestamp) ? retryTimestamp - now() : retryDelayMs)
      );
      const timer = setTimer(() => {
        deferredTimers.delete(job.operationId);
        enqueue({ ...job, attempt: job.attempt }, true);
      }, delay);
      deferredTimers.set(job.operationId, { timer, job, details });
    }

    function enqueue(input, internal = false) {
      const job = {
        ...input,
        operationId: input.operationId || `operation-${++sequence}`,
        sequence: ++sequence,
        attempt: Number(input.attempt || 0),
        key: jobKey(input)
      };
      if (jobs.has(job.key) || queue.some(item => item.key === job.key)) return job;
      if (!internal && isAutomatic(job) && queue.length >= maxQueue) {
        const automatic = queue
          .map((candidate, index) => ({ candidate, index }))
          .filter(item => isAutomatic(item.candidate))
          .sort((left, right) => priority(right.candidate) - priority(left.candidate) || right.candidate.sequence - left.candidate.sequence);
        const dropped = automatic[0];
        if (dropped && priority(dropped.candidate) >= priority(job)) {
          queue.splice(dropped.index, 1);
          jobs.delete(dropped.candidate.key);
          onDrop(dropped.candidate, 'queue_full');
        } else if (!dropped) {
          onDrop(job, 'queue_full');
          return job;
        } else {
          onDrop(job, 'queue_full');
          return job;
        }
      }
      jobs.set(job.key, job);
      queue.push(job);
      onQueued(job);
      pump();
      return job;
    }

    function cancelItem(itemKey, reason = 'cancelled') {
      removeQueued(itemKey);
      for (const [operationId, deferred] of deferredTimers) {
        if (deferred.job?.itemKey === itemKey) {
          clearTimer(deferred.timer);
          deferredTimers.delete(operationId);
          onDrop(deferred.job, reason);
        }
      }
      return reason;
    }

    function cancelAll(reason = 'cancelled') {
      for (const job of queue.splice(0)) {
        jobs.delete(job.key);
        onDrop(job, reason);
      }
      for (const deferred of deferredTimers.values()) {
        clearTimer(deferred.timer);
        onDrop(deferred.job, reason);
      }
      deferredTimers.clear();
      for (const [operationId, job] of running) {
        running.delete(operationId);
        onCancel(job, reason);
      }
    }

    function resumeAccountQuotaDeferred() {
      for (const [operationId, deferred] of deferredTimers) {
        if (deferred.details?.reason !== 'QUOTA_EXCEEDED' || deferred.details?.scope === 'server') continue;
        clearTimer(deferred.timer);
        deferredTimers.delete(operationId);
        enqueue(deferred.job, true);
      }
    }

    function diagnostics() {
      return {
        queued: queue.length,
        running: running.size,
        deferred: deferredTimers.size,
        items: queue.map(job => ({ itemKey: job.itemKey, revision: job.revision, priority: job.priority }))
      };
    }

    return { cancelAll, cancelItem, diagnostics, enqueue, pump, removeQueued, resumeAccountQuotaDeferred };
  }

  modules.scheduler = { createScheduler };
})(globalThis);
