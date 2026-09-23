// X home-feed adapter. Selectors verified against the live desktop feed.
(function attachXDetector(global) {
  'use strict';
  const ITEM = 'article[data-testid="tweet"]';
  const OWNED = '.gomimon-ai-panel,.gomimon-post-marker,.gomimon-filter-placeholder,.gomimon-pet-overlay,.gomimon-eaten-placeholder';
  const MAX_CHARS = 8000;
  function isOwnedNode(node) { return Boolean(node?.closest?.(OWNED)); }
  function isItem(node) { return Boolean(node?.matches?.(ITEM) && !node.parentElement?.closest(ITEM)); }
  function closestItem(node) {
    let item = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(ITEM);
    while (item?.parentElement?.closest(ITEM)) item = item.parentElement.closest(ITEM);
    return item || null;
  }
  function quoteCard(node, item) {
    // Quote cards are div[role=link] containing their own User-Name. Ordinary
    // links/mentions in tweetText must not be treated as quoted prose.
    let current = node?.parentElement;
    while (current && current !== item) {
      if (current.matches('article[data-testid="tweet"],div[role="link"]') &&
          current.querySelector('[data-testid="User-Name"]')) return current;
      current = current.parentElement;
    }
    return null;
  }
  function ownNodes(item, selector) {
    return Array.from(item.querySelectorAll(selector)).filter(node => !isOwnedNode(node) && !quoteCard(node, item));
  }
  function textOf(element) {
    if (!element) return '';
    const parts = [];
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    let node;
    while ((node = walker.nextNode())) {
      const hidden = node.parentElement.closest('[hidden],[aria-hidden="true"]');
      if (!isOwnedNode(node.parentElement) && (!hidden || hidden.classList.contains('gomimon-hidden-target'))) parts.push(node.nodeValue);
    }
    return parts.join('').normalize('NFKC').replace(/\u00a0/gu, ' ').replace(/[ \t]+/gu, ' ').trim();
  }
  function statusId(href) {
    try {
      const url = new URL(href, global.location?.href || 'https://x.com/home');
      if (global.GomiMonPlatforms.fromUrl(url.href) !== 'x') return null;
      return /^\/[^/]+\/status\/(\d+)(?:\/|$)/u.exec(url.pathname)?.[1] || null;
    } catch { return null; }
  }
  function identity(item) {
    const timestamp = ownNodes(item, 'a[href] time').map(node => node.closest('a')).find(node => statusId(node.href));
    if (timestamp) return statusId(timestamp.href);
    // Ads can omit the timestamp but still expose their own analytics link.
    const analytics = ownNodes(item, '[role="group"] a[href$="/analytics"]').find(node => statusId(node.href));
    return analytics ? statusId(analytics.href) : null;
  }
  function isAd(item) {
    if (!item.closest('[data-testid="placementTracking"]')) return false;
    const user = ownNodes(item, '[data-testid="User-Name"]')[0];
    // X wraps the author in several layout divs; the Ad label is a sibling of
    // that branch, not necessarily a sibling of User-Name. Stop before entering
    // the post body so prose, card labels, and quoted ads cannot count as ads.
    for (let header = user?.parentElement; header && header !== item; header = header.parentElement) {
      if (header.querySelector('[data-testid="tweetText"],[data-testid="tweetPhoto"],[data-testid="videoPlayer"],[data-testid="card.wrapper"],[role="group"]')) break;
      if (!header.querySelector('[data-testid="caret"]')) continue;
      return ownNodes(header, 'span').some(node => !user.contains(node) &&
        !node.closest('a') && textOf(node) === 'Ad');
    }
    return false;
  }
  function isSupportedPage() {
    if (!global.GomiMonPlatforms.supportsPage('x', global.location?.href)) return false;
    // Custom pinned lists can also use /home. Only the two standard feeds ship.
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    return Boolean(selected && /^(For you|Following)$/iu.test(selected.textContent.trim()));
  }
  function describe(item) {
    if (!isItem(item) || item.closest('[role="dialog"],[contenteditable="true"]')) return null;
    const id = identity(item);
    if (!id) return null; // No stable identity: leave unfamiliar layouts alone.
    const nodes = Array.from(item.querySelectorAll('[data-testid="tweetText"]')).filter(node => !isOwnedNode(node));
    const authored = nodes.filter(node => !quoteCard(node, item));
    const rawText = authored.map(textOf).filter(Boolean).join('\n\n');
    const rawQuote = nodes.filter(node => quoteCard(node, item)).map(textOf).filter(Boolean).join('\n\n');
    const text = rawText.slice(0, MAX_CHARS);
    const quotedText = rawQuote.slice(0, MAX_CHARS);
    const partial = Boolean(item.querySelector('[data-testid="tweet-text-show-more-link"]')) ||
      rawText.length > MAX_CHARS || rawQuote.length > MAX_CHARS;
    const snapshot = {
      platform: 'x', key: `x-post-${id}`, contentType: 'post',
      text, body: text, title: '', quotedText, subreddit: '', flair: '',
      wordCount: text ? text.split(/\s+/u).length : 0,
      truncated: partial,
      extractionStatus: text || quotedText ? 'ready' : 'empty',
      extractionMethod: quotedText ? 'x-text-quote' : 'x-text',
      extractionCompleteness: partial ? 'partial' : 'complete',
      isAd: isAd(item), isDiscussionPage: false,
      element: item, textContainer: authored[0] || item
    };
    snapshot.revision = global.GomiMonDetectorModules.revision.revisionForSnapshot(snapshot);
    return snapshot;
  }
  function findItems(root = document) {
    if (!isSupportedPage()) return [];
    return [...(isItem(root) ? [root] : []), ...Array.from(root.querySelectorAll?.(ITEM) || [])]
      .filter(item => isItem(item) && !item.closest('[role="dialog"],[contenteditable="true"]'));
  }
  global.GomiMonXDetector = {
    platform: 'x', closestItem, describe, findItems, isItem, isPost: isItem,
    isComment: () => false, isOwnedNode, isAd, isSupportedPage,
    textContainer: item => describe(item)?.textContainer,
    postActionContainer: item => ownNodes(item, '[role="group"]').find(node => node.querySelector('[data-testid="reply"]')),
    extractText: item => describe(item)?.text || ''
  };
})(globalThis);
