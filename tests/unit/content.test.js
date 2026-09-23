import { readFileSync } from 'node:fs';

function loadExtensionScript(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  new Function(source)();
}

function settle() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

test('does not apply an in-flight score after Reddit content changes revision', async () => {
  document.body.innerHTML = `
    <shreddit-post thingid="t3_rerender">
      <h3 slot="title">A post title that is long enough to inspect</h3>
      <div slot="text-body">This is a deliberately long Reddit post body with enough words to pass the detector minimum while the response is pending.</div>
    </shreddit-post>
  `;

  loadExtensionScript('../../detector/revision.js');
  loadExtensionScript('../../reddit-detector.js');
  loadExtensionScript('../../detector/store.js');
  loadExtensionScript('../../detector/policy.js');
  loadExtensionScript('../../detector/scheduler.js');
  loadExtensionScript('../../detector/renderer.js');

  const analyzeCallbacks = [];
  chrome.runtime.sendMessage.mockImplementation((message, callback) => {
    if (message.type === 'GET_DETECTOR_SETTINGS') {
      callback({
        success: true,
        settings: {
          mode: 'manual',
          sensitivity: 'strict',
          categories: [],
          categoryStrength: 'conservative'
        }
      });
      return;
    }
    if (message.type === 'ANALYZE_CONTENT') {
      analyzeCallbacks.push(callback);
    }
  });

  loadExtensionScript('../../content.js');
  await settle();

  const button = document.querySelector('[data-gomimon-action="analyze"]');
  expect(button).not.toBeNull();
  button.click();
  await settle();
  expect(analyzeCallbacks).toHaveLength(1);

  const body = document.querySelector('[slot="text-body"]');
  body.textContent += ' Reddit finished hydrating this post after the initial descriptor was captured.';
  analyzeCallbacks[0]({
    result: {
      label: 'low',
      aiProbability: 0.17,
      categoryProbabilities: {},
      truncated: false
    },
    requestId: 'request-one',
    serverRequestId: 'request-one'
  });
  await settle();
  await settle();

  expect(analyzeCallbacks).toHaveLength(1);
  expect(document.querySelector('.gomimon-ai-label')?.textContent).not.toBe('Low AI likelihood');
  expect(document.querySelector('[data-gomimon-action="analyze"]')).not.toBeNull();
  expect(document.querySelector('.gomimon-ai-loading')).toBeNull();
});
