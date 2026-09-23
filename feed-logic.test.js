import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedUpdate } from './feed-logic.js';
import { getPetSprite, sanitizeStats } from './constants.js';
import { existsSync } from 'node:fs';
import { GOMIMON_EVOLUTIONS } from './server/leaderboard.js';

const stats = {
  hunger: 40,
  glitch: 80,
  feedCount: 9,
  evolution: 'egg',
  diet: { text: 9, image: 0, post: 0 }
};

test('manual, automatic and category meals cross both evolution boundaries', () => {
  for (const source of ['manual', 'automatic', 'category']) {
    for (const [evolution, feedCount, next] of [['baby', 99, 'bubble-gomi'], ['bubble-gomi', 999, 'nimbus-gomi']]) {
      const result = buildFeedUpdate({ ...stats, evolution, feedCount }, 'post', source);
      assert.equal(result.evolution, next);
      assert.equal(result.justEvolved, true);
      assert.equal(result.updates.feedCount, feedCount + 1);
    }
  }
});

test('new forms survive validation and every animation resolves to an asset', () => {
  for (const evolution of ['bubble-gomi', 'nimbus-gomi']) {
    assert.equal(sanitizeStats({ evolution }).evolution, evolution);
    assert.ok(GOMIMON_EVOLUTIONS.includes(evolution));
    for (const state of ['idle', 'eat', 'celebrate', 'sleep', 'crashed', 'starved']) {
      assert.ok(existsSync(new URL(getPetSprite(evolution, state), import.meta.url)), state);
    }
  }
});

test('automatic meals increase hunger and evolution progress without glitch', () => {
  const result = buildFeedUpdate(stats, 'text', 'automatic');
  assert.equal(result.updates.hunger, 60);
  assert.equal(result.updates.glitch, 80);
  assert.equal(result.updates.feedCount, 10);
  assert.equal(result.evolution, 'baby');
});

test('category filter meals increase progress without glitch', () => {
  const result = buildFeedUpdate({
    hunger: 50,
    glitch: 10,
    feedCount: 0,
    evolution: 'egg',
    diet: { text: 0, image: 0, post: 0 }
  }, 'post', 'category');
  assert.equal(result.updates.glitch, 10);
  assert.equal(result.updates.hunger, 70);
});

test('manual meals retain the existing glitch increase', () => {
  const result = buildFeedUpdate(stats, 'text', 'manual');
  assert.equal(result.updates.glitch, 85);
});
