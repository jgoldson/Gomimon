import { createHash } from 'node:crypto';
import { InputError } from './logic.js';

export const NAME_MODERATION_RUBRIC_VERSION = 'gomimon-public-name-v1';
export const NAME_APPROPRIATE_THRESHOLD = 0.90;
export const LEADERBOARD_LIMIT = 20;
export const MAX_MEAL_EVENTS_PER_REQUEST = 100;

export const GOMIMON_EVOLUTIONS = Object.freeze([
  'egg',
  'baby',
  'bubble-gomi',
  'nimbus-gomi',
  'typo-ling',
  'muta-pixel',
  'classic-gomi',
  'null-sprite'
]);

const FOOD_TYPES = new Set(['text', 'image', 'post']);
const RESERVED_NAME_PARTS = Object.freeze([
  'admin',
  'administrator',
  'gomimon',
  'moderator',
  'official',
  'support'
]);
const BLOCKED_NAME_PARTS = Object.freeze([
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'faggot'
]);

export function normalizeGomimonName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function gomimonNameKey(name) {
  return normalizeGomimonName(name).toLocaleLowerCase('en-US');
}

export function gomimonNameHash(nameKey) {
  return createHash('sha256').update(nameKey, 'utf8').digest('hex');
}

export function validateGomimonName(value) {
  const name = normalizeGomimonName(value);
  const length = [...name].length;
  if (length < 2 || length > 24) {
    throw new InputError('GomiMon names must be between 2 and 24 characters');
  }
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} _'’-]*[\p{L}\p{N}])?$/u.test(name)) {
    throw new InputError('Use letters, numbers, spaces, apostrophes, hyphens, or underscores');
  }
  const nameKey = gomimonNameKey(name);
  const compact = nameKey.replace(/[\s_'’-]+/gu, '');
  if (RESERVED_NAME_PARTS.some(part => compact.includes(part))) {
    const error = new InputError('That name is reserved');
    error.code = 'NAME_NOT_ALLOWED';
    throw error;
  }
  if (BLOCKED_NAME_PARTS.some(part => compact.includes(part))) {
    const error = new InputError('Choose a different GomiMon name');
    error.code = 'NAME_NOT_ALLOWED';
    throw error;
  }
  return { name, nameKey, nameHash: gomimonNameHash(nameKey) };
}

export function classifyNameAppropriateness(value) {
  const appropriateProbability = Number(value);
  if (!Number.isFinite(appropriateProbability) || appropriateProbability < 0 || appropriateProbability > 1) {
    throw new Error('TypeSafe returned an invalid name appropriateness probability');
  }
  return {
    allowed: appropriateProbability >= NAME_APPROPRIATE_THRESHOLD,
    appropriateProbability
  };
}

export function validateLeaderboardPeriod(value) {
  if (value === undefined || value === '' || value === 'weekly') return 'weekly';
  if (value === 'all_time') return 'all_time';
  throw new InputError('period must be weekly or all_time');
}

function validateEvolution(value) {
  if (!GOMIMON_EVOLUTIONS.includes(value)) {
    throw new InputError('Invalid GomiMon evolution');
  }
  return value;
}

export function validateLeaderboardJoin(body) {
  const feedCount = Number(body?.feedCount);
  if (!Number.isSafeInteger(feedCount) || feedCount < 0 || feedCount > 2_147_483_647) {
    throw new InputError('feedCount must be a non-negative integer');
  }
  return { feedCount, evolution: validateEvolution(body?.evolution) };
}

export function validateMealEvents(body) {
  if (!Array.isArray(body?.events) || body.events.length < 1 ||
      body.events.length > MAX_MEAL_EVENTS_PER_REQUEST) {
    throw new InputError(`events must contain 1-${MAX_MEAL_EVENTS_PER_REQUEST} meals`);
  }
  const seen = new Set();
  return body.events.map(raw => {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(id)) {
      throw new InputError('Each meal event needs a valid id');
    }
    if (seen.has(id)) throw new InputError('Meal event ids must be unique within a batch');
    seen.add(id);
    if (!FOOD_TYPES.has(raw?.foodType)) throw new InputError('Invalid meal foodType');
    return {
      id,
      foodType: raw.foodType,
      evolution: validateEvolution(raw?.evolution)
    };
  });
}

export function utcWeekBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}
