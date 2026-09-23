import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import './reddit-detector.js';

function withDom(html, callback) {
  const dom = new JSDOM(html);
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    return callback(dom.window.document);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
}

test('discovers native Reddit ad posts separately from ordinary posts about ads', () => {
  withDom(`
    <shreddit-ad-post id="t3_ad">
      <a href="/user/powerfulsites">u/powerfulsites</a><span>Ad</span>
      <h3 slot="title">What popular life hack is actually terrible advice?</h3>
      <div slot="text-body">Putting a wet phone in rice.</div>
    </shreddit-ad-post>
    <shreddit-post thingid="t3_organic">
      <h3 slot="title">Ads with 0 followers</h3>
    </shreddit-post>
    <shreddit-ad-post id="t3_image_ad"><img alt="An offer"></shreddit-ad-post>
  `, document => {
    const detector = globalThis.GomiMonRedditDetector;
    const items = detector.findItems(document);
    assert.equal(items.length, 3);
    assert.equal(detector.closestItem(items[0].querySelector('h3')), items[0]);
    assert.deepEqual(detector.findItems(items[0]), [items[0]]);
    const descriptors = items.map(detector.describe);
    assert.equal(descriptors[0].isRedditAd, true);
    assert.equal(descriptors[0].key, 'reddit-post-t3_ad');
    assert.match(descriptors[0].text, /Putting a wet phone/);
    assert.equal(descriptors[1].isRedditAd, false);
    assert.equal(descriptors[2].isRedditAd, true);
    assert.equal(descriptors[2].extractionStatus, 'unsupported');
  });
});

test('extracts Reddit post title and body without actions', () => {
  withDom(`
    <shreddit-post thingid="t3_post">
      <h3 slot="title">A thoughtful title</h3>
      <div slot="text-body">This is the body of a post with enough words to assess how it was written.</div>
      <button>Upvote 123</button>
    </shreddit-post>
  `, document => {
    const [post] = globalThis.GomiMonRedditDetector.findItems(document);
    const descriptor = globalThis.GomiMonRedditDetector.describe(post);
    assert.equal(descriptor.contentType, 'post');
    assert.match(descriptor.text, /A thoughtful title/);
    assert.match(descriptor.text, /body of a post/);
    assert.doesNotMatch(descriptor.text, /Upvote 123/);
    assert.equal(descriptor.key, 'reddit-post-t3_post');
  });
});

