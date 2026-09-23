// Reddit DOM adapter. It reports stable identities and structured snapshots;
// scheduling, policy, rendering, and pet effects live elsewhere.
(function attachRedditDetector(global) {
  'use strict';

  const itemIds = new WeakMap();
  let generatedId = 0;
  const MAX_TEXT_CHARS = 8000;
  const MAX_TITLE_CHARS = 2000;

  const POST_SELECTORS = [
    'shreddit-post',
    'shreddit-ad-post',
    'article[data-testid="post-container"]',
    '[data-testid="post-container"]'
  ];
  const COMMENT_SELECTORS = [
    'shreddit-comment',
    '[data-testid="comment"]',
    'article[data-testid^="comment"]'
  ];
  const OWNED_SELECTORS = [
    '.gomimon-ai-panel',
    '.gomimon-comment-marker',
    '.gomimon-assessment-popover',
    '.gomimon-post-marker',
    '.gomimon-filter-placeholder',
    '.gomimon-pet-overlay',
    '.gomimon-eaten-placeholder'
  ];

  function ownedNode(element) {
    return Boolean(element?.closest?.(OWNED_SELECTORS.join(',')));
  }

  function textOf(element) {
    if (!element || ownedNode(element)) return '';
    const parts = [];
    const showText = element.ownerDocument?.defaultView?.NodeFilter?.SHOW_TEXT || 4;
    const walker = element.ownerDocument?.createTreeWalker?.(element, showText);
    if (!walker) return '';
    let node = walker.nextNode();
    while (node) {
      if (!ownedNode(node.parentElement)) parts.push(node.nodeValue || '');
      node = walker.nextNode();
    }
    return parts.join('')
      .replace(/\u00a0/gu, ' ')
      .replace(/[ \t]+/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .trim();
  }

  function matches(element, selector) {
    return Boolean(element && element.nodeType === 1 && element.matches && element.matches(selector));
  }

  function isComment(element) {
    return Boolean(element && (
      String(element.tagName || '').toLowerCase() === 'shreddit-comment' ||
      matches(element, '[data-testid="comment"]') ||
      matches(element, 'article[data-testid^="comment"]')
    ));
  }

  function isPost(element) {
    return matches(element, POST_SELECTORS.join(','));
  }

  function isItem(element) {
    return isComment(element) || isPost(element);
  }

  function closestItem(element) {
    let current = element && element.nodeType === 1 ? element : element?.parentElement;
    let depth = 0;
    while (current && depth < 20) {
      if (isItem(current)) return current;
      current = current.parentElement;
      depth += 1;
    }
    return null;
  }

  function ownMatch(element, selector) {
    if (!element?.querySelectorAll) return null;
    const candidates = Array.from(element.querySelectorAll(selector));
    return candidates.find(candidate => closestItem(candidate) === element) || null;
  }

  function ownMatchFromSelectors(element, selectors) {
    for (const selector of selectors) {
      const match = ownMatch(element, selector);
      if (match) return match;
    }
    return null;
  }

  function textContainer(element) {
    if (!element) return null;
    if (isComment(element)) {
      return ownMatchFromSelectors(element, [
        '[slot="comment"]',
        '[data-testid="comment-content"]',
        '[data-post-click-location="text-body"]',
        'div.md'
      ]);
    }
    return element;
  }

  function postTitle(element) {
    return ownMatchFromSelectors(element, [
      '[slot="title"]',
      'a[id^="post-title"]',
      '[data-testid="post-title"]',
      '[data-post-click-location="title"]',
      'h1[id^="post-title"]',
      'h2[id^="post-title"]',
      'h3[id^="post-title"]',
      'h1',
      'h2',
      'h3'
    ]);
  }

  function postBody(element) {
    return ownMatchFromSelectors(element, [
      '[slot="text-body"]',
      '[slot="post-body"]',
      '[data-testid="post-text-container"]',
      '[data-testid="post-content"]',
      '[data-post-click-location="text-body"]',
      'shreddit-post-text-body',
      '[id*="-post-rtjson-content"]',
      '[data-click-id="text"] .md',
      '.usertext-body .md',
      'div.md'
    ]);
  }

  function extractMetadata(element, selectors) {
    return textOf(ownMatchFromSelectors(element, selectors));
  }

  function extractSubreddit(element) {
    return extractMetadata(element, [
      '[data-testid="subreddit-name"]',
      'a[data-click-id="subreddit"]',
      'a[href^="/r/"]',
      'a[href*="reddit.com/r/"]'
    ]);
  }

  function extractFlair(element) {
    return extractMetadata(element, [
      '[data-testid="post-flair"]',
      '[data-testid="flair"]',
      '[slot="flair"]',
      'shreddit-post-flair'
    ]);
  }

  function hasOwnAttribute(element, names) {
    return names.some(name => {
      if (!element.hasAttribute?.(name)) return false;
      const value = String(element.getAttribute?.(name) || '').trim().toLowerCase();
      return value !== 'false' && value !== '0' && value !== 'no';
    });
  }

  function isRedditAd(element) {
    if (!isPost(element)) return false;
    if (matches(element, 'shreddit-ad-post')) return true;
    if (hasOwnAttribute(element, [
      'data-ad-preview',
      'data-promoted',
      'is-promoted',
      'promoted',
      'data-sponsored',
      'sponsored'
    ])) return true;
    const postType = String(element.getAttribute?.('post-type') || '').toLowerCase();
    if (postType === 'promoted' || postType === 'sponsored' || postType === 'ad') return true;
    const testId = String(element.getAttribute?.('data-testid') || '').toLowerCase();
    if (testId.includes('promoted') || testId.includes('sponsored')) return true;
    const ariaLabel = String(element.getAttribute?.('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('promoted') || ariaLabel.includes('sponsored')) return true;
    return Boolean(ownMatchFromSelectors(element, [
      '[data-testid="promoted-post"]',
      '[data-testid="promoted-label"]',
      '[data-testid="sponsored-post"]',
      '[data-testid*="promoted" i]',
      '[data-testid*="sponsored" i]',
      '[aria-label="Promoted"]',
      '[aria-label="Sponsored"]',
      '[aria-label*="Promoted" i]',
      '[aria-label*="Sponsored" i]',
      '[data-ad-preview]'
    ]));
  }

  function isDiscussionPage() {
    return /\/comments\//u.test(String(global.location?.pathname || ''));
  }

  function canonicalPermalink(element) {
    const candidate = element.getAttribute?.('permalink') ||
      element.getAttribute?.('data-permalink') ||
      ownMatchFromSelectors(element, [
        'a[href*="/comments/"]',
        'a[data-click-id="comments"]'
      ])?.getAttribute?.('href');
    if (!candidate) return null;
    try {
      const url = new URL(candidate, global.location?.href || 'https://www.reddit.com/');
      if (!/(^|\.)reddit\.com$/iu.test(url.hostname)) return null;
      return url.pathname.replace(/\/+$/u, '') || '/';
    } catch (error) {
      return null;
    }
  }

  function stableKey(element) {
    const identity = element.getAttribute?.('thingid') ||
      element.getAttribute?.('data-fullname') ||
      canonicalPermalink(element) ||
      element.getAttribute?.('id');
    const type = isComment(element) ? 'comment' : 'post';
    const cached = itemIds.get(element);
    if (cached && cached.type === type && cached.identity === identity) return cached.key;
    const key = identity
      ? `reddit-${type}-${identity}`
      : cached?.key || `reddit-${type}-session-${++generatedId}`;
    itemIds.set(element, { key, type, identity });
    if (element.dataset) element.dataset.gomimonItemKey = key;
    return key;
  }

  function revisionFor(snapshot) {
    const helper = global.GomiMonDetectorModules?.revision?.revisionForSnapshot;
    if (helper) return helper(snapshot);
    let hash = 2166136261;
    const value = JSON.stringify({
      contentType: snapshot.contentType,
      text: snapshot.text,
      title: snapshot.title,
      body: snapshot.body,
      subreddit: snapshot.subreddit,
      flair: snapshot.flair,
      truncated: snapshot.truncated
    });
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `reddit-detector-v2:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function describe(element) {
    if (!isItem(element)) return null;
    const comment = isComment(element);
    const titleNode = comment ? null : postTitle(element);
    const bodyNode = comment ? textContainer(element) : postBody(element);
    const rawTitle = textOf(titleNode) || (comment ? '' : String(element.getAttribute?.('post-title') || '').trim());
    const rawBody = textOf(bodyNode);
    const title = rawTitle.slice(0, MAX_TITLE_CHARS);
    const body = comment ? rawBody : rawBody.slice(0, MAX_TEXT_CHARS);
    const rawText = comment ? rawBody : [rawTitle, rawBody].filter(Boolean).join('\n\n');
    const text = rawText.slice(0, MAX_TEXT_CHARS);
    const knownContent = Boolean(rawTitle || titleNode || bodyNode);
    const extractionStatus = !knownContent
      ? 'unsupported'
      : text
        ? 'ready'
        : 'empty';
    const snapshot = {
      platform: 'reddit',
      key: stableKey(element),
      contentType: comment ? 'comment' : 'post',
      text,
      title,
      body,
      subreddit: comment ? '' : extractSubreddit(element),
      flair: comment ? '' : extractFlair(element),
      truncated: rawText.length > MAX_TEXT_CHARS,
      wordCount: text ? text.split(/\s+/u).length : 0,
      extractionStatus,
      extractionMethod: comment ? 'comment-content' : bodyNode ? 'post-title-body' : rawTitle ? 'post-title' : 'unknown',
      extractionCompleteness: comment
        ? bodyNode ? 'complete' : 'unsupported'
        : bodyNode
          ? body ? 'complete' : 'body_pending'
          : rawTitle ? 'title_only' : 'unsupported',
      isRedditAd: comment ? false : isRedditAd(element),
      isAd: comment ? false : isRedditAd(element),
      isDiscussionPage: isDiscussionPage(),
      element,
      textContainer: comment ? bodyNode : element
    };
    snapshot.revision = revisionFor(snapshot);
    return snapshot;
  }

  function findItems(root = document) {
    const items = [];
    if (isItem(root)) items.push(root);
    if (!root?.querySelectorAll) return items;
    const selector = [...POST_SELECTORS, ...COMMENT_SELECTORS].join(',');
    root.querySelectorAll(selector).forEach(item => items.push(item));
    return Array.from(new Set(items));
  }

  global.GomiMonRedditDetector = {
    closestItem,
    describe,
    extractText: element => describe(element)?.text || '',
    findItems,
    isComment,
    isItem,
    isOwnedNode: ownedNode,
    isPost,
    isRedditAd,
    isDiscussionPage,
    textContainer
  };
})(globalThis);
