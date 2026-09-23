// Pure filtering and analysis decisions for platform detector records.
(function attachPolicy(global) {
  'use strict';

  const modules = global.GomiMonDetectorModules;
  const CATEGORY_THRESHOLDS = { conservative: 0.90, balanced: 0.80, aggressive: 0.70 };
  const AI_THRESHOLDS = { strict: 0.95, balanced: 0.90, relaxed: 0.80 };
  const REMOTE_CATEGORIES = new Set([
    'politics',
    'promotions',
    'ragebait',
    'celebrity_gossip',
    'sports',
    'crypto'
  ]);
  const CATEGORY_LABELS = {
    politics: 'Politics',
    ads: 'Ads',
    promotions: 'Promotions',
    ragebait: 'Ragebait',
    celebrity_gossip: 'Celebrity gossip',
    sports: 'Sports',
    crypto: 'Crypto',
    ai_content: 'AI content'
  };
  function minAiWords(record) {
    return global.GomiMonPlatforms?.registry[record?.snapshot?.platform || 'reddit']?.minAiWords || 30;
  }

  function categories(settings) {
    return Array.isArray(settings?.categories) ? settings.categories.map(category => category === 'reddit_ads' ? 'ads' : category) : [];
  }

  function hasProbability(value) {
    return value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function categoryFilterApplies(record) {
    return record?.contentType === 'post' && !record.snapshot.isDiscussionPage;
  }

  function requestedJudgements(record, settings, force = false) {
    if (!record || record.extractionStatus !== 'ready') return null;
    const enabled = categories(settings);
    const aiEligible = Number(record.snapshot?.wordCount || 0) >= minAiWords(record);
    const aiDietEnabled = enabled.includes('ai_content');
    const needsAi = aiEligible && (settings.mode === 'automatic' || aiDietEnabled || force) &&
      (!record.scores || !hasProbability(record.scores.aiProbability) || force);
    const remote = categoryFilterApplies(record)
      ? enabled.filter(category => REMOTE_CATEGORIES.has(category))
      : [];
    const missingCategories = remote.filter(category =>
      !hasProbability(record.scores?.categoryProbabilities?.[category])
    );
    if (!needsAi && missingCategories.length === 0) return null;
    return {
      includeAi: needsAi,
      categories: missingCategories
    };
  }

  function matchingCategories(record, settings) {
    const threshold = CATEGORY_THRESHOLDS[settings.categoryStrength] || CATEGORY_THRESHOLDS.balanced;
    const probabilities = record?.scores?.categoryProbabilities || {};
    return categories(settings).filter(category => {
      if (category === 'ads') return false;
      if (category === 'ai_content') {
        const probability = Number(record.scores?.aiProbability);
        return Number.isFinite(probability) && probability >= threshold;
      }
      const probability = Number(probabilities[category]);
      return Number.isFinite(probability) && probability >= threshold;
    });
  }

  function evaluatePolicy(record, settings) {
    if (!record) return { action: 'show', reason: 'missing' };
    if (record.override) return { action: 'show', reason: 'user_override', labels: [] };
    if (record.manualHidden) return { action: 'hide', reason: 'manual_feed', labels: [] };
    const enabled = categories(settings);
    // Explicit platform ad metadata does not depend on extractable text or AI analysis.
    if (categoryFilterApplies(record) && enabled.includes('ads') && (record.snapshot.isAd || record.snapshot.isRedditAd)) {
      return { action: 'hide', reason: 'ad', labels: ['ads'] };
    }

    if (record.extractionStatus === 'settling') return { action: 'show', reason: 'waiting_for_text', labels: [] };
    if (record.extractionStatus === 'unsupported') return { action: 'show', reason: 'unsupported_layout', labels: [] };
    if (record.extractionStatus === 'empty') return { action: 'show', reason: 'empty_text', labels: [] };

    const matched = matchingCategories(record, settings);
    if (categoryFilterApplies(record) && matched.length > 0) {
      return { action: 'hide', reason: 'category', labels: matched };
    }

    const probability = hasProbability(record.scores?.aiProbability)
      ? Number(record.scores.aiProbability)
      : null;
    const aiThreshold = AI_THRESHOLDS[settings.sensitivity] || AI_THRESHOLDS.strict;
    if (settings.mode === 'automatic' && probability !== null && probability >= aiThreshold) {
      return { action: 'hide', reason: 'ai_likelihood', labels: [] };
    }
    return {
      action: 'show',
      reason: record.scores ? 'allowed' : 'awaiting_analysis',
      labels: matched
    };
  }

  // History describes detected evidence, independently of hide/show overrides
  // and whether automatic feeding is enabled.
  function historyCategories(record, settings, decision) {
    const labels = new Set(decision?.labels || []);
    if (record?.snapshot?.isAd || record?.snapshot?.isRedditAd) labels.add('ads');
    if (decision?.reason === 'ai_likelihood' || record?.scores?.label === 'high') labels.add('ai_content');
    for (const category of matchingCategories(record, settings)) labels.add(category);
    return [...labels];
  }

  function categoryNames(values) {
    return (values || []).map(category => CATEGORY_LABELS[category] || category);
  }

  modules.policy = {
    minAiWords,
    AI_THRESHOLDS,
    CATEGORY_THRESHOLDS,
    CATEGORY_LABELS,
    REMOTE_CATEGORIES,
    categoryFilterApplies,
    categoryNames,
    historyCategories,
    evaluatePolicy,
    matchingCategories,
    requestedJudgements
  };
})(globalThis);
