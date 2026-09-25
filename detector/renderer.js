// Shared DOM renderer for platform detector views. It never owns scheduling or policy.
(function attachRenderer(global) {
  'use strict';

  const modules = global.GomiMonDetectorModules;


  function createRenderer({ detector, onAction, getSettings, getEvolution = () => 'baby' }) {
    // Resolve the extension root while the context is valid. Rerenders after a
    // reload must not throw halfway through building controls.
    const assetRoot = chrome.runtime.getURL('');
    const assetUrl = path => `${assetRoot}${path}`;
    const feedAnimations = ['vacuum', 'dining', 'magic', 'ambush', 'toaster', 'blackhole', 'popcorn', 'fishing', 'heist', 'critic', 'boss', 'helpers', 'airplane'];
    let lastFeedAnimation = 'airplane';
    const mealQueue = new Map();
    let activeMeal = null;
    let mealTimer = null;
    let nextMealAt = 0;

    function removeQueuedMeal(view) {
      mealQueue.delete(view);
      if (!mealQueue.size && mealTimer !== null) {
        clearTimeout(mealTimer);
        mealTimer = null;
      }
    }

    function scheduleMeal() {
      if (activeMeal || mealTimer !== null || !mealQueue.size) return;
      mealTimer = setTimeout(playNextMeal, Math.max(0, nextMealAt - Date.now()));
    }

    function playNextMeal() {
      mealTimer = null;
      if (activeMeal) return;
      // Sort again at playback time: scrolling and collapsed posts can move
      // the queue since these matches were first detected.
      const candidates = [...mealQueue.entries()].sort(([a], [b]) =>
        a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top);
      for (const [view, { record, decision, meal }] of candidates) {
        removeQueuedMeal(view);
        if (!view.target?.isConnected || view.target.hidden) continue;
        if (document.hidden) {
          waitForMealViewport(view, record, decision, meal);
          continue;
        }
        // These posts were visible when queued. If the reader has moved on,
        // finish quietly rather than making them wait for another entrance.
        if (!isInViewport(view.target)) {
          applyVisibility(view, record, decision, meal, true);
          continue;
        }
        applyVisibility(view, record, decision, meal, false, true);
        if (activeMeal) break;
      }
      scheduleMeal();
    }

    function queueMeal(view, record, decision, meal) {
      mealQueue.set(view, { record, decision, meal });
      // Direct feeding responds immediately when idle; automatic matches are
      // batched for one event-loop turn so the topmost post wins.
      if (decision.reason === 'manual_feed' && !activeMeal && mealQueue.size === 1 && Date.now() >= nextMealAt) {
        if (mealTimer !== null) clearTimeout(mealTimer);
        playNextMeal();
      } else scheduleMeal();
    }


    function addText(parent, tag, text, className) {
      const child = document.createElement(tag);
      child.textContent = text;
      if (className) child.className = className;
      parent.appendChild(child);
      return child;
    }

    function clearPanel(panel) {
      while (panel.firstChild) panel.removeChild(panel.firstChild);
    }

    function addFeedIcon(button) {
      const icon = document.createElement('img');
      icon.className = 'gomimon-feed-icon';
      icon.src = assetUrl('assets/feed-bowl.png');
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      const frame = document.createElement('span');
      frame.className = 'gomimon-feed-icon-frame';
      frame.setAttribute('aria-hidden', 'true');
      frame.appendChild(icon);
      button.prepend(frame);
    }

    function targetFor(view) {
      return view.element;
    }

    function restoreTarget(view) {
      removeQueuedMeal(view);
      view.cancelPendingFeed?.();
      view.cancelFeed?.();
      const target = view.target;
      if (!target) return;
      if (view.originalTargetState) {
        target.classList.remove('gomimon-hidden-target');
        target.hidden = view.originalTargetState.hidden;
        if (view.originalTargetState.ariaHidden === null) target.removeAttribute('aria-hidden');
        else target.setAttribute('aria-hidden', view.originalTargetState.ariaHidden);
        if ('inert' in target) target.inert = view.originalTargetState.inert;
      }
      if (view.placeholder?.isConnected) view.placeholder.remove();
      view.target = null;
      view.placeholder = null;
      view.originalTargetState = null;
    }

    function commentActionContainer(view) {
      const selectors = [
        '[slot="actionRow"]',
        '[slot="action-row"]',
        '[data-testid="comment-actions"]',
        '[data-testid="comment-action-row"]',
        '[data-click-id="comment_actions"]'
      ];
      for (const selector of selectors) {
        const candidate = Array.from(view.element.querySelectorAll(selector))
          .find(node => !detector.closestItem || detector.closestItem(node) === view.element);
        if (candidate) return candidate;
      }
      return null;
    }

    let nextPopoverId = 0;

    function ensureAssessmentMarker(view, contentType) {
      const document = view.element.ownerDocument;
      const markerKey = `${contentType}Marker`;
      if (view[markerKey]?.isConnected) return view[markerKey];
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = `gomimon-${contentType}-marker`;
      marker.setAttribute('aria-expanded', 'false');
      const popover = document.createElement('div');
      popover.className = 'gomimon-assessment-popover';
      popover.id = `gomimon-assessment-details-${++nextPopoverId}`;
      popover.hidden = true;
      popover.setAttribute('role', 'region');
      popover.setAttribute('aria-label', `${contentType === 'post' ? 'Post' : 'Comment'} assessment`);
      marker.setAttribute('aria-controls', popover.id);
      let pinned = false;
      let closeTimer;
      const position = () => {
        const rect = marker.getBoundingClientRect();
        const width = popover.getBoundingClientRect().width;
        const height = popover.getBoundingClientRect().height;
        popover.style.left = `${Math.max(8, Math.min(rect.left, global.innerWidth - width - 8))}px`;
        popover.style.top = `${Math.max(8, Math.min(rect.bottom + 8, global.innerHeight - height - 8))}px`;
      };
      const close = () => {
        clearTimeout(closeTimer);
        pinned = false;
        popover.hidden = true;
        marker.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', outside);
        document.removeEventListener('keydown', escape);
        global.removeEventListener('resize', position);
        document.removeEventListener('scroll', position, true);
      };
      const outside = event => {
        if (!marker.contains(event.target) && !popover.contains(event.target)) close();
      };
      const escape = event => {
        if (event.key === 'Escape') {
          if (popover.contains(document.activeElement)) marker.focus();
          close();
        }
      };
      const open = () => {
        clearTimeout(closeTimer);
        if (marker.hidden) return;
        popover.hidden = false;
        marker.setAttribute('aria-expanded', 'true');
        position();
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        global.addEventListener('resize', position);
        document.addEventListener('scroll', position, true);
      };
      const leave = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          if (!pinned && !popover.contains(document.activeElement) && document.activeElement !== marker) close();
        }, 180);
      };
      for (const node of [marker, popover]) {
        node.addEventListener('mouseenter', open);
        node.addEventListener('mouseleave', leave);
        node.addEventListener('focusin', open);
        node.addEventListener('focusout', leave);
      }
      marker.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (pinned) close();
        else { pinned = true; open(); }
      });
      popover.addEventListener('click', event => event.stopPropagation());
      popover.addEventListener('toggle', () => {
        if (!popover.hidden) position();
      }, true);
      view.element.appendChild(marker);
      document.body.appendChild(popover);
      view[markerKey] = marker;
      view.assessmentPopover = popover;
      view.closeAssessmentPopover = close;
      return marker;
    }

    function postRoots(element) {
      const roots = [element];
      function visit(node) {
        if (node !== element && node.matches?.('shreddit-comment, shreddit-post, .gomimon-ai-panel')) return;
        if (node.shadowRoot) {
          roots.push(node.shadowRoot);
          Array.from(node.shadowRoot.children).forEach(visit);
        }
        Array.from(node.children || []).forEach(visit);
      }
      visit(element);
      return roots;
    }

    function placePostPanel(view, panel) {
      if (detector.postActionContainer) {
        panel.classList.add('gomimon-x-controls');
        const actions = detector.postActionContainer(view.element);
        if (actions && panel.nextElementSibling !== actions) actions.before(panel);
        return;
      }
      const roots = postRoots(view.element);
      const ownedByPost = node => {
        const owner = detector.closestItem?.(node);
        return !owner || owner === view.element;
      };
      let share;
      let row;
      for (const selector of ['shreddit-post-share-button', '[slot="share-button"]', 'button[aria-label="Share"]']) {
        share = roots.flatMap(root => Array.from(root.querySelectorAll(selector)))
          .find(node => !node.closest('.gomimon-ai-panel') && ownedByPost(node));
        if (share) break;
      }
      // A slotted Share control occupies a slot in the shadow action row.
      // Insert after that slot, not among unrelated light-DOM content.
      const anchor = share?.assignedSlot || share;
      if (anchor) {
        if (anchor.nextElementSibling !== panel) anchor.after(panel);
      } else {
        for (const selector of ['[slot="action-row"]', '[slot="actionRow"]', '[data-testid="post-actions"]', '[data-testid="action-row"]', '[data-click-id="post_actions"]', '[aria-label="Actions available for this post"]']) {
          row = roots.flatMap(root => Array.from(root.querySelectorAll(selector))).find(ownedByPost);
          if (row) break;
        }
        if (row) {
          if (panel.parentNode !== row) row.appendChild(panel);
        } else {
          // Unslotted children of a shadow host are invisible. Keep the fallback
          // inside its rendered root until the action row becomes available.
          const fallback = view.element.shadowRoot || view.element;
          if (panel.parentNode !== fallback || panel !== fallback.lastElementChild) fallback.appendChild(panel);
        }
      }
      panel.removeAttribute('slot');
      // Observe shadow action rows too: the document observer cannot see them
      // hydrate or replace the Share control. Do not react to our own updates.
      view.postObserver?.disconnect();
      if (!view.postObserver) view.postObserver = new MutationObserver(mutations => {
        if (mutations.some(mutation => !panel.contains(mutation.target))) placePostPanel(view, panel);
      });
      for (const root of roots) {
        if (root !== view.element) view.postObserver.observe(root, { childList: true, subtree: true });
      }
    }

    // Content-script CSS does not cross a shadow boundary. Keep these rules
    // inside the panel as well so the button looks identical in either layout.
    const postControlStyles = `
      .gomimon-ai-panel.gomimon-post-controls {
        position: relative; display: inline-flex; align-items: center; flex: 0 0 auto;
        gap: 8px; margin: 0 0 0 8px; padding: 0; border: 0; background: transparent;
        vertical-align: middle; color: var(--color-neutral-content, #263b46);
        font: 600 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .gomimon-post-controls[hidden] { display: none !important; }
      .gomimon-post-controls .gomimon-post-action {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        min-height: 32px; padding: 0 12px; border: 0; border-radius: 999px;
        background: var(--color-secondary-background, #e5ebee); color: inherit;
        font: inherit; cursor: pointer; white-space: nowrap;
      }
      .gomimon-post-controls .gomimon-post-action:hover {
        background: var(--color-secondary-background-hover, #d6e0e5);
      }
      .gomimon-post-controls .gomimon-post-action:focus-visible { outline: 2px solid #1766cc; outline-offset: 2px; }
      .gomimon-post-controls .gomimon-feed-icon-frame {
        position: relative; display: inline-block; flex: 0 0 24px;
        width: 24px; height: 24px; overflow: hidden;
      }
      .gomimon-post-controls .gomimon-feed-icon {
        position: absolute; width: 48px; height: 48px; max-width: none;
        left: -12px; top: -12px; margin: 0;
      }
    `;

    function ensurePanel(view, record) {
      if (!view.element?.isConnected) return null;
      let panel = view.panel?.isConnected ? view.panel : null;
      if (!panel) panel = Array.from(view.element.querySelectorAll?.('.gomimon-ai-panel') || [])
        .find(candidate => candidate.dataset.gomimonPanelFor === record.key);
      if (!panel) {
        panel = document.createElement('div');
        panel.className = record.contentType === 'comment'
          ? 'gomimon-ai-panel gomimon-comment-controls'
          : 'gomimon-ai-panel gomimon-post-controls';
        panel.dataset.gomimonPanelFor = record.key;
        view.element.insertBefore(panel, view.element.firstChild);
      }
      if (!panel.dataset.gomimonBound) {
        panel.dataset.gomimonBound = 'true';
        panel.addEventListener('click', event => {
          const action = event.target.closest?.('[data-gomimon-action]')?.dataset.gomimonAction;
          if (action) {
            event.preventDefault();
            event.stopPropagation();
            onAction({ action, itemKey: panel.dataset.gomimonPanelFor });
          }
        });
      }
      panel.dataset.gomimonPanelFor = record.key;
      view.panel = panel;
      if (record.contentType === 'comment') {
        ensureAssessmentMarker(view, 'comment');
        const actionRow = commentActionContainer(view);
        if (view.commentActionRow !== actionRow) view.commentActionRow?.classList.remove('gomimon-comment-action-row');
        view.commentActionRow = actionRow;
        if (actionRow) {
          if (!actionRow.classList.contains('gomimon-comment-action-row')) actionRow.classList.add('gomimon-comment-action-row');
          if (panel.parentElement !== actionRow) actionRow.appendChild(panel);
          panel.classList.remove('gomimon-comment-controls-fallback');
        } else {
          const text = detector.describe(view.element)?.textContainer;
          if (text && text !== view.element) {
            if (text.nextElementSibling !== panel) text.after(panel);
          } else if (panel.parentElement !== view.element) view.element.appendChild(panel);
          panel.classList.add('gomimon-comment-controls-fallback');
        }
      } else {
        ensureAssessmentMarker(view, 'post');
        placePostPanel(view, panel);
      }
      return panel;
    }

    function animateFeed(view, record, decision, evolution, animation) {
      const dining = animation === 'dining';
      const magic = animation === 'magic';
      const ambush = animation === 'ambush';
      const toaster = animation === 'toaster';
      const blackhole = animation === 'blackhole';
      const popcorn = animation === 'popcorn';
      const fishing = animation === 'fishing';
      const heist = animation === 'heist';
      const critic = animation === 'critic';
      const boss = animation === 'boss';
      const helpers = animation === 'helpers';
      const airplane = animation === 'airplane';
      const target = view.target;
      const rect = target.getBoundingClientRect();
      const overlay = document.createElement('div');
      overlay.className = 'gomimon-pet-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const sprite = document.createElement('img');
      const sprites = {
        egg: 'sprites/animated/egg1_idle.gif',
        baby: 'sprites/animated/baby1_eat.gif',
        'bubble-gomi': 'sprites/animated/bubble-gomi_eat.gif',
        'nimbus-gomi': 'sprites/animated/nimbus-gomi_eat.gif',
        'typo-ling': 'sprites/typo-ling.svg',
        'muta-pixel': 'sprites/muta-pixel.svg',
        'classic-gomi': 'sprites/classic-gomi.svg',
        'null-sprite': 'sprites/starved.svg'
      };
      const eatingSprite = assetUrl(sprites[evolution] || sprites.baby);
      sprite.src = (dining || magic || ambush || toaster || blackhole || popcorn || fishing || heist || critic || boss || helpers || airplane) ? eatingSprite.replace('_eat.gif', '_idle.gif') : eatingSprite;
      if ((magic || ambush || toaster || blackhole || popcorn || fishing || heist || critic || boss || helpers || airplane) && ['bubble-gomi', 'nimbus-gomi'].includes(evolution)) {
        sprite.src = eatingSprite.replace('_eat.gif', '_static.gif');
      }
      sprite.alt = '';
      sprite.className = 'gomimon-meal-character';
      overlay.appendChild(sprite);
      overlay.classList.add(`gomimon-${animation}-pet`);
      overlay.dataset.evolution = evolution;
      // Keep the mouth inside the viewport, including narrow feeds and comments.
      const edge = (helpers || airplane) ? 195 : (dining || toaster || blackhole || popcorn || heist || boss) ? 125 : 90;
      const mouthX = Math.max(edge, Math.min(global.innerWidth - edge,
        dining ? rect.left + rect.width / 2 : (toaster || blackhole || popcorn) ? rect.left + rect.width / 2 + 60 : ambush ? rect.left + rect.width * .7 : rect.right - 24));
      const mouthY = Math.max(toaster ? 180 : (critic || boss) ? 165 : dining ? 110 : 90, Math.min(global.innerHeight - ((dining || toaster) ? 145 : 80),
        ambush ? Math.max(0, rect.top) + 18
          : Math.max(0, rect.top) + Math.min(rect.height, global.innerHeight) / 2));
      // Document coordinates let the browser scroll the scene with the post,
      // instead of leaving a fixed overlay behind or cancelling the meal.
      const pageX = mouthX + global.scrollX;
      const pageY = mouthY - 18 + global.scrollY;
      const scrollParents = [];
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent !== document.scrollingElement && parent !== document.documentElement && parent !== document.body) {
          scrollParents.push({ element: parent, x: parent.scrollLeft, y: parent.scrollTop });
        }
      }
      overlay.style.position = 'absolute';
      const followPostScroll = () => {
        let dx = 0, dy = 0;
        for (const parent of scrollParents) {
          dx += parent.element.scrollLeft - parent.x;
          dy += parent.element.scrollTop - parent.y;
        }
        overlay.style.left = `${pageX - dx}px`;
        overlay.style.top = `${pageY - dy}px`;
      };
      followPostScroll();
      overlay.dataset.phase = 'arrive';
      if (dining) {
        const table = document.createElement('img');
        table.className = 'gomimon-dining-table';
        table.src = assetUrl('assets/feeding/fine-dining-table.png');
        table.alt = '';
        overlay.appendChild(table);
        // Keep the real page node in place. Its miniature serving uses plain
        // text, so custom elements, media, and platform listeners aren't cloned.
        const dish = document.createElement('div');
        dish.className = 'gomimon-dining-dish';
        dish.textContent = (record.snapshot?.text || record.snapshot?.body || 'A delicious post').slice(0, 100);
        overlay.appendChild(dish);
        const fork = document.createElement('span');
        fork.className = 'gomimon-dining-fork';
        overlay.appendChild(fork);
        const crumb = document.createElement('span');
        crumb.className = 'gomimon-dining-crumb';
        overlay.appendChild(crumb);
      } else if (magic) {
        const cloth = document.createElement('div');
        cloth.className = 'gomimon-magic-cloth';
        // Only cover the visible part of the post. The real node stays in its
        // original layout, including any shadow roots and nested replies.
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const width = Math.max(0, Math.min(global.innerWidth, rect.right) - left);
        const height = Math.max(0, Math.min(global.innerHeight, rect.top + rect.height) - top);
        cloth.style.left = `${left - mouthX + 60}px`;
        cloth.style.top = `${top - mouthY + 78}px`;
        cloth.style.width = `${width}px`;
        cloth.style.height = `${height}px`;
        for (let index = 0; index < 5; index++) {
          const star = document.createElement('span');
          star.textContent = '✦';
          star.style.left = `${15 + index * 17}%`;
          star.style.top = `${20 + (index % 3) * 24}%`;
          cloth.appendChild(star);
        }
        overlay.prepend(cloth);
        for (const prop of ['hat', 'wand', 'belly', 'sparkles']) {
          const element = document.createElement('span');
          element.className = `gomimon-magic-${prop}`;
          if (prop === 'sparkles') element.textContent = '✦  ✧  ✦';
          overlay.appendChild(element);
        }
        // Move the hat with the head through entrances, glances, and bows.
        const character = document.createElement('div');
        character.className = 'gomimon-magic-character';
        character.append(sprite, overlay.querySelector('.gomimon-magic-hat'), overlay.querySelector('.gomimon-magic-belly'));
        overlay.appendChild(character);
      } else if (ambush) {
        const character = document.createElement('div');
        character.className = 'gomimon-ambush-character';
        character.appendChild(sprite);
        overlay.appendChild(character);
        const edge = document.createElement('span');
        edge.className = 'gomimon-ambush-grass';
        for (let index = 0; index < 13; index++) {
          const blade = document.createElement('i');
          blade.style.setProperty('--blade', index);
          edge.appendChild(blade);
        }
        const net = document.createElement('div');
        net.className = 'gomimon-ambush-net';
        net.style.left = `${rect.left - mouthX + 60}px`;
        net.style.top = `${rect.top - mouthY + 78}px`;
        net.style.width = `${rect.width}px`;
        net.style.height = `${rect.height}px`;
        overlay.appendChild(net);
        const trap = document.createElement('div');
        trap.className = 'gomimon-ambush-trap';
        overlay.appendChild(trap);
        overlay.appendChild(edge);
        const crumbs = document.createElement('div');
        crumbs.className = 'gomimon-ambush-crumbs';
        for (let index = 0; index < 6; index++) {
          const crumb = document.createElement('i');
          crumb.style.setProperty('--crumb-x', `${(index - 2.5) * 28}px`);
          crumb.style.setProperty('--crumb-y', `${-35 - (index % 3) * 22}px`);
          crumbs.appendChild(crumb);
        }
        overlay.appendChild(crumbs);
      } else if (toaster) {
        const appliance = document.createElement('img');
        appliance.className = 'gomimon-toaster-appliance';
        appliance.src = assetUrl('assets/feeding/toaster.png');
        appliance.alt = '';
        overlay.appendChild(appliance);
        const toast = document.createElement('div');
        toast.className = 'gomimon-toaster-toast';
        toast.textContent = (record.snapshot?.text || record.snapshot?.body || 'Freshly toasted post').slice(0, 90);
        overlay.appendChild(toast);
        const heat = document.createElement('span');
        heat.className = 'gomimon-toaster-heat';
        overlay.appendChild(heat);
        const pop = document.createElement('span');
        pop.className = 'gomimon-toaster-pop';
        pop.textContent = '✦';
        overlay.appendChild(pop);
      } else if (blackhole) {
        const portal = document.createElement('div');
        portal.className = 'gomimon-blackhole-portal';
        const ring = document.createElement('span');
        ring.className = 'gomimon-blackhole-ring';
        portal.appendChild(ring);
        overlay.appendChild(portal);
        const star = document.createElement('span');
        star.className = 'gomimon-blackhole-star';
        overlay.appendChild(star);
        const dust = document.createElement('div');
        dust.className = 'gomimon-blackhole-dust';
        for (let index = 0; index < 6; index++) {
          const mote = document.createElement('i');
          mote.style.setProperty('--orbit-angle', `${index * 60}deg`);
          mote.style.setProperty('--orbit-delay', `${index * -.12}s`);
          dust.appendChild(mote);
        }
        overlay.appendChild(dust);
      } else if (popcorn) {
        const bucket = document.createElement('img');
        bucket.className = 'gomimon-popcorn-bucket';
        bucket.src = assetUrl('assets/feeding/popcorn.png');
        bucket.alt = '';
        overlay.appendChild(bucket);
        const kernels = document.createElement('div');
        kernels.className = 'gomimon-popcorn-kernels';
        for (let index = 0; index < 9; index++) {
          const kernel = document.createElement('i');
          kernel.style.setProperty('--kernel-x', `${(index % 3 - 1) * 55}px`);
          kernel.style.setProperty('--kernel-y', `${-35 - Math.floor(index / 3) * 28}px`);
          kernel.style.setProperty('--kernel-delay', `${index * .025}s`);
          kernels.appendChild(kernel);
        }
        overlay.appendChild(kernels);
        const bite = document.createElement('i');
        bite.className = 'gomimon-popcorn-bite';
        overlay.appendChild(bite);
      } else if (fishing) {
        const ns = 'http://www.w3.org/2000/svg';
        const tackle = document.createElementNS(ns, 'svg');
        tackle.setAttribute('class', 'gomimon-fishing-tackle');
        tackle.setAttribute('viewBox', '0 0 120 120');
        const hookX = rect.left + rect.width / 2 - mouthX + 60;
        const hookY = Math.max(0, Math.min(global.innerHeight, rect.top + rect.height / 2)) - mouthY + 78;
        const path = (className, d) => {
          const element = document.createElementNS(ns, 'path');
          element.setAttribute('class', className);
          element.setAttribute('d', d);
          tackle.appendChild(element);
          return element;
        };
        path('gomimon-fishing-rod', 'M 35 85 Q 10 -65 -35 -15');
        const line = path('gomimon-fishing-line', `M -35 -15 Q ${hookX} -10 ${hookX} ${hookY}`);
        line.setAttribute('pathLength', '1');
        const hook = path('gomimon-fishing-hook', `M ${hookX} ${hookY - 5} v 12 a 7 7 0 0 1 -14 0 v -4 l 4 4`);
        hook.style.setProperty('--hook-x', `${60 - hookX}px`);
        hook.style.setProperty('--hook-y', `${78 - hookY}px`);
        path('gomimon-fishing-reel', 'M 31 73 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0 M 39 73 l 12 7');
        overlay.appendChild(tackle);
      } else if (heist) {
        const rig = document.createElement('div');
        rig.className = 'gomimon-heist-rig';
        const cable = document.createElement('span');
        cable.className = 'gomimon-heist-cable';
        rig.appendChild(cable);
        rig.appendChild(sprite);
        overlay.appendChild(rig);
        overlay.style.setProperty('--heist-drop', `${mouthY + 160}px`);
      } else if (critic) {
        const rating = document.createElement('div');
        rating.className = 'gomimon-critic-rating';
        rating.textContent = '★★★★★';
        overlay.appendChild(rating);
        const bite = document.createElement('span');
        bite.className = 'gomimon-critic-bite';
        bite.textContent = (record.snapshot?.text || 'A post').slice(0, 20);
        overlay.appendChild(bite);
        const thought = document.createElement('span');
        thought.className = 'gomimon-critic-thought';
        thought.textContent = '…';
        overlay.appendChild(thought);
      } else if (boss) {
        target.classList.add('gomimon-boss-opponent');
        const health = document.createElement('div');
        health.className = 'gomimon-boss-health';
        const healthWidth = Math.min(280, Math.max(140, rect.width - 24), global.innerWidth - 24);
        const healthLeft = Math.max(12, Math.min(global.innerWidth - healthWidth - 12, rect.left + 12));
        health.style.width = `${healthWidth}px`;
        health.style.left = `${healthLeft - mouthX + 60}px`;
        health.style.top = `${Math.max(12, rect.top + 12) - mouthY + 78}px`;
        addText(health, 'span', 'FINAL POST', 'gomimon-boss-name');
        addText(health, 'span', 'LV. 99', 'gomimon-boss-level');
        const track = document.createElement('div');
        track.className = 'gomimon-boss-health-track';
        track.appendChild(document.createElement('i'));
        health.appendChild(track);
        overlay.appendChild(health);
        const damage = document.createElement('span');
        damage.className = 'gomimon-boss-damage';
        damage.textContent = 'BLOCKED';
        overlay.appendChild(damage);
        const fighter = document.createElement('div');
        fighter.className = 'gomimon-boss-fighter';
        fighter.appendChild(sprite);
        const sword = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        sword.setAttribute('class', 'gomimon-boss-sword');
        sword.setAttribute('viewBox', '0 0 52 140');
        // A chunky game prop; the hilt is the pivot and stays with the pet.
        for (const [d, fill] of [
          ['M26 2 L40 18 V94 H12 V18 Z', '#344d59'],
          ['M26 9 L35 21 V89 H17 V21 Z', '#d5eee9'],
          ['M26 9 V89 H35 V21 Z', '#8dafb9'],
          ['M4 92 H48 V102 H31 V126 H21 V102 H4 Z', '#604934'],
          ['M7 94 H45 V99 H7 Z', '#eac46d'],
          ['M23 104 H29 V125 H23 Z', '#a56b50'],
          ['M19 126 H33 V135 H19 Z', '#604934'],
          ['M22 128 H30 V132 H22 Z', '#eac46d']
        ]) {
          const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          shape.setAttribute('d', d);
          shape.setAttribute('fill', fill);
          sword.appendChild(shape);
        }
        fighter.appendChild(sword);
        overlay.appendChild(fighter);
        const shards = document.createElement('div');
        shards.className = 'gomimon-boss-shards';
        shards.style.left = `${rect.left + rect.width / 2 - mouthX + 60}px`;
        shards.style.top = `${rect.top + rect.height / 2 - mouthY + 78}px`;
        for (let index = 0; index < 10; index++) {
          const shard = document.createElement('i');
          shard.style.setProperty('--shard-x', `${Math.cos(index * Math.PI / 5) * Math.min(rect.width / 2, 160)}px`);
          shard.style.setProperty('--shard-y', `${Math.sin(index * Math.PI / 5) * 95}px`);
          shards.appendChild(shard);
        }
        overlay.appendChild(shards);
        const impact = document.createElement('span');
        impact.className = 'gomimon-boss-impact';
        overlay.appendChild(impact);
        const stars = document.createElement('span');
        stars.className = 'gomimon-boss-stars';
        stars.textContent = '✦  ✧  ✦';
        overlay.appendChild(stars);
        const idea = document.createElement('span');
        idea.className = 'gomimon-boss-idea';
        idea.textContent = '!';
        overlay.appendChild(idea);
      } else if (helpers) {
        const crew = document.createElement('div');
        crew.className = 'gomimon-helpers-crew';
        for (let index = 0; index < 3; index++) {
          const helper = document.createElement('img');
          helper.className = 'gomimon-helper';
          helper.src = assetUrl('sprites/animated/baby1_idle.gif');
          helper.alt = '';
          helper.style.left = `${index * 30 - 16}px`;
          helper.style.setProperty('--step-delay', `${index * -.1}s`);
          crew.appendChild(helper);
        }
        const cargo = document.createElement('div');
        cargo.className = 'gomimon-helpers-cargo';
        cargo.textContent = (record.snapshot?.text || record.snapshot?.body || 'Special delivery').slice(0, 110);
        crew.appendChild(cargo);
        const crumb = document.createElement('span');
        crumb.className = 'gomimon-helpers-crumb';
        crew.appendChild(crumb);
        overlay.appendChild(crew);
      } else if (airplane) {
        const plane = document.createElement('div');
        plane.className = 'gomimon-airplane';
        const wing = document.createElement('span');
        wing.className = 'gomimon-airplane-wing';
        plane.appendChild(wing);
        overlay.appendChild(plane);
      } else {
        const wind = document.createElement('div');
        wind.className = 'gomimon-vacuum-wind';
        for (let index = 0; index < 7; index++) {
          const streak = document.createElement('i');
          streak.style.setProperty('--stream-y', `${(index - 3) * 19}px`);
          streak.style.setProperty('--stream-delay', `${index * -0.09}s`);
          wind.appendChild(streak);
        }
        overlay.appendChild(wind);
      }
      document.documentElement.appendChild(overlay);
      const timers = [];
      const properties = ['--gomi-mouth-x', '--gomi-mouth-y', '--gomi-plate-x', '--gomi-plate-y', '--gomi-plate-scale'];
      const originalProperties = properties.map(name => [name,
        target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]);
      target.style.setProperty('--gomi-mouth-x', `${mouthX - (blackhole ? 110 : popcorn ? 72 : helpers ? 150 : airplane ? 130 : 0) - rect.left}px`);
      target.style.setProperty('--gomi-mouth-y', `${mouthY - (popcorn ? 8 : 0) - rect.top}px`);
      if (dining || toaster) {
        target.style.setProperty('--gomi-plate-x', `${mouthX - (toaster ? 104 : 0) - rect.left - rect.width / 2}px`);
        target.style.setProperty('--gomi-plate-y', `${mouthY + (toaster ? -70 : 22) - rect.top - rect.height / 2}px`);
        target.style.setProperty('--gomi-plate-scale', String(Math.min(72 / Math.max(1, rect.width), 40 / Math.max(1, rect.height), 1)));
      }
      view.cancelFeed = () => {
        timers.forEach(clearTimeout);
        global.removeEventListener('resize', finish);
        document.removeEventListener('scroll', followPostScroll, true);
        overlay.remove();
        target.classList.remove('gomimon-vacuum-target', 'gomimon-dining-target', 'gomimon-magic-target', 'gomimon-ambush-target', 'gomimon-ambush-caught', 'gomimon-toaster-target', 'gomimon-blackhole-target', 'gomimon-popcorn-target', 'gomimon-fishing-target', 'gomimon-heist-target', 'gomimon-critic-sampled', 'gomimon-critic-target', 'gomimon-boss-target', 'gomimon-boss-opponent', 'gomimon-helpers-target', 'gomimon-airplane-target');
        for (const [name, value, priority] of originalProperties) {
          if (value) target.style.setProperty(name, value, priority);
          else target.style.removeProperty(name);
        }
        view.cancelFeed = null;
        if (activeMeal === view) {
          activeMeal = null;
          nextMealAt = Date.now() + 250;
          scheduleMeal();
        }
      };
      const finish = () => {
        view.cancelFeed?.();
        applyVisibility(view, record, decision, null, true);
      };
      // Keep nested feed scrollers anchored too; scrolling never ends a meal.
      global.addEventListener('resize', finish, { once: true });
      document.addEventListener('scroll', followPostScroll, { capture: true, passive: true });
      const later = (delay, callback) => timers.push(setTimeout(callback, delay));
      if (dining) {
        later(400, () => {
          overlay.dataset.phase = 'plate';
          target.classList.add('gomimon-dining-target');
        });
        later(1050, () => { overlay.dataset.phase = 'served'; });
        later(1450, () => { overlay.dataset.phase = 'taste'; sprite.src = eatingSprite; });
        later(1800, () => { overlay.dataset.phase = 'savor'; });
        later(2200, () => { overlay.dataset.phase = 'gobble'; });
        later(2550, () => { overlay.dataset.phase = 'gulp'; });
        later(2950, () => { overlay.dataset.phase = 'leave'; });
        later(3400, finish);
      } else if (magic) {
        later(400, () => { overlay.dataset.phase = 'cover'; });
        later(950, () => {
          overlay.dataset.phase = 'spell';
          target.classList.add('gomimon-magic-target');
        });
        later(1450, () => { overlay.dataset.phase = 'reveal'; });
        later(1850, () => { overlay.dataset.phase = 'caught'; });
        later(2600, () => { overlay.dataset.phase = 'bow'; });
        later(3050, () => { overlay.dataset.phase = 'leave'; });
        later(3500, finish);
      } else if (ambush) {
        later(300, () => { overlay.dataset.phase = 'set'; });
        later(1000, () => { overlay.dataset.phase = 'hide'; });
        later(1650, () => {
          overlay.dataset.phase = 'caught';
          target.classList.add('gomimon-ambush-caught');
        });
        later(2250, () => { overlay.dataset.phase = 'leap'; sprite.src = eatingSprite; });
        later(2550, () => {
          overlay.dataset.phase = 'snap';
          target.classList.remove('gomimon-ambush-caught');
          target.classList.add('gomimon-ambush-target');
        });
        later(3000, () => { overlay.dataset.phase = 'gulp'; });
        later(3400, () => { overlay.dataset.phase = 'leave'; });
        later(3750, finish);
      } else if (toaster) {
        later(400, () => {
          overlay.dataset.phase = 'load';
          target.classList.add('gomimon-toaster-target');
        });
        later(1050, () => { overlay.dataset.phase = 'loaded'; });
        later(1200, () => { overlay.dataset.phase = 'insert'; });
        later(1550, () => { overlay.dataset.phase = 'toast'; });
        later(2150, () => { overlay.dataset.phase = 'pop'; sprite.src = eatingSprite; });
        later(2750, () => { overlay.dataset.phase = 'catch'; });
        later(3150, () => { overlay.dataset.phase = 'leave'; });
        later(3500, finish);
      } else if (blackhole) {
        later(300, () => { overlay.dataset.phase = 'summon'; });
        later(650, () => {
          overlay.dataset.phase = 'swirl';
          target.classList.add('gomimon-blackhole-target');
        });
        later(1650, () => { overlay.dataset.phase = 'consider'; });
        later(1900, () => { overlay.dataset.phase = 'devour'; sprite.src = eatingSprite; });
        later(2400, () => { overlay.dataset.phase = 'hiccup'; });
        later(2950, () => { overlay.dataset.phase = 'leave'; });
        later(3300, finish);
      } else if (popcorn) {
        later(350, () => {
          overlay.dataset.phase = 'pop';
          target.classList.add('gomimon-popcorn-target');
        });
        later(1100, () => { overlay.dataset.phase = 'ready'; });
        later(1200, () => { overlay.dataset.phase = 'nibble'; sprite.src = eatingSprite; });
        later(2100, () => { overlay.dataset.phase = 'tip'; });
        later(2700, () => { overlay.dataset.phase = 'gulp'; });
        later(3100, () => { overlay.dataset.phase = 'leave'; });
        later(3450, finish);
      } else if (fishing) {
        later(350, () => { overlay.dataset.phase = 'cast'; });
        later(800, () => {
          overlay.dataset.phase = 'tug';
          target.classList.add('gomimon-fishing-target');
        });
        later(1650, () => { overlay.dataset.phase = 'reel'; sprite.src = eatingSprite; });
        later(2300, () => { overlay.dataset.phase = 'gulp'; });
        later(2700, () => { overlay.dataset.phase = 'leave'; });
        later(3050, finish);
      } else if (heist) {
        later(650, () => { overlay.dataset.phase = 'hover'; });
        later(1050, () => {
          overlay.dataset.phase = 'steal';
          sprite.src = eatingSprite;
          target.classList.add('gomimon-heist-target');
        });
        later(1650, () => { overlay.dataset.phase = 'stuck'; });
        later(2550, () => { overlay.dataset.phase = 'escape'; });
        later(3250, finish);
      } else if (critic) {
        later(350, () => {
          overlay.dataset.phase = 'sample';
          sprite.src = eatingSprite;
          target.classList.add('gomimon-critic-sampled');
        });
        later(850, () => { overlay.dataset.phase = 'consider'; sprite.src = eatingSprite.replace('_eat.gif', '_idle.gif'); });
        later(1450, () => { overlay.dataset.phase = 'rate'; });
        later(2150, () => {
          overlay.dataset.phase = 'devour';
          sprite.src = eatingSprite;
          target.classList.add('gomimon-critic-target');
        });
        later(2700, () => { overlay.dataset.phase = 'gulp'; });
        later(3100, () => { overlay.dataset.phase = 'leave'; });
        later(3450, finish);
      } else if (boss) {
        later(350, () => { overlay.dataset.phase = 'charge'; });
        later(700, () => { overlay.dataset.phase = 'bonk'; });
        later(1150, () => { overlay.dataset.phase = 'dazed'; });
        later(1650, () => { overlay.dataset.phase = 'idea'; });
        later(2100, () => {
          overlay.dataset.phase = 'slash';
          overlay.querySelector('.gomimon-boss-damage').textContent = 'CRITICAL!';
          target.classList.add('gomimon-boss-target');
        });
        later(2650, () => {
          overlay.dataset.phase = 'proud';
          overlay.querySelector('.gomimon-boss-name').textContent = 'DEFEATED';
        });
        later(3100, () => { overlay.dataset.phase = 'leave'; });
        later(3450, finish);
      } else if (helpers) {
        later(350, () => {
          overlay.dataset.phase = 'collect';
          target.classList.add('gomimon-helpers-target');
        });
        later(950, () => { overlay.dataset.phase = 'carry'; });
        later(1750, () => { overlay.dataset.phase = 'sneak'; });
        later(2250, () => { overlay.dataset.phase = 'deliver'; sprite.src = eatingSprite; });
        later(2700, () => { overlay.dataset.phase = 'celebrate'; });
        later(3100, () => { overlay.dataset.phase = 'leave'; });
        later(3450, finish);
      } else if (airplane) {
        later(350, () => {
          overlay.dataset.phase = 'fold';
          target.classList.add('gomimon-airplane-target');
        });
        later(950, () => { overlay.dataset.phase = 'launch'; });
        later(2300, () => { overlay.dataset.phase = 'catch'; sprite.src = eatingSprite; });
        later(2750, () => { overlay.dataset.phase = 'gulp'; });
        later(3100, () => { overlay.dataset.phase = 'leave'; });
        later(3450, finish);
      } else {
        later(400, () => { overlay.dataset.phase = 'inhale'; });
        later(650, () => {
          overlay.dataset.phase = 'suck';
          target.classList.add('gomimon-vacuum-target');
        });
        later(1650, () => { overlay.dataset.phase = 'gulp'; });
        later(2050, () => { overlay.dataset.phase = 'leave'; });
        later(2400, finish);
      }
    }

    function isInViewport(target) {
      if (document.hidden || !target.isConnected) return false;
      const rect = target.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        rect.top < global.innerHeight && rect.top + rect.height > 0 &&
        rect.left < global.innerWidth && rect.left + rect.width > 0;
    }

    function waitForMealViewport(view, record, decision, meal) {
      view.pendingMeal = meal;
      let viewportObserver;
      const resume = () => {
        if (view.cancelPendingFeed !== cancelPendingFeed || !view.pendingMeal || !isInViewport(view.target)) return;
        view.cancelPendingFeed?.();
        applyVisibility(view, record, decision, meal);
      };
      const cancelPendingFeed = view.cancelPendingFeed = () => {
        viewportObserver?.disconnect();
        document.removeEventListener('visibilitychange', resume);
        document.removeEventListener('scroll', resume, true);
        global.removeEventListener('resize', resume);
        view.pendingMeal = null;
        view.cancelPendingFeed = null;
      };
      // Detection scans ahead of the viewport. Meals need a separate observer
      // with no look-ahead margin so scrolling into view starts the animation.
      if ('IntersectionObserver' in global) {
        viewportObserver = new global.IntersectionObserver(resume, { rootMargin: '0px', threshold: [0, 0.01] });
        viewportObserver.observe(view.target);
      } else {
        document.addEventListener('scroll', resume, { capture: true, passive: true });
        global.addEventListener('resize', resume, { passive: true });
      }
      document.addEventListener('visibilitychange', resume);
    }

    function applyVisibility(view, record, decision, presentation, skipAnimation = false, startMeal = false) {
      const target = targetFor(view, record);
      if (!target || !target.isConnected) return;
      if (view.target !== target) {
        restoreTarget(view);
        view.target = target;
        view.originalTargetState = {
          hidden: target.hidden,
          ariaHidden: target.getAttribute('aria-hidden'),
          inert: Boolean(target.inert)
        };
      }
      if (decision.action !== 'hide') {
        restoreTarget(view);
        return;
      }
      view.closeAssessmentPopover?.();
      const animate = getSettings().showEatingAnimations !== false;
      if (!animate) view.cancelFeed?.();
      if (view.cancelFeed) return;
      const automatic = ['ai_likelihood', 'category', 'ad'].includes(decision.reason);
      const meal = presentation || mealQueue.get(view)?.meal || view.pendingMeal || (automatic ? { evolution: getEvolution() } : null);
      view.cancelPendingFeed?.();
      if (!skipAnimation && animate && meal && !target.hidden && !global.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        if (!startMeal) {
          if (mealQueue.has(view) || isInViewport(target)) queueMeal(view, record, decision, meal);
          else waitForMealViewport(view, record, decision, meal);
          return;
        }
        // Cycle through every scene without repeats; the preview may select
        // a specific choreography without changing production settings.
        const animation = feedAnimations.includes(meal.animation)
          ? meal.animation
          : feedAnimations[(feedAnimations.indexOf(lastFeedAnimation) + 1) % feedAnimations.length];
        lastFeedAnimation = animation;
        activeMeal = view;
        animateFeed(view, record, decision, meal.evolution, animation);
        return;
      }
      removeQueuedMeal(view);
      target.classList.add('gomimon-hidden-target');
      target.hidden = true;
      target.setAttribute('aria-hidden', 'true');
      if ('inert' in target) target.inert = true;
      if (record.snapshot?.platform === 'x') {
        if (!view.placeholder?.isConnected) {
          const placeholder = document.createElement('div');
          placeholder.className = 'gomimon-filter-placeholder';
          const labels = modules.policy.categoryNames(decision.labels);
          addText(placeholder, 'span', labels.length ? `Hidden: ${labels.join(', ')}` : 'Fed to GomiMon');
          const button = addText(placeholder, 'button', 'Show post');
          button.type = 'button';
          button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            onAction({ action: 'restore', itemKey: record.key });
          });
          target.after(placeholder);
          view.placeholder = placeholder;
        }
      } else {
        view.placeholder?.remove();
        view.placeholder = null;
      }
    }

    function labelText(label) {
      return {
        high: 'High AI likelihood',
        low: 'Low AI likelihood',
        uncertain: 'Uncertain',
        insufficient: 'Not enough text',
        category_checked: 'Category scan complete',
        unavailable: 'Unavailable',
        unsupported: 'Unsupported layout',
        waiting: 'Waiting for text',
        unchecked: 'Not checked for AI',
        checking: 'Checking content',
        retry_wait: 'Waiting to retry',
        blocked: 'Checking paused',
        quota_blocked: 'Quota exhausted — waiting for reset',
        auth_blocked: 'Sign in to continue'
      }[label] || 'GomiMon';
    }

    function renderAssessment(view, record, status, hasAssessment) {
      const popover = view.assessmentPopover;
      // Visibility updates must not dismiss or rebuild a card the user is reading.
      const settings = getSettings();
      const detailsKey = JSON.stringify([record.revision, status, record.scores, record.error?.message, settings.categories, settings.categoryStrength, record.override]);
      if (view.assessmentDetailsKey !== detailsKey) {
        view.closeAssessmentPopover?.();
        view.assessmentDetailsKey = detailsKey;
        clearPanel(popover);
        addText(popover, 'strong', labelText(status), `gomimon-ai-label gomimon-ai-${status}`);
        if (hasAssessment) {
          const probability = record.scores?.aiProbability;
          if (probability !== null && probability !== undefined && Number.isFinite(Number(probability))) {
            addText(popover, 'span', `${Math.round(Number(probability) * 100)}% AI likelihood`, 'gomimon-ai-probability');
          }
          const details = document.createElement('details');
          addText(details, 'summary', 'View assessment');
          addText(details, 'p', `This estimate reflects how likely this ${record.contentType} is to be AI-generated. It is not proof of who wrote it.`);
          if (record.scores?.truncated) addText(details, 'p', `Only part of this ${record.contentType} was assessed.`);
          const assessedText = record.snapshot?.text || record.snapshot?.body;
          if (assessedText) addText(details, 'p', assessedText, 'gomimon-ai-assessed');
          popover.appendChild(details);
        } else {
          const description = status === 'insufficient'
            ? `This ${record.contentType} is too short for an AI assessment. You can still feed it to GomiMon.`
            : status === 'category_checked'
              ? 'Category scan complete. This post has no AI authorship estimate.'
            : status === 'retry_wait'
              ? record.error?.message || 'Waiting for detector capacity before retrying.'
            : status === 'unavailable' || status === 'blocked'
              ? record.error?.message || `The AI assessment could not finish. You can still feed this ${record.contentType}.`
              : status === 'checking' ? 'The content assessment is in progress.'
              : `This ${record.contentType} has no AI assessment yet. You can still feed it to GomiMon.`;
          addText(popover, 'p', description);
        }
        const probabilities = record.scores?.categoryProbabilities || {};
        const enabled = (settings.categories || []).filter(category => modules.policy.REMOTE_CATEGORIES.has(category));
        const threshold = modules.policy.CATEGORY_THRESHOLDS[settings.categoryStrength] || modules.policy.CATEGORY_THRESHOLDS.balanced;
        if (record.contentType === 'post' && enabled.length) {
          addText(popover, 'p', `Feed filters hide matches at ${Math.round(threshold * 100)}% or higher.`);
          for (const category of enabled) {
            const value = probabilities[category];
            const checked = value !== null && value !== undefined && Number.isFinite(Number(value));
            const result = checked ? `${Math.round(Number(value) * 100)}% likelihood` : 'Not evaluated yet';
            addText(popover, 'span', `${modules.policy.categoryNames([category])[0]}: ${result}`);
          }
          if (record.override) addText(popover, 'p', 'Kept visible by your override.');
          if (!hasAssessment && record.snapshot?.text) {
            const details = document.createElement('details');
            addText(details, 'summary', 'View assessed text');
            addText(details, 'p', record.snapshot.text, 'gomimon-ai-assessed');
            popover.appendChild(details);
          }
        }
      }
    }

    function renderCommentPanel(panel, record, decision, view) {
      const settings = getSettings();
      const marker = ensureAssessmentMarker(view, 'comment');
      const label = record.scores?.label;
      const hasAssessment = ['high', 'low', 'uncertain'].includes(label);
      const status = hasAssessment ? label
        : record.analysisStatus === 'unavailable' ? 'unavailable'
        : record.analysisStatus === 'blocked' ? 'blocked'
        : ['running', 'queued'].includes(record.analysisStatus) ? 'checking'
        : label || 'unchecked';
      marker.hidden = false;
      marker.dataset.status = status;
      marker.setAttribute('aria-label', `${labelText(status)} — view assessment details`);
      clearPanel(panel);
      renderAssessment(view, record, status, hasAssessment);

      const canManuallyAnalyze = settings.mode === 'manual' &&
        record.extractionStatus === 'ready' &&
        Number(record.snapshot?.wordCount || 0) >= modules.policy.minAiWords(record) && !hasAssessment;
      if (record.analysisStatus === 'unavailable') {
        const button = addText(panel, 'button', 'Try again', 'gomimon-comment-action');
        button.type = 'button';
        button.dataset.gomimonAction = 'retry';
      } else if (canManuallyAnalyze && !['running', 'queued'].includes(record.analysisStatus)) {
        const button = addText(panel, 'button', 'Check for AI', 'gomimon-comment-action');
        button.type = 'button';
        button.dataset.gomimonAction = 'analyze';
      }
      const button = addText(panel, 'button', 'Feed', 'gomimon-comment-action gomimon-comment-feed');
      button.type = 'button';
      button.title = 'Feed to GomiMon';
      button.setAttribute('aria-label', 'Feed to GomiMon');
      addFeedIcon(button);
      button.dataset.gomimonAction = 'feed';
      panel.hidden = panel.childElementCount === 0;
    }

    function renderPostPanel(panel, record, decision, view) {
      const settings = getSettings();
      const marker = ensureAssessmentMarker(view, 'post');
      const label = record.scores?.label;
      const hasAssessment = ['high', 'low', 'uncertain'].includes(label);
      const retryable = record.analysisStatus === 'unavailable';
      const status = retryable ? 'unavailable'
        : record.analysisStatus === 'blocked' ? 'blocked'
        : record.analysisStatus === 'retry_wait' ? 'retry_wait'
        : ['running', 'queued'].includes(record.analysisStatus) ? 'checking'
        : record.extractionStatus === 'settling' ? 'waiting'
        : record.extractionStatus === 'unsupported' ? 'unsupported'
        : label || 'unchecked';
      marker.hidden = false;
      marker.dataset.status = status;
      marker.setAttribute('aria-label', `${labelText(status)} — view assessment details`);
      renderAssessment(view, record, status, hasAssessment && !retryable);
      if (marker.hidden) view.closeAssessmentPopover?.();
      clearPanel(panel);

      const canManuallyAnalyze = settings.mode === 'manual' &&
        record.extractionStatus === 'ready' &&
        Number(record.snapshot?.wordCount || 0) >= modules.policy.minAiWords(record) &&
        (record.scores?.aiProbability === null || record.scores?.aiProbability === undefined ||
          !Number.isFinite(Number(record.scores.aiProbability)));
      if (canManuallyAnalyze && settings.mode === 'manual') {
        const button = addText(panel, 'button', 'Check for AI', 'gomimon-post-action');
        button.type = 'button';
        button.dataset.gomimonAction = 'analyze';
      } else if (retryable) {
        const button = addText(panel, 'button', 'Try again', 'gomimon-post-action');
        button.type = 'button';
        button.dataset.gomimonAction = 'retry';
      }
      const feed = addText(panel, 'button', 'Feed', 'gomimon-post-action gomimon-post-feed');
      feed.type = 'button';
      feed.title = 'Feed to GomiMon';
      feed.setAttribute('aria-label', 'Feed to GomiMon');
      addFeedIcon(feed);
      feed.dataset.gomimonAction = 'feed';
      if (record.snapshot?.platform === 'x' && record.snapshot.truncated) {
        const partial = addText(panel, 'span', 'Partial text', 'gomimon-ai-insufficient');
        partial.title = 'Only rendered text is assessed. Expanding the post starts a new assessment.';
      }
      // Feed is first so it sits directly after Share; optional analysis follows.
      panel.prepend(feed);
      addText(panel, 'style', postControlStyles);
      panel.hidden = panel.childElementCount === 0;
    }

    function renderPanel(panel, record, decision, view) {
      if (!panel) return;
      if (record.contentType === 'comment') {
        renderCommentPanel(panel, record, decision, view);
        return;
      }
      renderPostPanel(panel, record, decision, view);
    }

    function render(record, decision, presentation) {
      for (const view of record.views.values()) {
        if (!view.element?.isConnected) continue;
        const panel = ensurePanel(view, record);
        applyVisibility(view, record, decision, presentation);
        renderPanel(panel, record, decision, view);
      }
    }

    function detachView(view) {
      view.postObserver?.disconnect();
      view.postObserver = null;
      restoreTarget(view);
      const panel = view.panel?.isConnected ? view.panel : Array.from(view.element?.querySelectorAll?.('.gomimon-ai-panel') || [])
        .find(candidate => candidate.dataset.gomimonPanelFor === view.element?.dataset?.gomimonItemKey);
      if (panel?.dataset.gomimonBound) panel.remove();
      view.closeAssessmentPopover?.();
      view.assessmentPopover?.remove();
      view.commentActionRow?.classList.remove('gomimon-comment-action-row');
      view.assessmentPopover = null;
      view.assessmentDetailsKey = null;
      view.commentActionRow = null;
      view.closeAssessmentPopover = null;
      if (view.commentMarker?.isConnected) view.commentMarker.remove();
      if (view.postMarker?.isConnected) view.postMarker.remove();
      view.panel = null;
      view.commentMarker = null;
      view.postMarker = null;
    }

    return { detachView, render, restoreTarget };
  }

  modules.renderer = { createRenderer };
})(globalThis);
