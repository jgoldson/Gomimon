import { readFileSync } from 'node:fs';

let renderer;
let record;
let view;
let settings;
let originalIntersectionObserver;
let extraViews;
const hide = { action: 'hide', reason: 'manual_feed', labels: [] };
const show = { action: 'show', reason: 'user_override', labels: [] };

beforeEach(() => {
  extraViews = [];
  originalIntersectionObserver = window.IntersectionObserver;
  jest.useFakeTimers();
  for (const path of ['revision', 'policy', 'renderer']) {
    new Function(readFileSync(new URL(`../../detector/${path}.js`, import.meta.url), 'utf8'))();
  }
  document.head.innerHTML = `<style>shreddit-post { display: block; }\n${readFileSync(new URL('../../content.css', import.meta.url), 'utf8')}</style>`;
  document.body.innerHTML = '<shreddit-post><h3>A post</h3></shreddit-post>';
  chrome.runtime.getURL = jest.fn(path => `chrome-extension://gomimon/${path}`);
  window.matchMedia = jest.fn(() => ({ matches: false }));
  view = { element: document.querySelector('shreddit-post') };
  view.element.getBoundingClientRect = () => ({ left: 100, top: 100, width: 500, height: 300, right: 600, bottom: 400 });
  record = {
    key: 't3_example', contentType: 'post', views: new Map([['one', view]]),
    snapshot: { text: 'A post' }, scores: { label: 'low', aiProbability: 0.18 }
  };
  settings = { mode: 'manual' };
  renderer = GomiMonDetectorModules.renderer.createRenderer({
    detector: { describe: () => ({ textContainer: view.element.querySelector(':scope > p') }) },
    getSettings: () => settings, onAction: jest.fn()
  });
});

