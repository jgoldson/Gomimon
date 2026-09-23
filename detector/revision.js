// Stable assessment identity helpers for the shared detector.
(function attachRevision(global) {
  'use strict';

  const modules = global.GomiMonDetectorModules || (global.GomiMonDetectorModules = {});
  const ANALYSIS_CONTRACT_VERSION = 'social-detector-v3';
  const PROTOCOL_VERSION = 2;

  function canonicalInput(snapshot) {
    return {
      platform: snapshot.platform || 'reddit',
      quotedText: snapshot.quotedText || '',
      contentType: snapshot.contentType || '',
      text: snapshot.text || '',
      title: snapshot.title || '',
      body: snapshot.body || '',
      subreddit: snapshot.subreddit || '',
      flair: snapshot.flair || '',
      truncated: Boolean(snapshot.truncated)
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function revisionForSnapshot(snapshot) {
    return `${ANALYSIS_CONTRACT_VERSION}:${hashString(JSON.stringify(canonicalInput(snapshot)))}`;
  }

  modules.revision = {
    ANALYSIS_CONTRACT_VERSION,
    PROTOCOL_VERSION,
    canonicalInput,
    hashString,
    revisionForSnapshot
  };
})(globalThis);
