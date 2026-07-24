'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  generateId,
  clamp,
  midiToFrequency,
  dbToLinear,
  linearToDb,
  retry,
  createRng,
  hashStringToSeed,
  createRateLimiter,
} = require('../index.js');

test('generateId produces unique, prefixed ids', () => {
  const a = generateId('sess');
  const b = generateId('sess');
  assert.notEqual(a, b);
  assert.match(a, /^sess_/);
});

test('clamp bounds a value', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test('midiToFrequency matches known reference pitches', () => {
  assert.ok(Math.abs(midiToFrequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFrequency(60) - 261.6255653) < 1e-3);
});

test('dbToLinear/linearToDb round-trip', () => {
  const linear = dbToLinear(-6);
  assert.ok(Math.abs(linearToDb(linear) - -6) < 1e-9);
});

test('retry succeeds after transient failures', async () => {
  let calls = 0;
  const result = await retry(async () => {
    calls += 1;
    if (calls < 3) throw new Error('transient');
    return 'ok';
  }, { attempts: 5, delayMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('createRng is deterministic for a given seed', () => {
  const seed = hashStringToSeed('same-seed');
  const rngA = createRng(seed);
  const rngB = createRng(seed);
  const seqA = [rngA(), rngA(), rngA()];
  const seqB = [rngB(), rngB(), rngB()];
  assert.deepEqual(seqA, seqB);
  for (const value of seqA) {
    assert.ok(value >= 0 && value < 1);
  }
});

test('createRateLimiter allows up to capacity requests, then blocks', () => {
  const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
  const now = 1_000_000;
  assert.equal(limiter.take('a', now).allowed, true);
  assert.equal(limiter.take('a', now).allowed, true);
  assert.equal(limiter.take('a', now).allowed, true);
  const blocked = limiter.take('a', now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('createRateLimiter refills tokens over time', () => {
  const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
  const now = 1_000_000;
  assert.equal(limiter.take('a', now).allowed, true);
  assert.equal(limiter.take('a', now).allowed, false); // no tokens left yet
  assert.equal(limiter.take('a', now + 1100).allowed, true); // ~1.1s later, refilled
});

test('createRateLimiter tracks separate keys independently', () => {
  const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0.1 });
  const now = 1_000_000;
  assert.equal(limiter.take('a', now).allowed, true);
  assert.equal(limiter.take('b', now).allowed, true); // different key, unaffected by 'a'
  assert.equal(limiter.take('a', now).allowed, false);
});