afterEach(() => {
  renderer.detachView(view);
  extraViews.forEach(other => renderer.detachView(other));
  jest.clearAllTimers();
  if (originalIntersectionObserver) window.IntersectionObserver = originalIntersectionObserver;
  else delete window.IntersectionObserver;
  jest.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

test('hides Reddit custom elements despite their display rule and restores them', () => {
  renderer.render(record, hide);
  expect(getComputedStyle(view.element).display).toBe('none');
  expect(view.element.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
  renderer.render(record, show);
  expect(getComputedStyle(view.element).display).toBe('block');
  expect(view.element.hidden).toBe(false);
  expect(view.element.hasAttribute('aria-hidden')).toBe(false);
  expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
});

test.each(['ai_likelihood', 'category', 'ad'])('automatic %s filtering animates before hiding', reason => {
  renderer.render(record, { ...hide, reason });
  jest.advanceTimersByTime(0);
  expect(view.element.hidden).toBe(false);
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  renderer.render(record, { ...hide, reason });
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(2400);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  renderer.render(record, { ...hide, reason });
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test.each(['manual_feed', 'ai_likelihood', 'category', 'ad'])('%s hides immediately with animations off', reason => {
  settings.showEatingAnimations = false;
  renderer.render(record, { ...hide, reason }, { evolution: 'baby' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  renderer.render(record, show);
  expect(view.element.hidden).toBe(false);
});

test('turning animations off ends an active meal immediately', () => {
  renderer.render(record, { ...hide, reason: 'category' });
  jest.advanceTimersByTime(700);
  settings.showEatingAnimations = false;
  renderer.render(record, { ...hide, reason: 'category' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  jest.runAllTimers();
  expect(view.element.hidden).toBe(true);
});

test('automatic meals respect reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, { ...hide, reason: 'category' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test('flies in, eats, hides the post, and removes the pet without replaying on rerender', () => {
  renderer.render(record, hide, { evolution: 'baby' });
  const pet = document.querySelector('.gomimon-pet-overlay');
  expect(pet.querySelector('img').src).toContain('baby1_eat.gif');
  expect(view.element.hidden).toBe(false);
  renderer.render(record, hide);
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(50);
  expect(pet.dataset.phase).toBe('arrive');
  jest.advanceTimersByTime(600);
  expect(pet.dataset.phase).toBe('suck');
  expect(view.element.classList.contains('gomimon-vacuum-target')).toBe(true);
  jest.advanceTimersByTime(1750);
  expect(getComputedStyle(view.element).display).toBe('none');
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-vacuum-target')).toBe(false);
  expect(getComputedStyle(view.element).display).toBe('block');
});

test('reduced motion hides immediately without a pet overlay', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'egg' });
  expect(getComputedStyle(view.element).display).toBe('none');
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test.each(['restore', 'detach'])('%s cancels pending animation and delayed hiding', action => {
  renderer.render(record, hide, { evolution: 'classic-gomi' });
  jest.advanceTimersByTime(700);
  if (action === 'restore') renderer.render(record, show);
  else renderer.detachView(view);
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
  expect(view.element.hidden).toBe(false);
  expect(view.element.classList.contains('gomimon-vacuum-target')).toBe(false);
});

test.each([false, true])('feeding removes the complete comment without a placeholder (reduced motion: %s)', reducedMotion => {
  window.matchMedia.mockReturnValue({ matches: reducedMotion });
  view.element.innerHTML = '<header>Author</header><p>Comment text</p><article>A reply</article>';
  record.contentType = 'comment';
  renderer.render(record, show);
  view.commentMarker.click();
  expect(view.assessmentPopover.hidden).toBe(false);
  renderer.render(record, hide, { evolution: 'baby' });
  expect(view.assessmentPopover.hidden).toBe(true);
  jest.advanceTimersByTime(2400);
  expect(view.element.hidden).toBe(true);
  expect(getComputedStyle(view.element).display).toBe('none');
  expect(view.element.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  renderer.render(record, hide);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-filter-placeholder')).toBeNull();
  renderer.detachView(view);
  expect(view.element.hidden).toBe(false);
});

test('renders comment details without debug and places Feed at the end of the action row', () => {
  view.element.innerHTML = `
    <div slot="comment">Comment text</div>
    <div data-testid="comment-actions"><button>Reply</button></div>
  `;
  record.contentType = 'comment';
  record.snapshot.wordCount = 30;
  renderer.render(record, show);

  const marker = view.element.querySelector('.gomimon-comment-marker');
  const actionRow = view.element.querySelector('[data-testid="comment-actions"]');
  expect(marker).not.toBeNull();
  expect(marker.hidden).toBe(false);
  expect(actionRow.querySelector('.gomimon-comment-controls')).not.toBeNull();
  expect(actionRow.querySelector('[data-gomimon-action="feed"]')?.textContent).toBe('Feed');
  const popover = view.assessmentPopover;
  expect(popover.hidden).toBe(true);
  expect(actionRow.lastElementChild).toBe(view.panel);
  expect(actionRow.classList.contains('gomimon-comment-action-row')).toBe(true);
  marker.dispatchEvent(new MouseEvent('mouseenter'));
  expect(popover.hidden).toBe(false);
  expect(popover.textContent).toContain('Low AI likelihood');
  expect(popover.textContent).toContain('18% AI likelihood');
  expect(popover.querySelector('summary').textContent).toBe('View assessment');
  marker.dispatchEvent(new MouseEvent('mouseleave'));
  jest.advanceTimersByTime(200);
  expect(popover.hidden).toBe(true);
  marker.click();
  marker.dispatchEvent(new MouseEvent('mouseleave'));
  jest.advanceTimersByTime(200);
  expect(popover.hidden).toBe(false);
  expect(marker.getAttribute('aria-expanded')).toBe('true');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(popover.hidden).toBe(true);
  marker.focus();
  expect(popover.hidden).toBe(false);
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(popover.hidden).toBe(true);
  marker.click();
  renderer.detachView(view);
  expect(popover.isConnected).toBe(false);
  expect(actionRow.classList.contains('gomimon-comment-action-row')).toBe(false);
});

test('renders post assessments as a card-edge marker with an inline feed action', () => {
  view.element.innerHTML = `
    <h3>A post</h3>
    <div data-testid="post-actions"><button>Share</button></div>
  `;
  renderer.render(record, show);

  const marker = view.element.querySelector('.gomimon-post-marker');
  const actionRow = view.element.querySelector('[data-testid="post-actions"]');
  expect(marker).not.toBeNull();
  expect(marker.hidden).toBe(false);
  expect(actionRow.querySelector('.gomimon-post-controls')).not.toBeNull();
  expect(actionRow.querySelector('[data-gomimon-action="feed"]')?.textContent).toBe('Feed');
  expect(view.element.querySelector('details')).toBeNull();
  expect(view.element.textContent).not.toContain('Low AI likelihood');

  marker.dispatchEvent(new MouseEvent('mouseenter'));
  const popover = view.assessmentPopover;
  expect(popover.hidden).toBe(false);
  expect(getComputedStyle(popover).display).toBe('block');
  expect(popover.parentElement).toBe(document.body);
  expect(popover.textContent).toContain('Low AI likelihood');
  expect(popover.textContent).toContain('18% AI likelihood');
  expect(popover.querySelector('summary').textContent).toBe('View assessment');
  marker.dispatchEvent(new MouseEvent('mouseleave'));
  jest.advanceTimersByTime(200);
  expect(popover.hidden).toBe(true);
  marker.click();
  renderer.render(record, show);
  expect(popover.hidden).toBe(false);
  expect(marker.getAttribute('aria-expanded')).toBe('true');
  marker.click();
  expect(popover.hidden).toBe(true);
  marker.focus();
  expect(popover.hidden).toBe(false);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(popover.hidden).toBe(true);
  marker.click();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(popover.hidden).toBe(true);
  marker.click();
  renderer.render(record, hide);
  expect(popover.hidden).toBe(true);
  renderer.detachView(view);
  expect(popover.isConnected).toBe(false);
});


test('short comments keep Feed and explain the neutral marker in Reddit actionRow', () => {
  record.contentType = 'comment';
  record.scores = { label: 'insufficient', aiProbability: null };
  view.element.innerHTML = '<div slot="comment">Short comment.</div><div slot="actionRow"><button>Reply</button></div>';
  renderer.render(record, show);
  const row = view.element.querySelector('[slot="actionRow"]');
  expect(row.querySelector('.gomimon-comment-feed')).not.toBeNull();
  expect(view.commentMarker.hidden).toBe(false);
  expect(view.commentMarker.dataset.status).toBe('insufficient');
  view.commentMarker.click();
  expect(view.assessmentPopover.hidden).toBe(false);
  expect(view.assessmentPopover.parentElement).toBe(document.body);
  expect(view.assessmentPopover.textContent).toContain('too short');
  expect(view.assessmentPopover.textContent).not.toContain('%');
  renderer.render(record, show);
  expect(view.assessmentPopover.hidden).toBe(false);
  expect(view.commentMarker.getAttribute('aria-expanded')).toBe('true');
});

test('unavailable comments expose the error and still offer Feed', () => {
  record.contentType = 'comment';
  record.scores = null;
  record.analysisStatus = 'unavailable';
  record.error = { message: 'Extension context invalidated.' };
  renderer.render(record, show);
  view.commentMarker.click();
  expect(view.assessmentPopover.textContent).toContain('Extension context invalidated.');
  expect(view.panel.querySelector('[data-gomimon-action="feed"]')).not.toBeNull();
  expect(view.panel.querySelector('[data-gomimon-action="retry"]')).not.toBeNull();
});

test('the feed icon is permitted to load on Reddit', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  expect(manifest.web_accessible_resources.some(group =>
    group.resources.includes('assets/feed-bowl.png') && group.matches.includes('*://*.reddit.com/*')
  )).toBe(true);
});


test.each(['manual', 'automatic'])('visible posts always offer manual Feed in %s mode', mode => {
  settings.mode = mode;
  record.extractionStatus = 'ready';
  record.snapshot.wordCount = 40;
  for (const scores of [null, { label: 'insufficient' }, { label: 'category_checked' }, { label: 'low', aiProbability: 0.1 }]) {
    record.scores = scores;
    renderer.render(record, show);
    expect(view.panel.hidden).toBe(false);
    expect(view.panel.querySelector('[data-gomimon-action="feed"]')).not.toBeNull();
    if (mode === 'manual' && !scores?.aiProbability) {
      expect(view.panel.querySelector('[data-gomimon-action="analyze"]')).not.toBeNull();
    }
  }
  record.scores = null;
  record.extractionStatus = 'empty';
  record.analysisStatus = 'unavailable';
  renderer.render(record, show);
  expect(view.panel.querySelector('[data-gomimon-action="feed"]')).not.toBeNull();
  expect(view.panel.querySelector('[data-gomimon-action="retry"]')).not.toBeNull();
});


test.each([false, true])('places Feed after Share in the bottom row (shadow DOM: %s)', shadow => {
  view.element.innerHTML = '<header><button>Join</button><shreddit-post-overflow-menu></shreddit-post-overflow-menu></header><h3>Title</h3>';
  const root = shadow ? view.element.attachShadow({ mode: 'open' }) : view.element;
  const row = document.createElement('div');
  row.setAttribute('data-testid', 'post-actions');
  row.innerHTML = '<button>Vote</button><button>Comments</button><shreddit-post-share-button>Share</shreddit-post-share-button>';
  root.appendChild(row);
  renderer.render(record, show);
  const share = row.querySelector('shreddit-post-share-button');
  expect(share.nextElementSibling).toBe(view.panel);
  expect(view.panel.firstElementChild.dataset.gomimonAction).toBe('feed');
  expect(view.element.querySelector('header .gomimon-post-controls')).toBeNull();
  expect(view.panel.querySelector('style')).not.toBeNull();
  renderer.render(record, show);
  expect(row.querySelectorAll('.gomimon-post-controls')).toHaveLength(1);
});

test('keeps Feed after Share when a shadow action row is replaced', async () => {
  const root = view.element.attachShadow({ mode: 'open' });
  root.innerHTML = '<div><shreddit-post-share-button>Share</shreddit-post-share-button></div>';
  renderer.render(record, show);
  root.innerHTML = '<div><button>Votes</button><shreddit-post-share-button>Share</shreddit-post-share-button></div>';
  await Promise.resolve();
  expect(root.querySelector('shreddit-post-share-button').nextElementSibling).toBe(view.panel);
  expect(view.panel.isConnected).toBe(true);
});

test('uses the native Share slot fallback in Reddit’s shadow footer', () => {
  const root = view.element.attachShadow({ mode: 'open' });
  root.innerHTML = '<div aria-label="Actions available for this post"><div class="shreddit-post-container"><button>Votes</button><slot name="share-button"><shreddit-post-share-button>Share</shreddit-post-share-button></slot></div></div>';
  renderer.render(record, show);
  expect(root.querySelector('shreddit-post-share-button').nextElementSibling).toBe(view.panel);
  expect(view.panel.getRootNode()).toBe(root);
});

test('Feed stays visible in a subreddit shadow layout before actions hydrate', async () => {
  const root = view.element.attachShadow({ mode: 'open' });
  root.innerHTML = '<slot name="title"></slot>';
  record.extractionStatus = 'ready';
  record.snapshot.wordCount = 23;
  record.scores = null;
  renderer.render(record, show);
  expect(root.querySelector('[data-gomimon-action="feed"]')).not.toBeNull();
  const actions = document.createElement('div');
  actions.setAttribute('data-testid', 'post-actions');
  root.appendChild(actions);
  await Promise.resolve();
  expect(actions.querySelector('[data-gomimon-action="feed"]')).not.toBeNull();
});


test('post assessment stays outside the shadow action row and preserves expanded details', () => {
  const root = view.element.attachShadow({ mode: 'open' });
  root.innerHTML = '<slot></slot><div><shreddit-post-share-button>Share</shreddit-post-share-button></div>';
  record.scores = { label: 'uncertain', aiProbability: 0.52, truncated: true };
  renderer.render(record, show);
  view.postMarker.click();
  const popover = view.assessmentPopover;
  expect(view.panel.getRootNode()).toBe(root);
  expect(popover.parentElement).toBe(document.body);
  expect(popover.textContent).toContain('52% AI likelihood');
  expect(popover.textContent).toContain('Only part of this post was assessed.');
  expect(popover.textContent).toContain(record.snapshot.text);
  popover.querySelector('details').open = true;
  renderer.render(record, show);
  expect(popover.hidden).toBe(false);
  expect(popover.querySelector('details').open).toBe(true);
  record.scores = { label: 'high', aiProbability: 0.96 };
  renderer.render(record, show);
  expect(popover.hidden).toBe(true);
  view.postMarker.click();
  expect(popover.textContent).toContain('96% AI likelihood');
});

test('short posts expose category results and the active hiding threshold', () => {
  settings.categories = ['politics', 'crypto', 'sports'];
  settings.categoryStrength = 'conservative';
  record.scores = { label: 'category_checked', aiProbability: null, categoryProbabilities: { politics: .94, crypto: .7 } };
  renderer.render(record, show);
  expect(view.postMarker.hidden).toBe(false);
  expect(view.postMarker.dataset.status).toBe('category_checked');
  view.postMarker.click();
  const popover = view.assessmentPopover;
  expect(popover.hidden).toBe(false);
  expect(popover.textContent).toContain('Politics: 94% likelihood');
  expect(popover.textContent).toContain('Crypto: 70% likelihood');
  expect(popover.textContent).toContain('Sports: Not evaluated yet');
  expect(popover.textContent).toContain('90% or higher');
  expect(popover.textContent).not.toContain('0% AI likelihood');
  settings.categoryStrength = 'aggressive';
  renderer.render(record, show);
  view.postMarker.click();
  expect(popover.textContent).toContain('70% or higher');
});

test.each([
  ['queued', 'checking'], ['running', 'checking'], ['retry_wait', 'retry_wait'],
  ['blocked', 'blocked'], ['unavailable', 'unavailable'], ['idle', 'insufficient']
])('short posts retain accessible details while %s', (analysisStatus, status) => {
  record.analysisStatus = analysisStatus;
  record.scores = { label: 'insufficient', aiProbability: null };
  record.error = { message: 'Waiting for detector capacity' };
  renderer.render(record, show);
  expect(view.postMarker.hidden).toBe(false);
  expect(view.postMarker.dataset.status).toBe(status);
  view.postMarker.dispatchEvent(new MouseEvent('mouseenter'));
  expect(view.assessmentPopover.hidden).toBe(false);
  expect(view.assessmentPopover.textContent.length).toBeGreaterThan(10);
});


test('vacuum anchors to the post and restores inline properties when cancelled', () => {
  view.element.getBoundingClientRect = () => ({ left: 100, top: 100, right: 600, width: 500, height: 300 });
  view.element.style.transform = 'translateX(2px)';
  view.element.style.setProperty('--gomi-mouth-x', '5px', 'important');
  renderer.render(record, hide, { evolution: 'baby' });
  expect(view.element.style.getPropertyValue('--gomi-mouth-x')).toBe('476px');
  expect(view.element.style.getPropertyValue('--gomi-mouth-y')).toBe('150px');
  jest.advanceTimersByTime(1700);
  expect(document.querySelector('.gomimon-vacuum-pet').dataset.phase).toBe('gulp');
  renderer.render(record, show);
  jest.runAllTimers();
  expect(view.element.style.transform).toBe('translateX(2px)');
  expect(view.element.style.getPropertyValue('--gomi-mouth-x')).toBe('5px');
  expect(view.element.style.getPropertyPriority('--gomi-mouth-x')).toBe('important');
  expect(view.element.style.getPropertyValue('--gomi-mouth-y')).toBe('');
  expect(view.element.hidden).toBe(false);
});

test.each(['scroll', 'resize'])('%s finishes vacuum early and cleans up the scene', event => {
  renderer.render(record, hide, { evolution: 'baby' });
  jest.advanceTimersByTime(700);
  (event === 'scroll' ? document : window).dispatchEvent(new Event(event));
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-vacuum-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-vacuum-target')).toBe(false);
  renderer.render(record, show);
  jest.runAllTimers();
  expect(view.element.hidden).toBe(false);
});

test('fine dining serves the post, takes a small bite, then gobbles and cleans up', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'dining' });
  const scene = document.querySelector('.gomimon-dining-pet');
  expect(scene.querySelector('.gomimon-dining-table').src).toContain('assets/feeding/fine-dining-table.png');
  expect(scene.querySelector('.gomimon-meal-character').src).toContain('baby1_idle.gif');
  expect(scene.querySelector('.gomimon-dining-dish').textContent).toBe('A post');
  expect(view.element.hidden).toBe(false);
  renderer.render(record, hide);
  expect(document.querySelectorAll('.gomimon-dining-pet')).toHaveLength(1);
  jest.advanceTimersByTime(1050);
  expect(scene.dataset.phase).toBe('served');
  expect(view.element.classList.contains('gomimon-dining-target')).toBe(true);
  jest.advanceTimersByTime(400);
  expect(scene.dataset.phase).toBe('taste');
  expect(scene.querySelector('.gomimon-meal-character').src).toContain('baby1_eat.gif');
  jest.advanceTimersByTime(750);
  expect(scene.dataset.phase).toBe('gobble');
  jest.advanceTimersByTime(1200);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-dining-pet')).toBeNull();
  expect(view.element.style.getPropertyValue('--gomi-plate-scale')).toBe('');
  renderer.render(record, show);
  expect(view.element.hidden).toBe(false);
  expect(view.element.classList.contains('gomimon-dining-target')).toBe(false);
});

test('manual meals cycle through all scenes without rerenders advancing the rotation', () => {
  for (const [animation, duration] of [['vacuum', 2400], ['dining', 3400], ['magic', 3500], ['ambush', 3750], ['toaster', 3500], ['blackhole', 3300], ['popcorn', 3450], ['fishing', 3050], ['heist', 3250], ['critic', 3450], ['boss', 3450], ['helpers', 3450], ['airplane', 3450], ['vacuum', 2400]]) {
    renderer.render(record, hide, { evolution: 'baby' });
    expect(document.querySelector(`.gomimon-${animation}-pet`)).not.toBeNull();
    renderer.render(record, hide, { evolution: 'baby' });
    expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
    jest.advanceTimersByTime(duration);
    renderer.render(record, show);
    jest.advanceTimersByTime(250);
  }
});

test.each(['restore', 'detach', 'scroll', 'resize'])('fine dining handles %s during the meal', action => {
  renderer.render(record, hide, { evolution: 'bubble-gomi', animation: 'dining' });
  jest.advanceTimersByTime(1800);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-dining-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-dining-target')).toBe(false);
  expect(view.element.style.getPropertyValue('--gomi-plate-x')).toBe('');
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('fine dining respects reduced motion without creating props', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'dining' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-dining-pet')).toBeNull();
});

test('fine dining artwork is exposed to the supported feed sites', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  for (const host of ['*://*.reddit.com/*', '*://*.x.com/*', '*://*.twitter.com/*']) {
    expect(manifest.web_accessible_resources.some(group =>
      group.resources.includes('assets/feeding/fine-dining-table.png') && group.matches.includes(host)
    )).toBe(true);
  }
});


test('magic covers the post before making it vanish and reveals the belly', () => {
  view.element.getBoundingClientRect = () => ({ left: 100, top: 100, right: 600, width: 500, height: 300 });
  renderer.render(record, hide, { evolution: 'baby', animation: 'magic' });
  const scene = document.querySelector('.gomimon-magic-pet');
  expect(scene.querySelector('.gomimon-magic-cloth').style.width).toBe('500px');
  expect(scene.getAttribute('aria-hidden')).toBe('true');
  jest.advanceTimersByTime(400);
  expect(scene.dataset.phase).toBe('cover');
  expect(view.element.classList.contains('gomimon-magic-target')).toBe(false);
  jest.advanceTimersByTime(550);
  expect(scene.dataset.phase).toBe('spell');
  expect(view.element.classList.contains('gomimon-magic-target')).toBe(true);
  jest.advanceTimersByTime(500);
  expect(scene.dataset.phase).toBe('reveal');
  jest.advanceTimersByTime(400);
  expect(scene.dataset.phase).toBe('caught');
  jest.advanceTimersByTime(1650);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-magic-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.hidden).toBe(false);
  expect(view.element.classList.contains('gomimon-magic-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('magic cleans up cloth and delayed effects on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'magic' });
  jest.advanceTimersByTime(1200);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-magic-cloth')).toBeNull();
  expect(view.element.classList.contains('gomimon-magic-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('magic skips the scene for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'magic' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-magic-pet')).toBeNull();
});

test('ambush sets a trap, hides until the catch, then bites the post and clears the scene', () => {
  view.element.getBoundingClientRect = () => ({ left: 100, top: 180, right: 600, width: 500, height: 300 });
  renderer.render(record, hide, { evolution: 'baby', animation: 'ambush' });
  const scene = document.querySelector('.gomimon-ambush-pet');
  expect(scene.style.top).toBe('180px');
  expect(scene.querySelector('.gomimon-vacuum-wind')).toBeNull();
  jest.advanceTimersByTime(300);
  expect(scene.dataset.phase).toBe('set');
  expect(scene.querySelectorAll('.gomimon-ambush-grass i')).toHaveLength(13);
  expect(view.element.classList.contains('gomimon-ambush-target')).toBe(false);
  jest.advanceTimersByTime(700);
  expect(scene.dataset.phase).toBe('hide');
  jest.advanceTimersByTime(650);
  expect(scene.dataset.phase).toBe('caught');
  expect(view.element.classList.contains('gomimon-ambush-caught')).toBe(true);
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('leap');
  expect(view.element.classList.contains('gomimon-ambush-target')).toBe(false);
  jest.advanceTimersByTime(300);
  expect(scene.dataset.phase).toBe('snap');
  expect(view.element.classList.contains('gomimon-ambush-target')).toBe(true);
  jest.advanceTimersByTime(1200);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-ambush-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-ambush-caught')).toBe(false);
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-ambush-target')).toBe(false);
  expect(view.element.style.getPropertyValue('--gomi-mouth-y')).toBe('');
});

test.each(['restore', 'detach', 'scroll', 'resize'])('ambush clears pending effects on %s', action => {
  renderer.render(record, hide, { evolution: 'bubble-gomi', animation: 'ambush' });
  jest.advanceTimersByTime(1800);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-ambush-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-ambush-caught')).toBe(false);
  expect(view.element.classList.contains('gomimon-ambush-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('ambush skips motion when reduced motion is enabled', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'ambush' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-ambush-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-ambush-caught')).toBe(false);
});

test('toaster loads the post, pops it into the air, and finishes the catch', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'toaster' });
  const scene = document.querySelector('.gomimon-toaster-pet');
  expect(scene.querySelector('.gomimon-toaster-appliance').src).toContain('assets/feeding/toaster.png');
  expect(scene.querySelector('.gomimon-toaster-toast').textContent).toBe('A post');
  jest.advanceTimersByTime(1050);
  expect(scene.dataset.phase).toBe('loaded');
  expect(view.element.classList.contains('gomimon-toaster-target')).toBe(true);
  jest.advanceTimersByTime(500);
  expect(scene.dataset.phase).toBe('toast');
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('pop');
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('catch');
  jest.advanceTimersByTime(750);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-toaster-pet')).toBeNull();
  expect(view.element.style.getPropertyValue('--gomi-plate-x')).toBe('');
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-toaster-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('toaster cancels timers and removes props on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'toaster' });
  jest.advanceTimersByTime(2300);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-toaster-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-toaster-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('toaster respects reduced motion and exposes its artwork on feed sites', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'toaster' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-toaster-pet')).toBeNull();
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  for (const host of ['*://*.reddit.com/*', '*://*.x.com/*', '*://*.twitter.com/*']) {
    expect(manifest.web_accessible_resources.some(group =>
      group.resources.includes('assets/feeding/toaster.png') && group.matches.includes(host)
    )).toBe(true);
  }
});

test('black hole swallows the post into the portal before the pet eats it', () => {
  view.element.getBoundingClientRect = () => ({ left: 100, top: 180, right: 600, width: 500, height: 300 });
  renderer.render(record, hide, { evolution: 'baby', animation: 'blackhole' });
  const scene = document.querySelector('.gomimon-blackhole-pet');
  expect(view.element.style.getPropertyValue('--gomi-mouth-x')).toBe('200px');
  expect(scene.getAttribute('aria-hidden')).toBe('true');
  jest.advanceTimersByTime(300);
  expect(scene.dataset.phase).toBe('summon');
  expect(view.element.classList.contains('gomimon-blackhole-target')).toBe(false);
  jest.advanceTimersByTime(350);
  expect(scene.dataset.phase).toBe('swirl');
  expect(view.element.classList.contains('gomimon-blackhole-target')).toBe(true);
  jest.advanceTimersByTime(1000);
  expect(scene.dataset.phase).toBe('consider');
  jest.advanceTimersByTime(250);
  expect(scene.dataset.phase).toBe('devour');
  jest.advanceTimersByTime(500);
  expect(scene.dataset.phase).toBe('hiccup');
  expect(scene.querySelector('.gomimon-blackhole-star')).not.toBeNull();
  jest.advanceTimersByTime(900);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-blackhole-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-blackhole-target')).toBe(false);
  expect(view.element.style.getPropertyValue('--gomi-mouth-x')).toBe('');
});

test.each(['restore', 'detach', 'scroll', 'resize'])('black hole removes all effects on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'blackhole' });
  jest.advanceTimersByTime(1200);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-blackhole-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-blackhole-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('black hole skips the spinning scene for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'blackhole' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-blackhole-pet')).toBeNull();
});

test('movie snack pops the post, takes small bites, and tips the bucket', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'popcorn' });
  const scene = document.querySelector('.gomimon-popcorn-pet');
  expect(scene.querySelector('.gomimon-popcorn-bucket').src).toContain('assets/feeding/popcorn.png');
  jest.advanceTimersByTime(350);
  expect(scene.dataset.phase).toBe('pop');
  expect(view.element.classList.contains('gomimon-popcorn-target')).toBe(true);
  jest.advanceTimersByTime(850);
  expect(scene.dataset.phase).toBe('nibble');
  jest.advanceTimersByTime(900);
  expect(scene.dataset.phase).toBe('tip');
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('gulp');
  jest.advanceTimersByTime(750);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-popcorn-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-popcorn-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('movie snack clears kernels and timers on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'popcorn' });
  jest.advanceTimersByTime(2200);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-popcorn-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-popcorn-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('movie snack honors reduced motion and its bucket can load on feed sites', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'popcorn' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-popcorn-pet')).toBeNull();
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  for (const host of ['*://*.reddit.com/*', '*://*.x.com/*', '*://*.twitter.com/*']) {
    expect(manifest.web_accessible_resources.some(group =>
      group.resources.includes('assets/feeding/popcorn.png') && group.matches.includes(host)
    )).toBe(true);
  }
});

test('fishing hooks the post before reeling it in and clearing the tackle', () => {
  view.element.getBoundingClientRect = () => ({ left: 100, top: 180, right: 600, width: 500, height: 300 });
  renderer.render(record, hide, { evolution: 'baby', animation: 'fishing' });
  const scene = document.querySelector('.gomimon-fishing-pet');
  expect(scene.querySelector('.gomimon-fishing-line').getAttribute('d')).toContain('-166 78');
  jest.advanceTimersByTime(350);
  expect(scene.dataset.phase).toBe('cast');
  expect(view.element.classList.contains('gomimon-fishing-target')).toBe(false);
  jest.advanceTimersByTime(450);
  expect(scene.dataset.phase).toBe('tug');
  expect(view.element.classList.contains('gomimon-fishing-target')).toBe(true);
  jest.advanceTimersByTime(850);
  expect(scene.dataset.phase).toBe('reel');
  jest.advanceTimersByTime(1400);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-fishing-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-fishing-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('fishing clears line, hook, and timers on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'fishing' });
  jest.advanceTimersByTime(1800);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-fishing-tackle')).toBeNull();
  expect(view.element.classList.contains('gomimon-fishing-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('fishing skips motion when reduced motion is enabled', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'fishing' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-fishing-pet')).toBeNull();
});

test('heist steals the post, struggles on the cable, then escapes', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'heist' });
  const scene = document.querySelector('.gomimon-heist-pet');
  expect(scene.querySelector('.gomimon-heist-rig .gomimon-meal-character')).not.toBeNull();
  expect(scene.querySelector('.gomimon-heist-rig .gomimon-heist-cable')).not.toBeNull();
  jest.advanceTimersByTime(650);
  expect(scene.dataset.phase).toBe('hover');
  expect(view.element.classList.contains('gomimon-heist-target')).toBe(false);
  jest.advanceTimersByTime(400);
  expect(scene.dataset.phase).toBe('steal');
  expect(view.element.classList.contains('gomimon-heist-target')).toBe(true);
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('stuck');
  jest.advanceTimersByTime(900);
  expect(scene.dataset.phase).toBe('escape');
  jest.advanceTimersByTime(700);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-heist-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-heist-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('heist removes the cable and pending effects on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'heist' });
  jest.advanceTimersByTime(1800);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-heist-cable')).toBeNull();
  expect(view.element.classList.contains('gomimon-heist-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('heist skips the cable scene for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'heist' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-heist-pet')).toBeNull();
});

test('critic samples, awards five stars, then eats and restores the clipped post', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'critic' });
  const scene = document.querySelector('.gomimon-critic-pet');
  jest.advanceTimersByTime(350);
  expect(view.element.classList.contains('gomimon-critic-sampled')).toBe(true);
  expect(view.element.classList.contains('gomimon-critic-target')).toBe(false);
  jest.advanceTimersByTime(1100);
  expect(scene.dataset.phase).toBe('rate');
  expect(scene.querySelector('.gomimon-critic-rating').textContent).toBe('★★★★★');
  jest.advanceTimersByTime(700);
  expect(view.element.classList.contains('gomimon-critic-target')).toBe(true);
  jest.advanceTimersByTime(1300);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-critic-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-critic-sampled')).toBe(false);
  expect(view.element.classList.contains('gomimon-critic-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('critic clears the scorecard and cut corner on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'critic' });
  jest.advanceTimersByTime(1700);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-critic-rating')).toBeNull();
  expect(view.element.classList.contains('gomimon-critic-sampled')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('critic skips the scene for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'critic' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-critic-pet')).toBeNull();
});

