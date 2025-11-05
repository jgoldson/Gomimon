// GomiMon Content Script
// Handles the "purge" animation when feeding the pet

(function() {
  'use strict';

  console.log('GomiMon content script loaded');

  // Find the element that was right-clicked
  // This is a simplified version - we'll need to get the actual clicked element
  // For now, we'll add a listener for a custom event from the background script

  // Function to find the parent post element
  function findParentPost(element) {
    if (!element) return null;

    let current = element;
    let maxDepth = 10;
    let depth = 0;

    while (current && depth < maxDepth) {
      // Twitter/X
      if (current.tagName === 'ARTICLE') {
        return current;
      }

      // Reddit
      if (current.hasAttribute('data-testid') &&
          current.getAttribute('data-testid').includes('post')) {
        return current;
      }

      // Generic post containers
      if (current.classList.contains('post') ||
          current.classList.contains('feed-item') ||
          current.classList.contains('story') ||
          current.hasAttribute('role') && current.getAttribute('role') === 'article') {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    // If we can't find a specific post, return the original element
    return element;
  }

  // Function to purge an element
  function purgeElement(element) {
    if (!element) return;

    const targetElement = findParentPost(element);
    if (!targetElement) return;

    console.log('Purging element:', targetElement);

    // Add the purge class to trigger animation
    targetElement.classList.add('gomi-purged');

    // Remove the element after animation completes
    setTimeout(() => {
      targetElement.remove();
      console.log('Element purged!');
    }, 500);
  }

  // Store the last clicked element
  let lastClickedElement = null;

  document.addEventListener('contextmenu', (event) => {
    lastClickedElement = event.target;
    console.log('Context menu opened on:', lastClickedElement);
  }, true);

  // Listen for a message from the background script to trigger purge
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'purge') {
      purgeElement(lastClickedElement);
      sendResponse({ success: true });
    }
  });

  // If this script is being injected after a context menu click,
  // purge the last clicked element immediately
  if (lastClickedElement) {
    purgeElement(lastClickedElement);
  } else {
    // Try to find and purge the most recently added element
    // (This is a fallback for when the script is injected)
    const recentElement = document.querySelector('[data-gomi-target]');
    if (recentElement) {
      purgeElement(recentElement);
      recentElement.removeAttribute('data-gomi-target');
    }
  }
})();