test('prefers the rendered post body over a preceding Reddit notice', () => {
  withDom(`
    <shreddit-post thingid="t3_notice">
      <h2 id="post-title-t3_notice">I have never felt more rage in my life</h2>
      <div class="md">Because you've visited this community before</div>
      <div data-testid="post-text-container">
        You have called this system reliable, but it keeps inventing answers and changing important business rules without approval. The behavior has continued for weeks and the resulting decisions are not defensible.
      </div>
      <button>Upvote 66</button>
    </shreddit-post>
  `, document => {
    const [post] = globalThis.GomiMonRedditDetector.findItems(document);
    const descriptor = globalThis.GomiMonRedditDetector.describe(post);
    assert.match(descriptor.text, /keeps inventing answers/);
    assert.doesNotMatch(descriptor.text, /Because you've visited this community before/);
    assert.doesNotMatch(descriptor.text, /Upvote 66/);
    assert.ok(descriptor.wordCount >= 30);
  });
});

test('evaluates the title immediately and refreshes when the body hydrates', () => {
  withDom(`
    <shreddit-post thingid="t3_hydrating">
      <h3 slot="title">A title while the body hydrates</h3>
      <div slot="text-body"></div>
    </shreddit-post>
  `, document => {
    const post = document.querySelector('shreddit-post');
    const before = globalThis.GomiMonRedditDetector.describe(post);
    assert.equal(before.extractionStatus, 'ready');
    assert.equal(before.text, 'A title while the body hydrates');
    post.querySelector('[slot="text-body"]').textContent = 'The body has arrived with enough words to assess this Reddit item after hydration completes.';
    const after = globalThis.GomiMonRedditDetector.describe(post);
    assert.equal(after.extractionStatus, 'ready');
    assert.notEqual(after.revision, before.revision);
  });
});

test('scopes comment text to the comment without including replies', () => {
  withDom(`
    <shreddit-comment thingid="t1_parent">
      <div slot="comment">This is the parent comment with enough words to assess authorship independently.</div>
      <shreddit-comment thingid="t1_reply">
        <div slot="comment">This is a nested reply that must be assessed separately from its parent comment.</div>
      </shreddit-comment>
    </shreddit-comment>
  `, document => {
    const items = globalThis.GomiMonRedditDetector.findItems(document);
    assert.equal(items.length, 2);
    const parent = globalThis.GomiMonRedditDetector.describe(items[0]);
    assert.match(parent.text, /parent comment/);
    assert.doesNotMatch(parent.text, /nested reply/);
  });
});

test('bounds long assessments and refreshes recycled Reddit item identities', () => {
  withDom(`
    <shreddit-post id="recycled" thingid="t3_first">
      <h3 slot="title">${'word '.repeat(1700)}</h3>
    </shreddit-post>
  `, document => {
    const post = document.querySelector('shreddit-post');
    const first = globalThis.GomiMonRedditDetector.describe(post);
    assert.equal(first.truncated, true);
    assert.equal(first.text.length, 8000);
    assert.equal(first.key, 'reddit-post-t3_first');

    post.setAttribute('thingid', 't3_second');
    const second = globalThis.GomiMonRedditDetector.describe(post);
    assert.equal(second.key, 'reddit-post-t3_second');
  });
});

test('uses a canonical Reddit permalink before a local DOM fallback', () => {
  withDom(`
    <shreddit-post>
      <a href="https://www.reddit.com/r/testing/comments/abc123/example/" data-click-id="comments">comments</a>
      <h3 slot="title">A post identified by its permalink</h3>
    </shreddit-post>
  `, document => {
    const post = document.querySelector('shreddit-post');
    assert.equal(globalThis.GomiMonRedditDetector.describe(post).key, 'reddit-post-/r/testing/comments/abc123/example');
  });
});

test('extracts category context and recognizes only explicit promoted markers', () => {
  withDom(`
    <main>
      <shreddit-post thingid="t3_ad" data-ad-preview="default">
        <a href="/r/news" data-click-id="subreddit">r/news</a>
        <h3 slot="title">A sponsored offer</h3>
        <div slot="text-body">This post contains a normal body and an ad marker on the post container.</div>
        <span data-testid="post-flair">News</span>
      </shreddit-post>
      <shreddit-post thingid="t3_normal">
        <h3 slot="title">Why ads are annoying</h3>
        <div slot="text-body">This ordinary post mentions ads in its text but has no promoted marker.</div>
      </shreddit-post>
      <shreddit-post thingid="t3_false" data-promoted="false">
        <h3 slot="title">An ordinary update</h3>
      </shreddit-post>
    </main>
  `, document => {
    const descriptors = globalThis.GomiMonRedditDetector.findItems(document).map(
      globalThis.GomiMonRedditDetector.describe
    );
    assert.equal(descriptors[0].isRedditAd, true);
    assert.equal(descriptors[0].subreddit, 'r/news');
    assert.equal(descriptors[0].flair, 'News');
    assert.equal(descriptors[1].isRedditAd, false);
    assert.equal(descriptors[2].isRedditAd, false);
  });
});

for (const layout of ['attribute', 'click-target']) {
  test(`extracts a subreddit link title from ${layout}`, () => {
    const title = "Mamdani again calls for Israel's Netanyahu to be arrested when he comes to NY this week: 'A war criminal'";
    withDom(`<shreddit-post thingid="t3_politics" post-type="link">
      ${layout === 'click-target' ? `<a data-post-click-location="title">${title}</a>` : ''}
      <div slot="text-body"></div><button>Share</button>
    </shreddit-post>`, document => {
      const post = document.querySelector('shreddit-post');
      if (layout === 'attribute') post.setAttribute('post-title', title);
      const result = globalThis.GomiMonRedditDetector.describe(post);
      assert.equal(result.title, title);
      assert.equal(result.text, title);
      assert.equal(result.extractionStatus, 'ready');
      assert.ok(result.wordCount < 30);
      assert.equal(result.isDiscussionPage, false);
    });
  });
}