test('boss battle blocks the unarmed charge, then the sword destroys the post', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'boss' });
  const scene = document.querySelector('.gomimon-boss-pet');
  expect(scene.querySelector('.gomimon-boss-name').textContent).toBe('FINAL POST');
  expect(view.element.classList.contains('gomimon-boss-opponent')).toBe(true);
  jest.advanceTimersByTime(700);
  expect(scene.dataset.phase).toBe('bonk');
  expect(getComputedStyle(scene.querySelector('.gomimon-boss-sword')).opacity).toBe('0');
  expect(view.element.classList.contains('gomimon-boss-target')).toBe(false);
  expect(view.element.hidden).toBe(false);
  jest.advanceTimersByTime(950);
  expect(scene.dataset.phase).toBe('idea');
  expect(view.element.classList.contains('gomimon-boss-target')).toBe(false);
  jest.advanceTimersByTime(450);
  expect(scene.dataset.phase).toBe('slash');
  expect(scene.querySelector('.gomimon-boss-damage').textContent).toBe('CRITICAL!');
  expect(view.element.classList.contains('gomimon-boss-target')).toBe(true);
  jest.advanceTimersByTime(550);
  expect(scene.querySelector('.gomimon-boss-name').textContent).toBe('DEFEATED');
  jest.advanceTimersByTime(800);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-boss-pet')).toBeNull();
  renderer.render(record, show);
  expect(view.element.classList.contains('gomimon-boss-target')).toBe(false);
  expect(view.element.classList.contains('gomimon-boss-opponent')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('boss battle removes effects and timers on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'boss' });
  jest.advanceTimersByTime(2250);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-boss-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-boss-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('boss battle skips the charge for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'boss' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-boss-pet')).toBeNull();
});

