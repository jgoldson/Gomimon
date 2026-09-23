import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNameAppropriateness,
  gomimonNameKey,
  utcWeekBounds,
  validateGomimonName,
  validateLeaderboardJoin,
  validateLeaderboardPeriod,
  validateMealEvents
} from './leaderboard.js';

test('normalizes public GomiMon names and creates a case-insensitive key', () => {
  const result = validateGomimonName('  Byte   Goblin  ');
  assert.equal(result.name, 'Byte Goblin');
  assert.equal(validateGomimonName('O’Gomi').name, 'O’Gomi');
  assert.equal(gomimonNameKey('BYTE GOBLIN'), result.nameKey);
  assert.equal(result.nameHash.length, 64);
});

test('rejects invalid, reserved, and deterministically blocked names', () => {
  assert.throws(() => validateGomimonName('a'), /between 2 and 24/);
  assert.throws(() => validateGomimonName('GomiMon Official'), /reserved/);
  assert.throws(() => validateGomimonName('bad!name'), /letters, numbers/);
  assert.throws(() => validateGomimonName('shit-head'), /different/);
});

test('accepts name moderation only at the configured high-confidence threshold', () => {
  assert.deepEqual(classifyNameAppropriateness(0.90), {
    allowed: true,
    appropriateProbability: 0.90
  });
  assert.equal(classifyNameAppropriateness(0.89).allowed, false);
  assert.throws(() => classifyNameAppropriateness(undefined), /invalid/);
  assert.throws(() => classifyNameAppropriateness(1.2), /invalid/);
});

test('validates leaderboard periods, joins, and meal batches', () => {
  assert.equal(validateLeaderboardPeriod(), 'weekly');
  assert.equal(validateLeaderboardPeriod('all_time'), 'all_time');
  assert.deepEqual(validateLeaderboardJoin({ feedCount: 4, evolution: 'baby' }), {
    feedCount: 4,
    evolution: 'baby'
  });
  assert.deepEqual(validateMealEvents({
    events: [{ id: 'meal-event-0001', foodType: 'image', evolution: 'muta-pixel' }]
  }), [{ id: 'meal-event-0001', foodType: 'image', evolution: 'muta-pixel' }]);
  assert.throws(() => validateMealEvents({ events: [] }), /1-100/);
});

test('uses Monday 00:00 UTC for weekly standings', () => {
  assert.deepEqual(utcWeekBounds(new Date('2026-09-27T18:00:00.000Z')), {
    startsAt: '2026-09-21T00:00:00.000Z',
    endsAt: '2026-09-28T00:00:00.000Z'
  });
});

test('accepts Nimbus-Gomi profiles and meal events', () => {
  assert.equal(validateLeaderboardJoin({ feedCount: 1000, evolution: 'nimbus-gomi' }).evolution, 'nimbus-gomi');
  assert.equal(validateMealEvents({
    events: [{ id: 'bubble-meal-0001', foodType: 'post', evolution: 'nimbus-gomi' }]
  })[0].evolution, 'nimbus-gomi');
});