test('tiny helpers carry the post, sneak a bite, and deliver it', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'helpers' });
  const scene = document.querySelector('.gomimon-helpers-pet');
  expect(scene.querySelectorAll('.gomimon-helper')).toHaveLength(3);
  jest.advanceTimersByTime(950);
  expect(scene.dataset.phase).toBe('carry');
  expect(view.element.classList.contains('gomimon-helpers-target')).toBe(true);
  jest.advanceTimersByTime(800);
  expect(scene.dataset.phase).toBe('sneak');
  jest.advanceTimersByTime(500);
  expect(scene.dataset.phase).toBe('deliver');
  jest.advanceTimersByTime(1200);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-helpers-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-helpers-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('tiny helpers clean up on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'helpers' });
  jest.advanceTimersByTime(1750);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-helpers-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-helpers-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('tiny helpers skip the scene for reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'helpers' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-helpers-pet')).toBeNull();
});

function mockMealViewport() {
  const observers = [];
  window.IntersectionObserver = jest.fn(function (callback, options) {
    const observer = { callback, options, observe: jest.fn(), disconnect: jest.fn() };
    observers.push(observer);
    return observer;
  });
  return observers;
}

test.each(['above', 'below', 'beside'])('matched posts %s the viewport wait for entry before animating', position => {
  const observers = mockMealViewport();
  let rect = { left: 100, top: position === 'above' ? -400 : window.innerHeight + 100, width: 500, height: 300 };
  if (position === 'beside') rect = { ...rect, top: 100, left: window.innerWidth + 10 };
  view.element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  const decision = { ...hide, reason: 'category' };
  renderer.render(record, decision);
  expect(view.element.hidden).toBe(false);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  expect(observers[0].options.rootMargin).toBe('0px');
  expect(observers[0].observe).toHaveBeenCalledWith(view.element);
  jest.advanceTimersByTime(5000);
  observers[0].callback();
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  rect = { left: 100, top: window.innerHeight - 10, width: 500, height: 300 };
  observers[0].callback();
  expect(observers[0].disconnect).toHaveBeenCalled();
  jest.advanceTimersByTime(0);
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(2400);
  expect(view.element.hidden).toBe(true);
  renderer.render(record, decision);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test.each(['off', 'reduced motion'])('%s hides offscreen matches immediately', preference => {
  const observers = mockMealViewport();
  view.element.getBoundingClientRect = () => ({ left: 100, top: window.innerHeight + 100, width: 500, height: 300 });
  if (preference === 'off') settings.showEatingAnimations = false;
  else window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, { ...hide, reason: 'ad' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  expect(observers).toHaveLength(0);
});

test.each(['restore', 'detach', 'disable animations'])('%s cancels a meal waiting for the viewport', action => {
  const observers = mockMealViewport();
  let top = window.innerHeight + 100;
  view.element.getBoundingClientRect = () => ({ left: 100, top, width: 500, height: 300 });
  const decision = { ...hide, reason: 'ad' };
  renderer.render(record, decision);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else { settings.showEatingAnimations = false; renderer.render(record, decision); }
  expect(observers[0].disconnect).toHaveBeenCalled();
  top = 100;
  observers[0].callback();
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  expect(view.element.hidden).toBe(action === 'disable animations');
});

test('a manual meal keeps its chosen pet while waiting, including without IntersectionObserver', () => {
  delete window.IntersectionObserver;
  let top = window.innerHeight + 100;
  view.element.getBoundingClientRect = () => ({ left: 100, top, width: 500, height: 300 });
  renderer.render(record, hide, { evolution: 'bubble-gomi' });
  renderer.render(record, hide);
  expect(view.element.hidden).toBe(false);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  top = 100;
  document.dispatchEvent(new Event('scroll'));
  expect(document.querySelector('.gomimon-pet-overlay img').src).toContain('bubble-gomi_eat.gif');
  jest.advanceTimersByTime(2400);
  expect(view.element.hidden).toBe(true);
});

test('a background tab defers a visible meal until the tab becomes active', () => {
  mockMealViewport();
  const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    renderer.render(record, { ...hide, reason: 'ad' });
    expect(view.element.hidden).toBe(false);
    expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(0);
    expect(document.querySelector('.gomimon-pet-overlay')).not.toBeNull();
    jest.advanceTimersByTime(2400);
    expect(view.element.hidden).toBe(true);
  } finally { hidden.mockRestore(); }
});


test('paper airplane folds the post before flying into the mouth', () => {
  renderer.render(record, hide, { evolution: 'baby', animation: 'airplane' });
  const scene = document.querySelector('.gomimon-airplane-pet');
  expect(scene.querySelector('.gomimon-airplane')).not.toBeNull();
  jest.advanceTimersByTime(350);
  expect(view.element.classList.contains('gomimon-airplane-target')).toBe(true);
  jest.advanceTimersByTime(600);
  expect(scene.dataset.phase).toBe('launch');
  jest.advanceTimersByTime(1350);
  expect(scene.dataset.phase).toBe('catch');
  jest.advanceTimersByTime(1150);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-airplane-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-airplane-target')).toBe(false);
});

test.each(['restore', 'detach', 'scroll', 'resize'])('paper airplane cleans up on %s', action => {
  renderer.render(record, hide, { evolution: 'nimbus-gomi', animation: 'airplane' });
  jest.advanceTimersByTime(1200);
  if (action === 'restore') renderer.render(record, show);
  else if (action === 'detach') renderer.detachView(view);
  else (action === 'scroll' ? document : window).dispatchEvent(new Event(action));
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-airplane-pet')).toBeNull();
  expect(view.element.classList.contains('gomimon-airplane-target')).toBe(false);
  expect(view.element.hidden).toBe(['scroll', 'resize'].includes(action));
});

test('paper airplane respects reduced motion', () => {
  window.matchMedia.mockReturnValue({ matches: true });
  renderer.render(record, hide, { evolution: 'baby', animation: 'airplane' });
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-airplane-pet')).toBeNull();
});

function queuePost(key, top) {
  const element = document.createElement('shreddit-post');
  element.innerHTML = `<h3>${key}</h3>`;
  document.body.appendChild(element);
  const other = { element };
  extraViews.push(other);
  let currentTop = top;
  element.getBoundingClientRect = () => ({ left: 100, top: currentTop, width: 500, height: 100, right: 600, bottom: currentTop + 100 });
  const item = { ...record, key, views: new Map([[key, other]]) };
  return { view: other, record: item, move: top => { currentTop = top; } };
}
const autoHide = { action: 'hide', reason: 'category', labels: [] };
const mealPreview = { evolution: 'baby', animation: 'vacuum' };

test('simultaneous matches play topmost first, fade out, then pause 250ms before the next meal', () => {
  const bottom = queuePost('bottom', 400);
  renderer.render(bottom.record, autoHide, mealPreview);
  renderer.render(record, autoHide, mealPreview);
  jest.advanceTimersByTime(0);
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  expect(view.cancelFeed).toEqual(expect.any(Function));
  expect(bottom.view.cancelFeed).toBeUndefined();
  // Repeated detector updates must not add duplicate queue entries.
  renderer.render(bottom.record, autoHide, mealPreview);
  jest.advanceTimersByTime(2050);
  expect(document.querySelector('.gomimon-pet-overlay').dataset.phase).toBe('leave');
  jest.advanceTimersByTime(350);
  expect(view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  jest.advanceTimersByTime(249);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
  jest.advanceTimersByTime(1);
  expect(bottom.view.cancelFeed).toEqual(expect.any(Function));
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(2400);
  expect(bottom.view.element.hidden).toBe(true);
  jest.runAllTimers();
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test('the queue uses current screen order and quietly hides posts that have left view', () => {
  renderer.render(record, hide, mealPreview);
  const skipped = queuePost('scrolled-past', 300);
  const lower = queuePost('lower', 400);
  const upper = queuePost('upper', 500);
  for (const item of [skipped, lower, upper]) renderer.render(item.record, autoHide, mealPreview);
  skipped.move(-200);
  upper.move(200);
  jest.advanceTimersByTime(2650);
  expect(skipped.view.element.hidden).toBe(true);
  expect(upper.view.cancelFeed).toEqual(expect.any(Function));
  expect(lower.view.cancelFeed).toBeUndefined();
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(2650);
  expect(upper.view.element.hidden).toBe(true);
  expect(lower.view.cancelFeed).toEqual(expect.any(Function));
});

test.each(['restore', 'detach'])('%s removes a queued post without blocking the next meal', action => {
  renderer.render(record, hide, mealPreview);
  const canceled = queuePost('canceled', 300);
  const next = queuePost('next', 400);
  renderer.render(canceled.record, autoHide, mealPreview);
  renderer.render(next.record, autoHide, mealPreview);
  if (action === 'restore') renderer.render(canceled.record, show);
  else renderer.detachView(canceled.view);
  jest.advanceTimersByTime(2650);
  expect(canceled.view.element.hidden).toBe(false);
  expect(canceled.view.cancelFeed).toBeUndefined();
  expect(next.view.cancelFeed).toEqual(expect.any(Function));
});

test('disabling animations hides active and queued meals and clears playback', () => {
  renderer.render(record, hide, mealPreview);
  const next = queuePost('next', 400);
  renderer.render(next.record, autoHide, mealPreview);
  settings.showEatingAnimations = false;
  renderer.render(record, hide);
  renderer.render(next.record, autoHide);
  jest.runAllTimers();
  expect(view.element.hidden).toBe(true);
  expect(next.view.element.hidden).toBe(true);
  expect(document.querySelector('.gomimon-pet-overlay')).toBeNull();
});

test('a manually fed post queues behind the current meal', () => {
  renderer.render(record, hide, mealPreview);
  const next = queuePost('manual-next', 400);
  renderer.render(next.record, hide, mealPreview);
  expect(document.querySelectorAll('.gomimon-pet-overlay')).toHaveLength(1);
  jest.advanceTimersByTime(2650);
  expect(view.element.hidden).toBe(true);
  expect(next.view.cancelFeed).toEqual(expect.any(Function));
});

test('an offscreen match does not block a visible meal', () => {
  mockMealViewport();
  const offscreen = queuePost('offscreen', window.innerHeight + 100);
  renderer.render(offscreen.record, autoHide, mealPreview);
  renderer.render(record, autoHide, mealPreview);
  jest.advanceTimersByTime(0);
  expect(view.cancelFeed).toEqual(expect.any(Function));
  expect(offscreen.view.pendingMeal).toEqual(mealPreview);
  expect(offscreen.view.element.hidden).toBe(false);
});
